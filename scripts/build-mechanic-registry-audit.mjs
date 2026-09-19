#!/usr/bin/env node
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { EVERGREEN_MECHANICS, COMMANDER_MECHANICS, CASTING_MECHANICS, SPECIALTY_MECHANICS } from '../src/mechanics/index.js';
import { classifyCatalogCardScope } from '../src/support/CardScopePolicy.js';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'); const CHECK=process.argv.includes('--check');
const read=(rel,f=null)=>{try{return JSON.parse(fs.readFileSync(path.join(ROOT,rel),'utf8'));}catch(e){if(f!==null)return f;throw e;}};
const write=(rel,v)=>{const p=path.join(ROOT,rel);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n');};
const norm=s=>String(s||'').trim().toLowerCase().replace(/[’']/g,"'").replace(/\s+/g,' ');
const defs=[...EVERGREEN_MECHANICS,...COMMANDER_MECHANICS,...CASTING_MECHANICS,...SPECIALTY_MECHANICS];
const aliases=new Map(); for(const d of defs){for(const n of [d.id,d.name,...(d.aliases||[])])aliases.set(norm(n),d.id);}
const catalog=read('.cache/scryfall/card-catalog.json',{cards:[],complete:false});
const source=read('src/data/source/cards.json',{}); const allCards=catalog.cards?.length?catalog.cards:Object.values(source);
const cards=catalog.complete===true?allCards.filter(card=>classifyCatalogCardScope(card).inScope):allCards;
const observed=new Map(); for(const c of cards){for(const k of c.keywords||[]){const key=norm(k);if(!observed.has(key))observed.set(key,{keyword:key,count:0,examples:[]});const r=observed.get(key);r.count++;if(r.examples.length<8)r.examples.push({id:c.id,name:c.name});}}
const rows=[...observed.values()].map(r=>({...r,registeredMechanicId:aliases.get(r.keyword)||null,status:aliases.has(r.keyword)?'registered':'missing'})).sort((a,b)=>b.count-a.count||a.keyword.localeCompare(b.keyword));
const missing=rows.filter(r=>r.status==='missing'); const payload={schema:'mtg-commander-mechanic-registry-audit',schemaVersion:1,generatedAt:new Date().toISOString(),catalogComplete:catalog.complete===true,catalogCount:allCards.length,inScopeCardCount:cards.length,registeredMechanicCount:defs.length,observedKeywordCount:rows.length,missingKeywordCount:missing.length,complete:missing.length===0,missingKeywords:missing,keywords:rows};
const rel='src/data/generated/mechanic-registry-audit.json';const stable=x=>JSON.stringify(x,(k,v)=>k==='generatedAt'?undefined:v);if(CHECK){const old=read(rel,null);if(!old||stable(old)!==stable(payload))throw new Error('Mechanic registry audit is stale; run npm run build:mechanics-audit.');console.log(`Mechanic audit current: ${rows.length} observed keywords, ${missing.length} missing.`);}else{write(rel,payload);console.log(`Built mechanic audit: ${rows.length} observed keywords, ${missing.length} missing.`);if(missing.length)console.log('Missing:',missing.map(r=>r.keyword).join(', '));}
