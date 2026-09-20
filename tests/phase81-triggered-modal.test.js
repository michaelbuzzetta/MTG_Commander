import test from 'node:test';
import assert from 'node:assert/strict';
import { OracleTemplateCompiler } from '../src/cards/compiler/OracleTemplateCompiler.js';
const compiler = new OracleTemplateCompiler();

test('ETB choose-one lowers to executable triggered modes', () => {
  const r=compiler.compileCard({id:'modal-etb',name:'Modal ETB',typeLine:'Creature — Test',oracleText:'When this creature enters, choose one —\n• Destroy target artifact.\n• You gain 3 life.'});
  assert.equal(r.status,'compiled');
  const a=r.compiledCard.abilities[0];
  assert.equal(a.type,'triggered'); assert.equal(a.event,'ENTER_BATTLEFIELD'); assert.equal(a.modes.length,2);
  assert.equal(a.modes[0].effect.type,'destroy'); assert.equal(a.modes[1].effect.type,'gainLife');
});

test('ETB modal composes with an independent keyword paragraph', () => {
  const r=compiler.compileCard({id:'modal-trample',name:'Modal Trampler',typeLine:'Creature — Beast',keywords:['Trample'],oracleText:'Trample\nWhen this creature enters, choose one —\n• Destroy target artifact or enchantment.\n• Draw a card.'});
  assert.equal(r.status,'compiled'); assert.ok(r.compiledCard.keywords.map(x=>x.toLowerCase()).includes('trample')); assert.equal(r.compiledCard.abilities[0].modes.length,2);
});
