import test from 'node:test';
import assert from 'node:assert/strict';
import { OracleTemplateCompiler } from '../src/cards/compiler/OracleTemplateCompiler.js';
const compile = oracleText => new OracleTemplateCompiler().compileCard({id:'p78',name:'Modal Test',typeLine:'Instant',manaCost:'{2}',layout:'normal',oracleText});
test('Phase 78 compiles modal damage modes',()=>{const r=compile('Choose one —\n• Modal Test deals 3 damage to target creature.\n• Destroy target artifact.');assert.equal(r.status,'compiled');assert.equal(r.compiledCard.modes.length,2);assert.equal(r.compiledCard.modes[0].effects[0].type,'damage');});
test('Phase 78 compiles generic creature-token modal payloads',()=>{const r=compile('Choose one —\n• Create two 1/1 Soldier creature tokens.\n• You gain 4 life.');assert.equal(r.status,'compiled');assert.equal(r.compiledCard.modes[0].effects[0].type,'createToken');assert.equal(r.compiledCard.modes[0].effects[0].amount,2);});
test('Phase 78 compiles modal temporary evergreen keyword grants',()=>{const r=compile('Choose one —\n• Target creature gains flying until end of turn.\n• Draw a card.');assert.equal(r.status,'compiled');assert.equal(r.compiledCard.modes[0].effects[0].type,'scriptGrantAbility');});
