#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { OracleTemplateCompiler } from '../src/cards/compiler/OracleTemplateCompiler.js';

const catalogPath = path.resolve('src/data/generated/oracle-cards.json');
const fallbackPath = path.resolve('src/data/generated/cards.json');
const raw = JSON.parse(fs.readFileSync(fs.existsSync(catalogPath) ? catalogPath : fallbackPath, 'utf8'));
const cards = Array.isArray(raw) ? raw : Object.values(raw);
const compiler = new OracleTemplateCompiler();
const usable = cards.filter(c => c && (c.oracleText || c.oracle_text) && (c.name || c.id));
const limit = Math.max(100, Number(process.env.PHASE40_PAIRS || 5000));
let state = 0x40c0ffee;
const rnd = () => (state = (Math.imul(state,1664525)+1013904223)>>>0) / 2**32;
const failures=[]; const status={bothCompiled:0,mixed:0,bothPartial:0,manual:0};
function normalize(c){return {id:c.id||c.oracle_id||c.name,name:c.name,layout:c.layout||'normal',typeLine:c.typeLine||c.type_line||'',keywords:c.keywords||[],oracleText:c.oracleText||c.oracle_text||''};}
function rank(r){ if(r?.autoAccepted) return 2; if(r?.compiledCard && (r.matchedParagraphs||0)>0) return 1; return 0; }
for(let i=0;i<limit;i++){
  const a=normalize(usable[Math.floor(rnd()*usable.length)]), b=normalize(usable[Math.floor(rnd()*usable.length)]);
  try{
    const ra=compiler.compileCard(a), rb=compiler.compileCard(b); const x=rank(ra),y=rank(rb);
    if(x===2&&y===2) status.bothCompiled++; else if((x===2&&y===1)||(x===1&&y===2)) status.mixed++; else if(x===1&&y===1) status.bothPartial++; else status.manual++;
    // Pair invariant: compiling B must not mutate or alter A's deterministic result.
    const ra2=compiler.compileCard(a);
    if(JSON.stringify(ra.compiledCard)!==JSON.stringify(ra2.compiledCard)) failures.push({kind:'non-deterministic-compile',a:a.name,b:b.name});
  } catch(error){ failures.push({kind:'exception',a:a.name,b:b.name,message:error.message}); }
}
const report={schema:'mtg-phase40-real-card-pairs',generatedAt:new Date().toISOString(),catalogCards:usable.length,pairsTested:limit,status,failures,passed:failures.length===0};
fs.mkdirSync('coverage',{recursive:true}); fs.writeFileSync('coverage/phase40-card-pair-audit.json',JSON.stringify(report,null,2));
console.log(`[phase40] ${limit} deterministic real-card pairs tested; ${failures.length} failures.`); if(failures.length) process.exitCode=1;
