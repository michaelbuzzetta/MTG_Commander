#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const candidates=['dist/data/scryfall-card-catalog.json','src/data/updates/step43-catalog-snapshot.json'];
const source=candidates.find(f=>fs.existsSync(path.join(ROOT,f))); if(!source) throw new Error('Step 66 requires a complete Oracle catalog snapshot.');
const payload=JSON.parse(fs.readFileSync(path.join(ROOT,source),'utf8')); const cards=payload.cards||payload; if(!Array.isArray(cards)||!cards.length) throw new Error('Step 66 catalog snapshot is empty.');
const requested=Number(process.env.MTG_AUDIT_WORKERS||0); const workerCount=Math.max(1,Math.min(cards.length,requested||Math.min(4,os.availableParallelism?.()||4)));
const chunks=Array.from({length:workerCount},()=>[]); cards.forEach((card,i)=>chunks[i%workerCount].push(card));
const workerUrl=new URL('./phase66-audit-worker.mjs',import.meta.url);
const results=await Promise.all(chunks.map(chunk=>new Promise((resolve,reject)=>{const w=new Worker(workerUrl,{workerData:{cards:chunk}}); w.once('message',resolve); w.once('error',reject); w.once('exit',code=>{if(code!==0) reject(new Error(`audit worker exited ${code}`));});})));
const summary={fullyExecutable:0,partiallyRecognized:0,manualReview:0,compilerFailures:0,explicitNonDigitalExceptions:0}; const rows=[]; const unmatched=new Map();
for(const result of results){for(const k of Object.keys(summary)) summary[k]+=result.summary[k]||0; rows.push(...result.rows); for(const [p,n] of result.unmatched) unmatched.set(p,(unmatched.get(p)||0)+n);}
const digitallyRepresentable=cards.length-summary.explicitNonDigitalExceptions; const unresolvedDigital=summary.partiallyRecognized+summary.manualReview+summary.compilerFailures;
const report={schema:'mtg-phase66-universal-coverage-audit-v2-parallel',generatedAt:new Date().toISOString(),source,sourceDeclaredComplete:payload.complete===true,sourceDeclaredCount:payload.count||cards.length,totalCatalogEntries:cards.length,auditWorkers:workerCount,summary,digitallyRepresentable,unresolvedDigital,coverage:{fullyExecutableCatalogPct:+(100*summary.fullyExecutable/cards.length).toFixed(2),fullyExecutableDigitalPct:+(100*summary.fullyExecutable/Math.max(1,digitallyRepresentable)).toFixed(2)},releaseGate:{passed:unresolvedDigital===0,requirement:'Every digitally representable catalog entry must compile to executable behavior; physical-only exceptions must be explicit.'},topUnmatchedParagraphs:[...unmatched].sort((a,b)=>b[1]-a[1]).slice(0,500).map(([text,count])=>({text,count})),cards:rows};
fs.mkdirSync(path.join(ROOT,'coverage'),{recursive:true}); fs.writeFileSync(path.join(ROOT,'coverage/phase66-universal-coverage-audit.json'),JSON.stringify(report,null,2)+'\n');
const md=`# Step 66 — Universal Coverage Audit\n\nCatalog entries audited: **${cards.length}**\n\n- Fully executable: **${summary.fullyExecutable}**\n- Partially recognized: **${summary.partiallyRecognized}**\n- Manual review: **${summary.manualReview}**\n- Compiler failures: **${summary.compilerFailures}**\n- Explicit non-digital/physical exceptions: **${summary.explicitNonDigitalExceptions}**\n- Digitally representable unresolved entries: **${unresolvedDigital}**\n- Full executable catalog coverage: **${report.coverage.fullyExecutableCatalogPct}%**\n- Audit workers: **${workerCount}**\n- Release gate: **${report.releaseGate.passed?'PASS':'FAIL'}**\n\nThe gate intentionally fails closed. Recognition, database presence, or partial parsing is not counted as implementation.\n`;
fs.writeFileSync(path.join(ROOT,'PHASE66_UNIVERSAL_COVERAGE_AUDIT.md'),md); console.log(`Step 66 audit: ${cards.length} total; ${summary.fullyExecutable} executable; ${summary.partiallyRecognized} partial; ${summary.manualReview} manual; ${summary.compilerFailures} failures; ${summary.explicitNonDigitalExceptions} physical exceptions; workers ${workerCount}; gate ${report.releaseGate.passed?'PASS':'FAIL'}.`); if(process.argv.includes('--gate')&&!report.releaseGate.passed) process.exitCode=1;
