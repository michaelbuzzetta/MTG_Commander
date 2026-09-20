import test from 'node:test';
import assert from 'node:assert/strict';
import { OracleTemplateCompiler } from '../src/cards/compiler/OracleTemplateCompiler.js';
import { engine } from './helpers.js';
import { makeCardInstance } from '../src/engine/GameState.js';
import { DependencyResolver, LAYER } from '../src/engine/continuous/index.js';

const compiler = new OracleTemplateCompiler();

test('Phase 22: fixed Equipment Oracle text compiles into attachment metadata and continuous bonus', () => {
  const r = compiler.compileCard({ id:'eq', name:'Test Gear', typeLine:'Artifact — Equipment', oracleText:'Equipped creature gets +2/+2.\nEquip {2}', keywords:[] });
  assert.equal(r.autoAccepted, true);
  assert.equal(r.compiledCard.equipCost, '{2}');
  assert.equal(r.compiledCard.abilities[0].filter.attachedToSource, true);
  assert.equal(r.compiledCard.abilities[0].effect.power, 2);
});

test('Phase 22: creature Aura Oracle text compiles host restriction and attached continuous effect', () => {
  const r = compiler.compileCard({ id:'aura', name:'Test Aura', typeLine:'Enchantment — Aura', oracleText:'Enchant creature\nEnchanted creature gets +1/+1.', keywords:[] });
  assert.equal(r.autoAccepted, true);
  assert.equal(r.compiledCard.enchantFilter.type, 'Creature');
  assert.equal(r.compiledCard.abilities[0].filter.attachedToSource, true);
});

test('Phase 23: attached bonus is derived and disappears after detach', () => {
  const e=engine();
  e._registerRuntimeCardDefinition('gear',{id:'gear',name:'gear',typeLine:'Artifact — Equipment',subtypes:['Equipment'],equipCost:'{1}',abilities:[{type:'static',filter:{attachedToSource:true},effect:{power:2,toughness:2}}],oracleText:'',supported:true});
  e._registerRuntimeCardDefinition('bear',{id:'bear',name:'bear',typeLine:'Creature — Bear',subtypes:['Bear'],power:2,toughness:2,abilities:[],oracleText:'',supported:true});
  const gear=makeCardInstance('gear','player','battlefield',{},e.db.gear), bear=makeCardInstance('bear','player','battlefield',{},e.db.bear);
  e.zones.place(gear,'battlefield','player'); e.zones.place(bear,'battlefield','player');
  e.attachPermanent(gear,bear,{attachmentType:'equipment'}); assert.equal(e.getDerivedStats(bear).power,4);
  e.detachPermanent(gear); assert.equal(e.getDerivedStats(bear).power,2);
});

test('Phase 24: same-layer dependencies override timestamp order', () => {
  const r=new DependencyResolver();
  const ordered=r.order([
    {id:'later-dependent',layer:LAYER.ABILITY,timestamp:1,dependsOn:['base']},
    {id:'base',layer:LAYER.ABILITY,timestamp:9,dependsOn:[]}
  ]);
  assert.deepEqual(ordered.map(x=>x.id),['base','later-dependent']);
});
