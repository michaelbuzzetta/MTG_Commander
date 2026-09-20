import test from 'node:test';
import assert from 'node:assert/strict';
import { OracleTemplateCompiler } from '../src/cards/compiler/OracleTemplateCompiler.js';
import { CardScriptCompiler } from '../src/cards/scripts/CardScriptCompiler.js';

const oracle = new OracleTemplateCompiler();
const scripts = new CardScriptCompiler();
const compile = card => {
  const r = oracle.compileCard({ id:'x', name:'Test', manaCost:'{1}', ...card });
  assert.equal(r.status, 'compiled', r.diagnostics?.join('; '));
  return r.compiledCard;
};

test('phase 13: choose-one spell compiles into locked modes', () => {
  const c = compile({ typeLine:'Instant', oracleText:'Choose one —\n• Draw two cards.\n• You gain 4 life.' });
  assert.equal(c.modes.length, 2);
  assert.equal(c.modes[0].effects[0].type, 'draw');
  assert.equal(c.modes[1].effects[0].type, 'gainLife');
});

test('phase 13: one-or-both untargeted spell exposes exact combined mode', () => {
  const c = compile({ typeLine:'Sorcery', oracleText:'Choose one or both —\n• Draw a card.\n• You gain 2 life.' });
  assert.equal(c.modes.length, 3);
  assert.equal(c.modes[2].effects[0].type, 'sequence');
});

test('phase 14: up-to-one targeting preserves zero-to-one target bounds', () => {
  const c = compile({ typeLine:'Instant', oracleText:'Exile up to one target creature.' });
  assert.equal(c.targets.minTargets, 0);
  assert.equal(c.targets.maxTargets, 1);
});

test('phase 15: opponent-cast and other-creature triggers compile declaratively', () => {
  const a = compile({ typeLine:'Enchantment', oracleText:'Whenever an opponent casts a spell, draw a card.' });
  assert.equal(a.abilities[0].condition.eventController, 'opponent');
  const b = compile({ typeLine:'Creature — Human Wizard', oracleText:'Whenever another creature enters under your control, draw a card.' });
  assert.equal(b.abilities[0].condition.notSelfEvent, true);
  assert.equal(b.abilities[0].condition.cardType, 'Creature');
});
