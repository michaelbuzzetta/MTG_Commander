import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import StreamJson from 'stream-json';
import StreamArrayModule from 'stream-json/streamers/StreamArray.js';
const { parser } = StreamJson;
const { streamArray } = StreamArrayModule;
import { mongoDb, ensureCardIndexes } from './mongo-card-store.mjs';

const HEADERS = { 'User-Agent': 'MTGAITrainer/5.0 (+local personal Commander trainer)', Accept: 'application/json' };
const BULK_INDEX = 'https://api.scryfall.com/bulk-data';
const BATCH = 1000;
const args = process.argv.slice(2);
const oracleArg = args.find(x => x.startsWith('--oracle-file='))?.slice(14);
const printingArg = args.find(x => x.startsWith('--printing-file='))?.slice(16);

const n = v => { const x = Number(v); return Number.isFinite(x) ? x : null; };
const faceImages = raw => { const face = raw.card_faces?.find(x => x?.image_uris) || raw.card_faces?.[0] || {}; const u = raw.image_uris || face.image_uris || {}; return { image: u.normal || u.large || u.small || '', imageSmall: u.small || u.normal || '', imageLarge: u.large || u.normal || '', artCrop: u.art_crop || '', png: u.png || '' }; };
const normFace = f => { const u=f?.image_uris||{}; return { name:f?.name||'', manaCost:f?.mana_cost||'', typeLine:f?.type_line||'', oracleText:f?.oracle_text||'', colors:f?.colors||[], power:n(f?.power), toughness:n(f?.toughness), loyalty:n(f?.loyalty), defense:n(f?.defense), image:u.normal||u.large||u.small||'', imageSmall:u.small||u.normal||'', imageLarge:u.large||u.normal||'', artCrop:u.art_crop||'', png:u.png||'' }; };
function oracleDoc(raw) { const faces=(raw.card_faces||[]).map(normFace); const first=faces[0]||{}; return { id:`catalog-${raw.oracle_id||raw.id}`, oracleId:raw.oracle_id||raw.id, scryfallId:raw.id, name:raw.name, searchName:String(raw.name||'').toLowerCase(), aliases:[...new Set([raw.name,...faces.map(f=>f.name)].filter(Boolean))], layout:raw.layout||'normal', typeLine:raw.type_line||first.typeLine||'', manaCost:raw.mana_cost||first.manaCost||'', manaValue:n(raw.cmc)??0, oracleText:(raw.card_faces?.length?raw.card_faces.map(f=>f.oracle_text||'').filter(Boolean).join('\n//\n'):raw.oracle_text)||'', colors:raw.colors||first.colors||[], colorIdentity:raw.color_identity||[], keywords:(raw.keywords||[]).map(x=>String(x).toLowerCase()), producedMana:raw.produced_mana||[], legalities:raw.legalities||{}, games:raw.games||[], reserved:!!raw.reserved, power:n(raw.power)??first.power??null, toughness:n(raw.toughness)??first.toughness??null, loyalty:n(raw.loyalty)??first.loyalty??null, defense:n(raw.defense)??first.defense??null, cardFaces:faces, ...faceImages(raw), set:raw.set||'', setName:raw.set_name||'', collectorNumber:raw.collector_number||'', rarity:raw.rarity||'', edhrecRank:n(raw.edhrec_rank), catalogCard:true, supported:false, source:'Scryfall oracle_cards → MongoDB' }; }
function printingDoc(raw) { return { scryfallId:raw.id, oracleId:raw.oracle_id||null, name:raw.name, searchName:String(raw.name||'').toLowerCase(), lang:raw.lang||'en', layout:raw.layout||'normal', set:raw.set||'', setName:raw.set_name||'', collectorNumber:raw.collector_number||'', rarity:raw.rarity||'', releasedAt:raw.released_at||null, digital:!!raw.digital, promo:!!raw.promo, reprint:!!raw.reprint, finishes:raw.finishes||[], frame:raw.frame||null, fullArt:!!raw.full_art, textless:!!raw.textless, cardFaces:(raw.card_faces||[]).map(normFace), ...faceImages(raw), source:'Scryfall default_cards → MongoDB' }; }

