import test from 'node:test';
import assert from 'node:assert/strict';
import { OracleTemplateCompiler } from '../src/cards/compiler/OracleTemplateCompiler.js';
import { EffectPrimitiveLibrary } from '../src/cards/scripts/EffectPrimitiveLibrary.js';

const compiler = new OracleTemplateCompiler();

function compile(card) {
  const result = compiler.compileCard({ id: card.name, name: card.name, typeLine: card.typeLine || 'Sorcery', oracleText: card.oracleText });
  assert.equal(result.status, 'compiled', result.diagnostics?.join('; '));
  return result;
}

test('Phase 28: Suspend compiles to declarative special-action metadata', () => {
  const { script } = compile({ name: 'Suspend Fixture', typeLine: 'Creature', oracleText: 'Suspend 4—{1}{U}' });
  assert.deepEqual(script.metadata.cardPatch.suspend, { timeCounters: 4, cost: '{1}{U}' });
});

test('Phase 29: Cascade compiles to authoritative library-operation primitive', () => {
  const { script } = compile({ name: 'Cascade Fixture', typeLine: 'Creature', oracleText: 'Cascade' });
  assert.equal(script.abilities[0].event, 'SPELL_CAST');
  assert.equal(script.abilities[0].effect.op, 'cascade');
});

test('Phase 29: Discover fixed value compiles', () => {
  const { script } = compile({ name: 'Discover Fixture', oracleText: 'Discover 4.' });
  assert.equal(script.abilities[0].effect.op, 'discover');
  assert.equal(script.abilities[0].effect.amount, 4);
});

test('Phase 29 primitives are registered and lower without custom card hooks', () => {
  const lib = new EffectPrimitiveLibrary();
  assert.deepEqual(lib.lower({ op: 'cascade' }), { type: 'cascade' });
  assert.deepEqual(lib.lower({ op: 'discover', amount: 3 }), { type: 'discover', amount: 3 });
});

test('Phase 30: linked temporary exile remains a generalized source-linked primitive', () => {
  const { script } = compile({ name: 'Linked Fixture', typeLine: 'Creature', oracleText: 'When this creature enters the battlefield, exile target creature an opponent controls until this permanent leaves the battlefield.' });
  assert.equal(script.abilities[0].effect.op, 'exileUntilSourceLeaves');
  assert.equal(script.abilities[0].targets.controller, 'opponent');
});
