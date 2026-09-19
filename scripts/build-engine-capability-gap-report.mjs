#!/usr/bin/env node
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'); const CHECK=process.argv.includes('--check');
const read=(r,f=null)=>{try{return JSON.parse(fs.readFileSync(path.join(ROOT,r),'utf8'));}catch(e){if(f!==null)return f;throw e;}};
const write=(r,v)=>{const p=path.join(ROOT,r);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n');};
const stable=v=>JSON.stringify(v,(k,x)=>k==='generatedAt'?undefined:x);
const census=read('src/data/generated/oracle-support-census.json');
const groups=new Map();
for(const row of census.cards||[]){ if(['fully-supported','non-digital-exclusion','format-scope-exclusion'].includes(row.classification)) continue; const keys=[];
  if(row.explicitUnsupportedNodes?.length) for(const n of row.explicitUnsupportedNodes) keys.push(`engine:${n.reason}`);
  else if(row.classification==='missing-script-or-template') keys.push(`compiler:${row.parserCompilerStatus}:${row.parserCompilerConfidence}`);
  else if(row.classification==='custom-hook-review') keys.push('custom-hook:review');
  else if(row.classification==='missing-test-or-certification') keys.push('certification:behavior-present');
  else keys.push(`other:${row.classification}`);
  for(const key of keys){ if(!groups.has(key)) groups.set(key,{gapKey:key,layer:key.split(':')[0],affectedCount:0,cardIds:[],examples:[]}); const g=groups.get(key);g.affectedCount++;g.cardIds.push(row.cardId); if(g.examples.length<12) g.examples.push({cardId:row.cardId,name:row.name,reason:row.classificationReason}); }
}
const gaps=[...groups.values()].sort((a,b)=>b.affectedCount-a.affectedCount||a.gapKey.localeCompare(b.gapKey));
const payload={schema:'mtg-commander-engine-capability-gap-report',schemaVersion:1,generatedAt:new Date().toISOString(),rulesVersion:census.rulesVersion,databaseVersion:census.databaseVersion,summary:{gapFamilies:gaps.length,affectedCards:gaps.reduce((n,g)=>n+g.affectedCount,0)},gaps};
const rel='src/data/generated/engine-capability-gap-report.json'; if(CHECK){const old=read(rel,null);if(!old||stable(old)!==stable(payload))throw new Error('Engine capability gap report is stale; run npm run build:gaps.');console.log(`Gap report current: ${gaps.length} families.`);}else{write(rel,payload);console.log(`Built capability gap report: ${gaps.length} families across ${payload.summary.affectedCards} assignments.`);}
