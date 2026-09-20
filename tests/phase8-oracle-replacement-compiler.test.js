import test from 'node:test';
import assert from 'node:assert/strict';
import { OracleTemplateCompiler } from '../src/cards/compiler/OracleTemplateCompiler.js';
import { engine } from './helpers.js';
import { makeCardInstance } from '../src/engine/GameState.js';
import { ENGINE_EVENT } from '../src/engine/events/EventTypes.js';

const compiler = new OracleTemplateCompiler();
function compile(id, oracleText, typeLine = 'Enchantment') {
  const result = compiler.compileCard({ id, name: id, oracleText, typeLine });
  assert.equal(result.autoAccepted, true, result.diagnostics?.join('; '));
  return result.compiledCard;
}

test('Phase 8: common replacement/prevention Oracle families compile declaratively', () => {
  const fixtures = [
    ['life', 'If you would gain life, you gain twice that much life instead.'],
    ['tokens', 'If you would create one or more tokens, create twice that many of those tokens instead.'],
    ['counters', 'If one or more +1/+1 counters would be put on a creature you control, that many plus one +1/+1 counters are put on it instead.'],
    ['dies', 'If a creature would die, exile it instead.'],
    ['prevent', 'If damage would be dealt to you, prevent that damage.'],
  ];
  for (const [id, text] of fixtures) assert.equal(compile(id, text).abilities[0].type, 'replacement');
});

test('Phase 8: a compiled self entry replacement works before the source reaches the battlefield', () => {
  const e = engine();
  const definition = compile('phase8-tapped-land', 'This permanent enters tapped.', 'Land');
  e.db['phase8-tapped-land'] = definition;
  const card = makeCardInstance('phase8-tapped-land', 'player', 'hand', { controller: 'player' }, definition);
  e.state.players.player.hand.push(card);
  const moved = e.events.dispatch(ENGINE_EVENT.MOVE_ZONE, {
    cardInstanceId: card.instanceId,
    toZone: 'battlefield',
    toPlayerId: 'player',
    reason: 'phase8-self-entry'
  }, { cause: 'phase8-self-entry' });
  assert.equal(moved.tapped, true);
});

test('Phase 8: replacement filters include zone and counter constraints without broadening targets', () => {
  const dies = compile('phase8-dies', 'If a creature would die, exile it instead.');
  assert.deepEqual(dies.abilities[0].filter, { type: 'Creature', fromZone: 'battlefield', toZone: 'graveyard' });
  const counters = compile('phase8-counters', 'If one or more +1/+1 counters would be put on a creature you control, that many plus one +1/+1 counters are put on it instead.');
  assert.equal(counters.abilities[0].filter.counterType, '+1/+1');
});
