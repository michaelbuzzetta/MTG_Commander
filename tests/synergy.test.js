import test from 'node:test';
import assert from 'node:assert/strict';
import { engine, putBattlefield } from './helpers.js';

function resolveOne(e) {
  const first = e.state.priorityPlayer || e.state.activePlayer;
  e.state.priorityPlayer = first;
  e.state.passes = 0;
  e.perform(first, { type: 'PASS_PRIORITY' });
  e.perform(e.opponent(first), { type: 'PASS_PRIORITY' });
}

test('Evolution Sage proliferates when a land enters the battlefield', () => {
  const e = engine(); putBattlefield(e, 'player', 'evolution-sage'); const c = putBattlefield(e, 'player', 'grizzly-bears', { counters: { '+1/+1': 1 } }); const land = putBattlefield(e, 'player', 'forest');
  e.emit('ENTER_BATTLEFIELD', { controller: 'player', target: land, object: land, toZone: 'battlefield' }); assert.equal(e.state.stack.length, 1); resolveOne(e);
  assert.equal(e.state.pendingChoice?.type, 'PROLIFERATE');
  e.perform('player', { type: 'CHOOSE_PROLIFERATE', targetIds: [c.instanceId] });
  assert.equal(c.counters['+1/+1'], 2);
});
test('Deeproot Waters triggers on Merfolk spell cast', () => {
  const e = engine(); putBattlefield(e, 'player', 'deeproot-waters'); const card = { instanceId: 'spell1', cardId: 'merfolk-scout', owner: 'player', controller: 'player', zone: 'stack' };
  e.emit('SPELL_CAST', { controller: 'player', card }); assert.equal(e.state.stack.length, 1); resolveOne(e); assert.ok(e.state.players.player.battlefield.some(x => e.db[x.cardId]?.name === 'Merfolk Hexproof'));
});
test('Hakbal creates explore trigger at beginning of combat', () => { const e = engine(); putBattlefield(e, 'player', 'hakbal'); putBattlefield(e, 'player', 'merfolk-scout'); e.emit('BEGIN_COMBAT', { controller: 'player' }); assert.equal(e.state.stack.length, 1); });
test('Blech responds to life gain only for the custom creature types', () => {
  const e = engine('blech', 'explorers'); const blech = putBattlefield(e, 'player', 'blech'); const unrelated = putBattlefield(e, 'player', 'grizzly-bears'); e.changeLife('player', 1); assert.equal(e.state.stack.length, 1); resolveOne(e); assert.equal(blech.counters['+1/+1'], 1); assert.equal(unrelated.counters['+1/+1'] || 0, 0);
});
