import test from 'node:test';
import assert from 'node:assert/strict';
import { OracleTemplateCompiler } from '../src/cards/compiler/OracleTemplateCompiler.js';
const c = new OracleTemplateCompiler();
const card=(oracleText, extra={})=>({id:'x',name:'X',layout:'normal',typeLine:'Artifact',keywords:[],oracleText,...extra});
test('Step 37 compiles fixed and any-color mana abilities',()=>{
  let r=c.compileCard(card('{T}: Add {C}.')); assert.equal(r.autoAccepted,true); assert.deepEqual(r.compiledCard.abilities[0].mana,{C:1});
  r=c.compileCard(card('{T}: Add one mana of any color.')); assert.equal(r.autoAccepted,true); assert.equal(r.compiledCard.abilities[0].anyColor,true);
});
test('Step 38 compiles engine-backed rare/parameterized constructs',()=>{
  let r=c.compileCard(card('Ward {2}',{typeLine:'Creature',keywords:['Ward']})); assert.equal(r.autoAccepted,true); assert.equal(r.compiledCard.wardCost,'{2}');
  r=c.compileCard(card('Convoke (Your creatures can help cast this spell. Each creature you tap while casting this spell pays for {1} or one mana of that creature’s color.)',{typeLine:'Creature',keywords:['Convoke']})); assert.equal(r.autoAccepted,true);
  r=c.compileCard(card('Changeling (This card is every creature type.)',{typeLine:'Creature — Shapeshifter',keywords:['Changeling']})); assert.equal(r.autoAccepted,true);
  r=c.compileCard(card('Partner (You can have two commanders if both have partner.)',{typeLine:'Legendary Creature',keywords:['Partner']})); assert.equal(r.autoAccepted,true);
});
test('Step 39 interaction composition keeps mana + ETB + keyword semantics together',()=>{
  const r=c.compileCard(card('Flying\nWhen this creature enters, draw a card.\n{T}: Add {U}.',{typeLine:'Creature',keywords:['Flying']}));
  assert.equal(r.autoAccepted,true); assert.equal(r.compiledCard.abilities.some(a=>a.type==='mana'),true); assert.equal(r.compiledCard.abilities.some(a=>a.type==='triggered'),true);
});
test('Step 39 replacement + trigger + mana compose without semantic loss',()=>{
  const r=c.compileCard(card('This artifact enters tapped.\nWhen this artifact enters, you gain 1 life.\n{T}: Add {C}.',{typeLine:'Artifact'}));
  assert.equal(r.autoAccepted,true); assert.equal(r.compiledCard.abilities.some(a=>a.type==='replacement'),true); assert.equal(r.compiledCard.abilities.some(a=>a.type==='triggered'),true); assert.equal(r.compiledCard.abilities.some(a=>a.type==='mana'),true);
});
test('Step 39 ward composes with ETB trigger and combat keyword',()=>{
  const r=c.compileCard(card('Flying\nWard {2}\nWhen this creature enters, you gain 2 life.',{typeLine:'Creature',keywords:['Flying','Ward']}));
  assert.equal(r.autoAccepted,true); assert.equal(r.compiledCard.wardCost,'{2}'); assert.equal(r.compiledCard.abilities.some(a=>a.type==='triggered'),true);
});
