import test from 'node:test'; import assert from 'node:assert/strict'; import { OracleTemplateCompiler } from '../src/cards/compiler/OracleTemplateCompiler.js';
const c=new OracleTemplateCompiler();
const card=(oracleText,typeLine='Creature')=>c.compileCard({id:'phase48',name:'Phase Test',typeLine,keywords:[],oracleText});
test('Step46: Aura and Equipment self-ETB wording uses the normal ETB pipeline',()=>{assert.equal(card('When this Aura enters, draw a card.','Enchantment — Aura').autoAccepted,true); assert.equal(card('When this Equipment enters, you gain 2 life.','Artifact — Equipment').autoAccepted,true);});
test('Step46: upkeep payloads compile',()=>{assert.equal(card('At the beginning of your upkeep, draw two cards.').autoAccepted,true); assert.equal(card('At the beginning of your upkeep, create a Treasure token.').autoAccepted,true);});
test('Step47: end-step payloads compile',()=>{assert.equal(card('At the beginning of your end step, you gain 2 life.').autoAccepted,true); assert.equal(card('At the beginning of your end step, create two Food tokens.').autoAccepted,true);});
test('Step47: attack and dies life triggers compile',()=>{assert.equal(card('Whenever this creature attacks, you gain 2 life.').autoAccepted,true); assert.equal(card('When this creature dies, you gain 3 life.').autoAccepted,true);});
test('Step48: controlled-creature death trigger compiles',()=>{const r=card('Whenever another creature you control dies, draw a card.','Enchantment'); assert.equal(r.autoAccepted,true); assert.equal(r.script.abilities[0].event,'CREATURE_DIED');});
