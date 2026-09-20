import test from 'node:test';
import assert from 'node:assert/strict';
import { OracleTemplateCompiler } from '../src/cards/compiler/OracleTemplateCompiler.js';
import { GameEngine } from '../src/engine/GameEngine.js';

test('Phase 82 compiler recognizes Ascend reminder text', () => {
  const r = new OracleTemplateCompiler().compileCard({id:'ascend-test', name:'Ascend Test', typeLine:'Enchantment', oracleText:"Ascend (If you control ten or more permanents, you get the city's blessing for the rest of the game.)"});
  assert.equal(r.status, 'compiled');
  assert.equal(r.compiledCard.ascend, true);
  assert.ok(r.compiledCard.keywords.includes('ascend'));
});

test('Phase 82 permanent ascend grants and retains city blessing', () => {
  const db={c:{id:'c',name:'Commander',typeLine:'Legendary Creature — Test',colorIdentity:[]},a:{id:'a',name:'Ascender',typeLine:'Enchantment',ascend:true,keywords:['ascend']},x:{id:'x',name:'Thing',typeLine:'Artifact'}};
  const deck={commander:'c',cards:[{id:'c',quantity:1},{id:'a',quantity:1},{id:'x',quantity:98}]};
  const e=GameEngine.createGame(deck,[structuredClone(deck)],db,{skipPregame:true});
  const p=e.state.players.player;
  const asc=p.library.find(c=>c.cardId==='a'); const fillers=p.library.filter(c=>c.cardId==='x').slice(0,9); p.battlefield=[asc,...fillers].map(c=>({...c,zone:'battlefield',controller:'player'}));
  e.stateBasedActions(); assert.equal(p.citysBlessing,true);
  p.battlefield.splice(1,5); e.stateBasedActions(); assert.equal(p.citysBlessing,true);
});
