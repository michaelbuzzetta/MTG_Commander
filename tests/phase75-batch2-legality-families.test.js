import test from 'node:test';
import assert from 'node:assert/strict';
import { OracleTemplateCompiler } from '../src/cards/compiler/OracleTemplateCompiler.js';

function compile(text) {
  return new OracleTemplateCompiler().compileCard({id:'phase75-test',name:'Phase 75 Test',oracleText:text,typeLine:'Enchantment',manaCost:'{2}',layout:'normal'});
}
function rule(text) {
  const r=compile(text); assert.equal(r.status,'compiled');
  const a=r.compiledCard.abilities[0]; assert.equal(a.type,'static'); assert.ok(a.ruleObject);
  return a.ruleObject;
}
test('Rule of Law family lowers to CAST legality rule',()=>{const r=rule("Each player can't cast more than one spell each turn."); assert.equal(r.operation,'CAST'); assert.equal(r.maxPerTurn,1); assert.equal(r.appliesTo,'each-player');});
test('opponent Rule of Law lowers with opponent scope',()=>{const r=rule("Your opponents can't cast more than one spell each turn."); assert.equal(r.operation,'CAST'); assert.equal(r.appliesTo,'opponent');});
test('players cannot search lowers to SEARCH legality rule',()=>{const r=rule("Players can't search libraries."); assert.equal(r.operation,'SEARCH'); assert.equal(r.appliesTo,'each-player');});
test('opponents cannot search preserves opponent scope',()=>{const r=rule("Your opponents can't search libraries."); assert.equal(r.operation,'SEARCH'); assert.equal(r.appliesTo,'opponent');});
test('one draw per turn lowers to DRAW legality rule',()=>{const r=rule("Each player can't draw more than one card each turn."); assert.equal(r.operation,'DRAW'); assert.equal(r.maxPerTurn,1);});
