import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import db from '../src/data/generated/cards.json' with { type: 'json' };
import decks from '../src/data/generated/decks.json' with { type: 'json' };
import { OracleTemplateCompiler } from '../src/cards/compiler/OracleTemplateCompiler.js';
import { GameEngine } from '../src/engine/GameEngine.js';
import { FuzzBot } from '../src/engine/fuzz/index.js';

const compiler=new OracleTemplateCompiler();
test('Step 40 compiler is deterministic across interleaved real-card pairs',()=>{
 const cards=Object.values(db).filter(c=>(c.oracleText||c.oracle_text)).slice(0,120); assert.ok(cards.length>=20);
 const norm=c=>({id:c.id,name:c.name,layout:c.layout||'normal',typeLine:c.typeLine||c.type_line||'',keywords:c.keywords||[],oracleText:c.oracleText||c.oracle_text||''});
 for(let i=0;i<Math.min(40,cards.length-1);i++){const a=norm(cards[i]),b=norm(cards[cards.length-1-i]); const x=compiler.compileCard(a); compiler.compileCard(b); const y=compiler.compileCard(a); assert.deepEqual(y.compiledCard,x.compiledCard);}
});
test('Step 41 seeded property fuzz preserves authoritative invariants',()=>{
 const playable=decks.filter(d=>d.playable!==false); const e=new GameEngine(playable[0],playable[1],db,{seed:'phase41-test',startingPlayer:'first',invariantChecks:true,allowPartialSimulationOverride:true,simulationPurpose:'phase41-test'});
 const r=new FuzzBot(e,{seed:'phase41-test',maxActions:30,persistFailures:false}).run(); assert.equal(r.ok,true); assert.equal(e.checkInvariants({throwOnFailure:false}).ok,true);
});
test('Step 42 performance instrumentation remains available after hardening',()=>{
 const playable=decks.filter(d=>d.playable!==false); const e=new GameEngine(playable[0],playable[1],db,{seed:'phase42-test',startingPlayer:'first',profilePerformance:true,performanceOptimizations:true,allowPartialSimulationOverride:true,simulationPurpose:'phase42-test'});
 e.start(); e.getLegalActions(e.state.pregame.currentPlayer); const p=e.getPerformanceSnapshot(); assert.ok(p && typeof p==='object');
});
test('Step 40 pair audit artifact is clean when present',()=>{ const p='coverage/phase40-card-pair-audit.json'; if(!fs.existsSync(p)) return; const r=JSON.parse(fs.readFileSync(p,'utf8')); assert.equal(r.passed,true); assert.equal(r.failures.length,0);});
