import test from 'node:test';
import assert from 'node:assert/strict';
import { OracleTemplateCompiler } from '../src/cards/compiler/OracleTemplateCompiler.js';
function rule(text){const r=new OracleTemplateCompiler().compileCard({id:'p77',name:'P77',oracleText:text,typeLine:'Enchantment',manaCost:'{2}',layout:'normal'});assert.equal(r.status,'compiled');const a=r.compiledCard.abilities[0];assert.equal(a.type,'static');assert.ok(a.ruleObject);return a.ruleObject;}
test('each opponent one-draw cap compiles to DRAW rule',()=>{const r=rule("Each opponent can't draw more than one card each turn.");assert.equal(r.operation,'DRAW');assert.equal(r.appliesTo,'opponent');assert.equal(r.maxPerTurn,1);});
test('each opponent one-spell cap compiles to CAST rule',()=>{const r=rule("Each opponent can't cast more than one spell each turn.");assert.equal(r.operation,'CAST');assert.equal(r.appliesTo,'opponent');assert.equal(r.maxPerTurn,1);});
