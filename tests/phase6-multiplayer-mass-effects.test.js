import test from 'node:test';
import assert from 'node:assert/strict';
import { OracleTemplateCompiler } from '../src/cards/compiler/OracleTemplateCompiler.js';

const compiler = new OracleTemplateCompiler();
function compile(text) { return compiler.compileCard({ id: text, name: 'Test', oracleText: text, layout: 'normal', typeLine: 'Sorcery', keywords: [] }); }

test('each opponent life loss compiles to multiplayer forEach', () => {
  const out = compile('Each opponent loses 2 life.');
  assert.equal(out.status, 'compiled');
  const fx = out.compiledCard.spellEffects[0];
  assert.equal(fx.type, 'scriptForEach');
  assert.deepEqual(fx.selector, { kind: 'player', player: 'opponent' });
  assert.equal(fx.effect.type, 'loseLife');
  assert.deepEqual(fx.effect.player, { variable: 'affectedPlayer' });
});

test('mass creature operations compile without targets', () => {
  for (const [text, expected] of [['Destroy all creatures.','destroy'], ['Exile all creatures.','exile'], ['Tap all creatures you control.','scriptTap'], ['Untap all creatures you control.','untap']]) {
    const out = compile(text); assert.equal(out.status, 'compiled', text);
    assert.equal(out.compiledCard.spellEffects[0].type, 'scriptForEach');
    assert.equal(out.compiledCard.spellEffects[0].effect.type, expected);
  }
});

test('each player draw compiles with a player variable recipient', () => {
  const out = compile('Each player draws a card.');
  assert.equal(out.status, 'compiled');
  assert.deepEqual(out.compiledCard.spellEffects[0].effect.player, { variable: 'affectedPlayer' });
});
