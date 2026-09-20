import test from 'node:test';
import assert from 'node:assert/strict';
import { OracleTemplateCompiler } from '../src/cards/compiler/OracleTemplateCompiler.js';

const compiler = new OracleTemplateCompiler();
function compile(name, oracleText) { return compiler.compileCard({ id:name, name, typeLine:'Creature — Test', oracleText }); }

test('named ETB modal labels compile to executable modes', () => {
  const r=compile('Dawnbringer-like', 'When this creature enters, choose one —\n• Cure Wounds — You gain 2 life.\n• Dispel Magic — Destroy target enchantment.\n• Gentle Repose — Exile target card from a graveyard.');
  assert.equal(r.autoAccepted,true);
  assert.equal(r.compiledCard.abilities[0].modes.length,3);
});
test('ETB modal nonland tap/untap compiles',()=>{
  const r=compile('Ant-like','When this creature enters, choose one —\n• Tap target nonland permanent.\n• Untap target nonland permanent.');
  assert.equal(r.autoAccepted,true); assert.equal(r.compiledCard.abilities[0].modes.length,2);
});
test('ETB modal artifact/enchantment recursion compiles',()=>{
  const r=compile('Retriever-like','When this creature enters, choose one —\n• Put a +1/+1 counter on this creature.\n• Return target artifact or enchantment card from your graveyard to your hand.');
  assert.equal(r.autoAccepted,true);
});
