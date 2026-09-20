import test from 'node:test';
import assert from 'node:assert/strict';
import { OracleTemplateCompiler } from '../src/cards/compiler/OracleTemplateCompiler.js';

function compile(name, oracleText, typeLine='Creature — Test') {
  return new OracleTemplateCompiler().compileCard({ id:name.toLowerCase().replace(/\W+/g,'-'), name, oracleText, typeLine, manaCost:'{1}', layout:'normal' });
}

test('fixed -1/-1 enters counters compile to executable ETB replacement', () => {
  const r=compile('Scarred Test','This creature enters with two -1/-1 counters on it.');
  assert.equal(r.status,'compiled');
  const a=r.compiledCard.abilities[0];
  assert.equal(a.type,'replacement');
  assert.equal(a.effect.kind,'enterWithCounters');
  assert.equal(a.effect.counter,'-1/-1');
  assert.equal(a.effect.amount,2);
});

test('global life-gain prohibition compiles as GAIN_LIFE replacement', () => {
  const r=compile('No Life Test',"Players can't gain life.",'Enchantment');
  assert.equal(r.status,'compiled');
  assert.equal(r.compiledCard.abilities[0].event,'GAIN_LIFE');
  assert.equal(r.compiledCard.abilities[0].effect.kind,'preventLifeGain');
});

