import test from 'node:test';
import assert from 'node:assert/strict';
import { OracleTemplateCompiler } from '../src/cards/compiler/OracleTemplateCompiler.js';
import { engine } from './helpers.js';
import { makeCardInstance } from '../src/engine/GameState.js';

const compiler = new OracleTemplateCompiler();
const compile = (id, oracleText, extra = {}) => {
  const result = compiler.compileCard({ id, name: id, oracleText, typeLine: 'Creature — Shapeshifter', manaCost: '{2}{U}', power: '*', toughness: '*', ...extra });
  assert.equal(result.autoAccepted, true, result.diagnostics?.join('; '));
  return result.compiledCard;
};

test('Phase 25: characteristic-defining P/T compiles as a CDA and evaluates in layer 7a', () => {
  const d = compile('hand-cda', "This creature's power and toughness are each equal to the number of cards in your hand.");
  assert.equal(d.abilities[0].cda, true);
  const e = engine(); e.db[d.id] = d;
  const permanent = makeCardInstance(d.id, 'player', 'battlefield', { controller: 'player' }, d);
  e.state.players.player.battlefield.push(permanent);
  e.state.players.player.hand.push(makeCardInstance('island', 'player', 'hand'), makeCardInstance('island', 'player', 'hand'));
  const chars = e.continuous.characteristics(permanent);
  assert.equal(chars.power, e.state.players.player.hand.length); assert.equal(chars.toughness, e.state.players.player.hand.length);
});

test('Phase 26: upkeep transform compiles through the canonical transform event primitive', () => {
  const d = compile('werewolf-front', 'At the beginning of your upkeep, transform this creature.', { layout: 'transform', cardFaces: [
    { name: 'Front', typeLine: 'Creature — Human', power: '2', toughness: '2' },
    { name: 'Back', typeLine: 'Creature — Werewolf', power: '4', toughness: '4' }
  ]});
  assert.equal(d.abilities[0].effect.type, 'transformSelf');
});

test('Phase 27: morph compiles a three-mana face-down cast contract', () => {
  const d = compile('morpher', 'Morph {1}{U}');
  assert.equal(d.faceDownCasting.castOption, 'morph');
  assert.equal(d.faceDownCasting.manaCost, '{3}');
  assert.equal(d.faceDownCasting.faceUpCost, '{1}{U}');
});

test('Phase 27: disguise grants the face-down ward 2 contract', () => {
  const d = compile('disguiser', 'Disguise {2}{U}');
  const e = engine(); e.db[d.id] = d;
  const permanent = makeCardInstance(d.id, 'player', 'battlefield', { controller: 'player' }, d);
  permanent.faceDown = true; e.state.players.player.battlefield.push(permanent);
  assert.deepEqual(e.mechanics.wardCost(permanent), { mana: '{2}', life: 0 });
});
