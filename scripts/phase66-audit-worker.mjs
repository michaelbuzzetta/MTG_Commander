import { parentPort, workerData } from 'node:worker_threads';
import { OracleTemplateCompiler } from '../src/cards/compiler/OracleTemplateCompiler.js';
import { normalizeOracleText } from '../src/cards/compiler/OracleTokenizer.js';

const compiler = new OracleTemplateCompiler();
const physicalPatterns=[/physically throw/i,/from a height of at least one foot/i,/balance .* on/i,/outside the game/i,/ask a person outside the game/i,/high five/i,/under your clothes/i,/touching .* card/i,/artist/i,/flavor text/i,/sticker/i,/attraction/i];
function paragraphs(card){
  const raw=normalizeOracleText(card.oracleText||card.oracle_text||'').split('\n').map(x=>x.trim()).filter(x=>x&&x!=='//');
  const out=[];
  for(let i=0;i<raw.length;i++){
    if(/^(?:When this creature enters, )?choose (?:one|two|three|one or both|one or more)(?:\. If you control a commander as you cast this spell, you may choose both instead)? [—-]$/i.test(raw[i])){
      const grouped=[raw[i]]; while(i+1<raw.length&&/^•\s*/.test(raw[i+1])) grouped.push(raw[++i]); out.push(grouped.join('\n'));
    } else out.push(raw[i]);
  }
  return out;
}
function isExplicitPhysical(text){return physicalPatterns.some(re=>re.test(text));}
const paragraphMatchCache=new Map();
function paragraphMatched(card,p){
  const key=`${card.typeLine||card.type_line||''}\u0000${p}`;
  if(paragraphMatchCache.has(key)) return paragraphMatchCache.get(key);
  const analysis=compiler.analyzeCard({...card,oracleText:p});
  const ok=analysis.status==='matched'&&analysis.confidence==='high'; paragraphMatchCache.set(key,ok); return ok;
}
const summary={fullyExecutable:0,partiallyRecognized:0,manualReview:0,compilerFailures:0,explicitNonDigitalExceptions:0};
const rows=[]; const unmatched=new Map();
for(const card of workerData.cards){
  const text=card.oracleText||card.oracle_text||'';
  try{
    const ps=paragraphs(card); let hits=0; const misses=[];
    for(const p of ps){if(paragraphMatched(card,p)) hits++; else {misses.push(p); unmatched.set(p,(unmatched.get(p)||0)+1);}}
    if(hits===ps.length || ps.length<=1){ const r=compiler.compileCard(card); if(r.autoAccepted){summary.fullyExecutable++; rows.push({id:card.id,name:card.name,status:'fully_executable',templates:r.matchedTemplates});continue;} }
    if(isExplicitPhysical(text)){summary.explicitNonDigitalExceptions++; rows.push({id:card.id,name:card.name,status:'explicit_non_digital_exception',matchedParagraphs:hits,totalParagraphs:ps.length,unmatchedParagraphs:misses.slice(0,20)});}
    else if(hits>0){summary.partiallyRecognized++; rows.push({id:card.id,name:card.name,status:'partially_recognized',matchedParagraphs:hits,totalParagraphs:ps.length,unmatchedParagraphs:misses.slice(0,20)});}
    else {summary.manualReview++; rows.push({id:card.id,name:card.name,status:'manual_review',matchedParagraphs:0,totalParagraphs:ps.length,unmatchedParagraphs:misses.slice(0,20)});}
  }catch(e){summary.compilerFailures++; rows.push({id:card.id,name:card.name,status:'compiler_failure',error:e.message});}
}
parentPort.postMessage({summary,rows,unmatched:[...unmatched]});
