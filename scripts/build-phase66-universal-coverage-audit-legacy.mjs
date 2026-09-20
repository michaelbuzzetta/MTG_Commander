#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OracleTemplateCompiler } from '../src/cards/compiler/OracleTemplateCompiler.js';
import { normalizeOracleText } from '../src/cards/compiler/OracleTokenizer.js';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const candidates=['dist/data/scryfall-card-catalog.json','src/data/updates/step43-catalog-snapshot.json'];
const source=candidates.find(f=>fs.existsSync(path.join(ROOT,f)));
if(!source) throw new Error('Step 66 requires a complete Oracle catalog snapshot.');
const payload=JSON.parse(fs.readFileSync(path.join(ROOT,source),'utf8'));
const cards=payload.cards||payload;
if(!Array.isArray(cards)||!cards.length) throw new Error('Step 66 catalog snapshot is empty.');

const compiler=new OracleTemplateCompiler();
const rows=[]; const unmatched=new Map();
const summary={fullyExecutable:0,partiallyRecognized:0,manualReview:0,compilerFailures:0,explicitNonDigitalExceptions:0};
const physicalPatterns=[
  /physically throw/i,/from a height of at least one foot/i,/balance .* on/i,
  /outside the game/i, /ask a person outside the game/i, /high five/i,
  /under your clothes/i, /touching .* card/i, /artist/i, /flavor text/i,
  /sticker/i, /attraction/i
];
function paragraphs(card){
  const raw=normalizeOracleText(card.oracleText||card.oracle_text||'').split('\n').map(x=>x.trim()).filter(x=>x&&x!=='//');
  const out=[];
  for(let i=0;i<raw.length;i++){
    if(/^(?:When this creature enters, )?choose (?:one|two|three|one or both|one or more)(?:\. If you control a commander as you cast this spell, you may choose both instead)? [—-]$/i.test(raw[i])){
      const grouped=[raw[i]];
      while(i+1<raw.length&&/^•\s*/.test(raw[i+1])) grouped.push(raw[++i]);
      out.push(grouped.join('\n'));
    } else out.push(raw[i]);
  }
  return out;
}
function isExplicitPhysical(text){return physicalPatterns.some(re=>re.test(text));}
const paragraphMatchCache=new Map();
function paragraphMatched(card,p){
  // Template eligibility can depend on card type (spell, Aura, land, Equipment,
  // and other structural families), so include typeLine in the deterministic
  // cache key rather than assuming only instants/sorceries are sensitive.
  const key=`${card.typeLine||''}\u0000${p}`;
  if(paragraphMatchCache.has(key)) return paragraphMatchCache.get(key);
  // Use the compiler's authoritative ambiguity policy here too. Multiple
  // high-confidence exact templates with byte-for-byte equivalent semantics
  // are executable and must not be misclassified as unmatched by the audit.
  const analysis=compiler.analyzeCard({...card,oracleText:p});
  const ok=analysis.status==='matched'&&analysis.confidence==='high';
  paragraphMatchCache.set(key,ok);
  return ok;
}
for(const card of cards){
  const text=card.oracleText||card.oracle_text||'';
  try{
    const ps=paragraphs(card); let hits=0; const misses=[];
    for(const p of ps){if(paragraphMatched(card,p)) hits++; else {misses.push(p); unmatched.set(p,(unmatched.get(p)||0)+1);}}
    // Full compilation/validation is the expensive path. Only attempt it when
    // every paragraph is already known to have exact executable semantics, or
    // for single-paragraph cards where a whole-card template may apply.
    if(hits===ps.length || ps.length<=1){
      const r=compiler.compileCard(card);
      if(r.autoAccepted){summary.fullyExecutable++; rows.push({id:card.id,name:card.name,status:'fully_executable',templates:r.matchedTemplates});continue;}
    }
    if(isExplicitPhysical(text)){summary.explicitNonDigitalExceptions++; rows.push({id:card.id,name:card.name,status:'explicit_non_digital_exception',matchedParagraphs:hits,totalParagraphs:ps.length,unmatchedParagraphs:misses.slice(0,20)});}
    else if(hits>0){summary.partiallyRecognized++; rows.push({id:card.id,name:card.name,status:'partially_recognized',matchedParagraphs:hits,totalParagraphs:ps.length,unmatchedParagraphs:misses.slice(0,20)});}
    else {summary.manualReview++; rows.push({id:card.id,name:card.name,status:'manual_review',matchedParagraphs:0,totalParagraphs:ps.length,unmatchedParagraphs:misses.slice(0,20)});}
  }catch(e){summary.compilerFailures++; rows.push({id:card.id,name:card.name,status:'compiler_failure',error:e.message});}
}
const digitallyRepresentable=cards.length-summary.explicitNonDigitalExceptions;
const unresolvedDigital=summary.partiallyRecognized+summary.manualReview+summary.compilerFailures;
const report={schema:'mtg-phase66-universal-coverage-audit-v1',generatedAt:new Date().toISOString(),source,sourceDeclaredComplete:payload.complete===true,sourceDeclaredCount:payload.count||cards.length,totalCatalogEntries:cards.length,summary,digitallyRepresentable,unresolvedDigital,coverage:{fullyExecutableCatalogPct:+(100*summary.fullyExecutable/cards.length).toFixed(2),fullyExecutableDigitalPct:+(100*summary.fullyExecutable/Math.max(1,digitallyRepresentable)).toFixed(2)},releaseGate:{passed:unresolvedDigital===0,requirement:'Every digitally representable catalog entry must compile to executable behavior; physical-only exceptions must be explicit.'},topUnmatchedParagraphs:[...unmatched].sort((a,b)=>b[1]-a[1]).slice(0,500).map(([text,count])=>({text,count})),cards:rows};
fs.mkdirSync(path.join(ROOT,'coverage'),{recursive:true});
fs.writeFileSync(path.join(ROOT,'coverage/phase66-universal-coverage-audit.json'),JSON.stringify(report,null,2)+'\n');
const md=`# Step 66 — Universal Coverage Audit\n\nCatalog entries audited: **${cards.length}**\n\n- Fully executable: **${summary.fullyExecutable}**\n- Partially recognized: **${summary.partiallyRecognized}**\n- Manual review: **${summary.manualReview}**\n- Compiler failures: **${summary.compilerFailures}**\n- Explicit non-digital/physical exceptions: **${summary.explicitNonDigitalExceptions}**\n- Digitally representable unresolved entries: **${unresolvedDigital}**\n- Full executable catalog coverage: **${report.coverage.fullyExecutableCatalogPct}%**\n- Release gate: **${report.releaseGate.passed?'PASS':'FAIL'}**\n\nThe gate intentionally fails closed. Recognition, database presence, or partial parsing is not counted as implementation.\n`;
fs.writeFileSync(path.join(ROOT,'PHASE66_UNIVERSAL_COVERAGE_AUDIT.md'),md);
console.log(`Step 66 audit: ${cards.length} total; ${summary.fullyExecutable} executable; ${summary.partiallyRecognized} partial; ${summary.manualReview} manual; ${summary.compilerFailures} failures; ${summary.explicitNonDigitalExceptions} physical exceptions; gate ${report.releaseGate.passed?'PASS':'FAIL'}.`);
if(process.argv.includes('--gate') && !report.releaseGate.passed) process.exitCode=1;
