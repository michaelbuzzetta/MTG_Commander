import test from 'node:test';
import assert from 'node:assert/strict';
import { OracleTemplateCompiler } from '../src/cards/compiler/OracleTemplateCompiler.js';
const compiler = new OracleTemplateCompiler();

test('energy ETB accepts canonical reminder text followed by punctuation', () => {
  const r = compiler.compileCard({ id:'energy', name:'Energy Test', layout:'normal', typeLine:'Creature — Test', oracleText:'When this creature enters, you get {E}{E} (two energy counters).' });
  assert.equal(r.status, 'compiled');
  assert.equal(r.compiledCard.abilities[0].event, 'ENTER_BATTLEFIELD');
  assert.equal(r.compiledCard.abilities[0].effect.type, 'addCounter');
  assert.equal(r.compiledCard.abilities[0].effect.amount, 2);
});

test('Aura can enchant an artifact or creature', () => {
  const r = compiler.compileCard({ id:'aura-ac', name:'Aura Test', layout:'normal', typeLine:'Enchantment — Aura', oracleText:'Enchant artifact or creature' });
  assert.equal(r.status, 'compiled');
  assert.deepEqual(r.compiledCard.enchantFilter.types, ['Artifact','Creature']);
});

test('Aura can enchant a creature or Vehicle', () => {
  const r = compiler.compileCard({ id:'aura-cv', name:'Aura Test 2', layout:'normal', typeLine:'Enchantment — Aura', oracleText:'Enchant creature or Vehicle' });
  assert.equal(r.status, 'compiled');
  assert.deepEqual(r.compiledCard.enchantFilter.types, ['Creature','Vehicle']);
});

test('overlapping one-color and generic activated-pump templates collapse to identical semantics', () => {
  const r = compiler.compileCard({ id:'pump', name:'Pump Test', layout:'normal', typeLine:'Creature — Test', oracleText:'{1}{R}: This creature gets +1/+0 until end of turn.' });
  assert.equal(r.status, 'compiled');
  assert.equal(r.compiledCard.abilities[0].effect.duration, 'untilEndOfTurn');
});

test('one-colored-mana activated pump also remains executable after semantic canonicalization', () => {
  const r = compiler.compileCard({ id:'pump2', name:'Pump Test 2', layout:'normal', typeLine:'Creature — Test', oracleText:'{R}: This creature gets +1/+0 until end of turn.' });
  assert.equal(r.status, 'compiled');
  assert.equal(r.autoAccepted, true);
});

test('Aura lockdown clauses compile to host restrictions consumed by attachment runtime', () => {
  const r = compiler.compileCard({ id:'lock', name:'Lock Aura', layout:'normal', typeLine:'Enchantment — Aura', oracleText:"Enchant creature\nEnchanted creature can't attack or block, and its activated abilities can't be activated." });
  assert.equal(r.status, 'compiled');
  assert.deepEqual(r.compiledCard.grantedRestrictions, {cantAttack:true,cantBlock:true,cantActivateAbilities:true});
});

import { engine } from './helpers.js';
import { makeCardInstance } from '../src/engine/GameState.js';

test('attached Aura grantedRestrictions are enforced by combat legality', () => {
  const e = engine();
  e._registerRuntimeCardDefinition('p80-host',{id:'p80-host',name:'Host',typeLine:'Creature — Test',subtypes:['Test'],manaCost:'{1}',power:2,toughness:2,keywords:[],abilities:[],oracleText:'',supported:true});
  e._registerRuntimeCardDefinition('p80-aura',{id:'p80-aura',name:'Lock Aura',typeLine:'Enchantment — Aura',subtypes:['Aura'],manaCost:'{1}',keywords:[],abilities:[],oracleText:"Enchant creature\nEnchanted creature can't attack.",enchantFilter:{kind:'permanent',type:'Creature'},grantedRestrictions:{cantAttack:true},supported:true});
  const host=makeCardInstance('p80-host','player','battlefield',{summoningSick:false,tapped:false},e.db['p80-host']);
  const aura=makeCardInstance('p80-aura','player','battlefield',{},e.db['p80-aura']);
  e.zones.place(host,'battlefield','player'); e.zones.place(aura,'battlefield','player');
  assert.ok(e.combat.legalAttackers('player').some(x=>x.instanceId===host.instanceId));
  e.attachPermanent(aura,host,{attachmentType:'aura'});
  assert.ok(!e.combat.legalAttackers('player').some(x=>x.instanceId===host.instanceId));
});
