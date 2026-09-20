import test from 'node:test';
import assert from 'node:assert/strict';
import { MultiplayerRelationService } from '../src/engine/multiplayer/MultiplayerRelations.js';
import { MonarchService } from '../src/engine/multiplayer/MonarchService.js';
import { OracleTemplateCompiler } from '../src/cards/compiler/OracleTemplateCompiler.js';
import { ORACLE_PARSER_VERSION } from '../src/cards/compiler/OracleTokenizer.js';

test('Step 32 APNAP order begins with active player and skips eliminated players', () => {
  const engine = { state: { activePlayer:'ai', playerOrder:['player','ai','ai2','ai3'], players:{ player:{}, ai:{}, ai2:{lost:true}, ai3:{} } } };
  const svc = new MultiplayerRelationService(engine);
  assert.deepEqual(svc.apnapOrder(), ['ai','ai3','player']);
  const groups = svc.apnapGroups([{controller:'player',id:1},{controller:'ai3',id:2},{controller:'ai',id:3}]);
  assert.deepEqual(groups.map(g => g.playerId), ['ai','ai3','player']);
});

test('Step 31 monarch transfers to a creature controller that deals combat damage to monarch', () => {
  const calls=[];
  const engine={ state:{monarch:'player',players:{player:{},ai:{}}}, events:{dispatch:(type,payload)=>{calls.push({type,payload}); engine.state.monarch=payload.playerId; return payload;}}, draw:()=>{} };
  const svc=new MonarchService(engine);
  svc.onCombatDamage({controller:'ai',targetPlayer:'player',amount:3});
  assert.equal(engine.state.monarch,'ai');
  assert.equal(calls.length,1);
});

test('Step 31 Oracle compiler recognizes become-the-monarch effects', () => {
  const compiler=new OracleTemplateCompiler();
  const result=compiler.compileCard({name:'Court Test',typeLine:'Enchantment',oracleText:'When this enchantment enters, you become the monarch.'});
  assert.equal(result.status,'compiled');
  assert.equal(result.script.abilities[0].effect.op,'becomeMonarch');
});

test('Step 31-33 parser version is v4.5.0', () => assert.equal(ORACLE_PARSER_VERSION,'4.5.0'));

test('Step 33 simultaneous dispatcher shares batch metadata and defers trigger flush', async () => {
  const { EventDispatcher } = await import('../src/engine/events/EventDispatcher.js');
  let deferrals=0, stabilized=0;
  const engine={ state:{pendingChoice:null}, _withDeferredTriggers(fn){ deferrals++; return fn(); }, stateBasedActions(){stabilized++;} };
  const dispatcher=new EventDispatcher(engine);
  const seen=[];
  dispatcher.dispatch=(type,payload,options)=>{ seen.push({type,payload,options}); return payload; };
  const result=dispatcher.dispatchSimultaneous([{type:'A',payload:{x:1}},{type:'B',payload:{x:2}}]);
  assert.equal(deferrals,1);
  assert.equal(stabilized,1);
  assert.equal(seen[0].payload.simultaneousBatchId, seen[1].payload.simultaneousBatchId);
  assert.deepEqual(seen.map(x=>x.payload.simultaneousIndex),[0,1]);
  assert.equal(result.results.length,2);
});
