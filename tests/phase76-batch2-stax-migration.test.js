import test from 'node:test';
import assert from 'node:assert/strict';
import { OracleTemplateCompiler } from '../src/cards/compiler/OracleTemplateCompiler.js';
function rule(text){const r=new OracleTemplateCompiler().compileCard({id:'p76',name:'P76',oracleText:text,typeLine:'Enchantment',manaCost:'{2}',layout:'normal'});assert.equal(r.status,'compiled');const a=r.compiledCard.abilities[0];assert.equal(a.type,'static');assert.ok(a.ruleObject);return a.ruleObject;}
test('one attacker compiles to ATTACK object cap',()=>{const r=rule('No more than one creature can attack each combat.');assert.equal(r.operation,'ATTACK');assert.equal(r.maxObjects,1);});
test('one blocker compiles to BLOCK object cap',()=>{const r=rule('No more than one creature can block each combat.');assert.equal(r.operation,'BLOCK');assert.equal(r.maxObjects,1);});
test('attack tax compiles to per-attacker requirement',()=>{const r=rule("Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.");assert.equal(r.kind,'requirement');assert.equal(r.genericCostPerObject,2);assert.deepEqual(r.when,{targetPlayerIsSourceController:true});});
test('nonbasic freeze compiles to UNTAP restriction',()=>{const r=rule("Nonbasic lands don't untap during their controllers' untap steps.");assert.equal(r.operation,'UNTAP');assert.deepEqual(r.filter,{type:'Land',nonbasic:true});});
test('own-turn casting compiles to CAST timing restriction',()=>{const r=rule('Players can cast spells only during their own turns.');assert.equal(r.operation,'CAST');assert.deepEqual(r.when,{notOwnTurn:true});});