async function download(url, dest) { if (!url || typeof url !== 'string') throw new Error(`Scryfall bulk record did not provide a download URL: ${String(url)}`); const r=await fetch(url,{headers:HEADERS}); if(!r.ok) throw new Error(`HTTP ${r.status} downloading ${url}`); await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(dest)); }
function inputStream(file) { const fd=fs.openSync(file,'r'); const magic=Buffer.alloc(2); fs.readSync(fd,magic,0,2,0); fs.closeSync(fd); const s=fs.createReadStream(file); return (magic[0]===0x1f&&magic[1]===0x8b) ? s.pipe(createGunzip()) : s; }
async function importArray(file, collection, normalizer) {
  const stream=inputStream(file).pipe(parser()).pipe(streamArray()); let ops=[], count=0;
  for await (const {value} of stream) { const doc=normalizer(value); if(!doc) continue; const key=collection.collectionName==='cards' ? {oracleId:doc.oracleId} : {scryfallId:doc.scryfallId}; ops.push({replaceOne:{filter:key,replacement:doc,upsert:true}}); count++; if(ops.length>=BATCH){await collection.bulkWrite(ops,{ordered:false}); ops=[];} }
  if(ops.length) await collection.bulkWrite(ops,{ordered:false}); return count;
}
async function importJsonl(file, collection, normalizer) {
  const { createInterface } = await import('node:readline'); const rl=createInterface({input:inputStream(file),crlfDelay:Infinity}); let ops=[],count=0;
  for await(const line of rl){if(!line.trim())continue; const doc=normalizer(JSON.parse(line)); const key=collection.collectionName==='cards'?{oracleId:doc.oracleId}:{scryfallId:doc.scryfallId}; ops.push({replaceOne:{filter:key,replacement:doc,upsert:true}});count++;if(ops.length>=BATCH){await collection.bulkWrite(ops,{ordered:false});ops=[];}}
  if(ops.length)await collection.bulkWrite(ops,{ordered:false});return count;
}
async function importFile(file, collection, normalizer, format='array'){return format==='jsonl'?importJsonl(file,collection,normalizer):importArray(file,collection,normalizer);}

async function main(){
  const db=await mongoDb(); await ensureCardIndexes(db); const cards=db.collection('cards'), printings=db.collection('printings'), meta=db.collection('metadata');
  let oracleFile=oracleArg, printingFile=printingArg, temp=[]; let updatedAt=null, printingUpdatedAt=null;
  if(!oracleFile||!printingFile){ const idx=await (await fetch(BULK_INDEX,{headers:HEADERS})).json(); const oracle=idx.data.find(x=>x.type==='oracle_cards'), prints=idx.data.find(x=>x.type==='default_cards'); if(!oracle||!prints)throw new Error('Scryfall bulk index is missing oracle_cards/default_cards.'); updatedAt=oracle.updated_at; printingUpdatedAt=prints.updated_at; const previous=await meta.findOne({_id:'scryfall'}); if(previous?.oracleUpdatedAt===oracle.updated_at&&previous?.printingUpdatedAt===prints.updated_at&&await cards.estimatedDocumentCount()>10000){console.log('MongoDB card catalog is already current.');return;} const oracleIsJsonl=!!oracle.jsonl_download_uri; const printsIsJsonl=!!prints.jsonl_download_uri; const oracleUrl=oracle.jsonl_download_uri||oracle.download_uri; const printsUrl=prints.jsonl_download_uri||prints.download_uri; oracleFile=path.join(os.tmpdir(),`mtg-oracle-${Date.now()}${oracleIsJsonl?'.jsonl.gz':'.json'}`);printingFile=path.join(os.tmpdir(),`mtg-printings-${Date.now()}${printsIsJsonl?'.jsonl.gz':'.json'}`);temp=[oracleFile,printingFile]; console.log('Downloading current Scryfall bulk catalogs...'); if(!oracleUrl||!printsUrl) throw new Error('Scryfall bulk metadata did not include usable jsonl_download_uri/download_uri fields.'); await download(oracleUrl,oracleFile); await download(printsUrl,printingFile); }
  try { console.log('Importing Oracle identities into MongoDB...'); const oracleCount=await importFile(oracleFile,cards,oracleDoc,/\.jsonl(?:\.gz)?$/i.test(oracleFile)?'jsonl':'array'); console.log('Importing all printings into MongoDB...'); const printingCount=await importFile(printingFile,printings,printingDoc,/\.jsonl(?:\.gz)?$/i.test(printingFile)?'jsonl':'array'); if(oracleCount<10000||printingCount<10000)throw new Error(`Import incomplete (${oracleCount} Oracle / ${printingCount} printings).`);
    // Fill artwork gaps on Oracle records from the newest English printing that has art.
    const cursor=cards.find({$or:[{image:''},{image:{$exists:false}}]},{projection:{oracleId:1}}); let patched=0; for await(const c of cursor){const p=await printings.find({oracleId:c.oracleId,lang:'en',image:{$nin:['',null]}}).sort({releasedAt:-1}).limit(1).next();if(p){await cards.updateOne({_id:c._id},{$set:{image:p.image,imageSmall:p.imageSmall,imageLarge:p.imageLarge,artCrop:p.artCrop,png:p.png,artSourcePrintingId:p.scryfallId}});patched++;}}
    await meta.replaceOne({_id:'scryfall'},{_id:'scryfall',complete:true,oracleCount,printingCount,oracleUpdatedAt:updatedAt,printingUpdatedAt,updatedAt:new Date().toISOString(),artFallbacksPatched:patched},{upsert:true}); console.log(`MongoDB ready: ${oracleCount} Oracle cards, ${printingCount} printings, ${patched} artwork fallbacks patched.`);
  } finally { for(const f of temp)try{fs.rmSync(f,{force:true})}catch{} }
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
