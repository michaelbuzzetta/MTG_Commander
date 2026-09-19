import test from 'node:test';
import assert from 'node:assert/strict';
import { engine, putBattlefield } from './helpers.js';

test('Step 12: lethal creatures are collected into one simultaneous SBA batch', () => {
  const e = engine();
  const a = putBattlefield(e, 'player', 'grizzly-bears', { damageMarked: 2 });
  const b = putBattlefield(e, 'ai', 'grizzly-bears', { damageMarked: 2 });
  e.stateBasedActions();
  assert.equal(e.findPermanent(a.instanceId), null);
  assert.equal(e.findPermanent(b.instanceId), null);
  const batch = [...e.state.history].reverse().find(item => item.type === 'SBA_BATCH');
  assert.ok(batch);
  const deaths = batch.actions.filter(action => action.type === 'graveyard' && action.died);
  assert.equal(deaths.length, 2);
});

test('Step 12: +1/+1 and -1/-1 counters cancel as a state-based action', () => {
  const e = engine();
  const bear = putBattlefield(e, 'player', 'grizzly-bears', { counters: { '+1/+1': 3, '-1/-1': 2 } });
  e.stateBasedActions();
  assert.equal(bear.counters['+1/+1'], 1);
  assert.equal(bear.counters['-1/-1'], undefined);
});

test('Step 12: poison, empty-library, life, and commander-damage losses are centralized', () => {
  for (const configure of [
    p => { p.life = 0; },
    p => { p.counters.poison = 10; },
    p => { p.drewFromEmptyLibrary = true; },
    p => { p.commanderDamage['commander-x'] = 21; }
  ]) {
    const e = engine();
    configure(e.state.players.ai);
    e.stateBasedActions();
    assert.equal(e.state.players.ai.lost, true);
    assert.equal(e.state.winner, 'player');
  }
});

test('Step 12: indestructible does not prevent zero-toughness SBA', () => {
  const e = engine();
  const god = putBattlefield(e, 'player', 'indestructible-god', { modifiers: { power: 0, toughness: -4, keywords: [] } });
  e.stateBasedActions();
  assert.equal(e.findPermanent(god.instanceId), null);
});

test('Step 12: legend rule opens a choice before priority can continue', () => {
  const e = engine();
  const first = putBattlefield(e, 'player', 'indestructible-god');
  const second = putBattlefield(e, 'player', 'indestructible-god');
  e.stateBasedActions();
  assert.equal(e.state.pendingChoice?.type, 'LEGEND_RULE');
  assert.deepEqual(new Set(e.state.pendingChoice.permanentIds), new Set([first.instanceId, second.instanceId]));
  assert.equal(e.state.priorityPlayer, 'player');
});

test('Step 12: tokens outside the battlefield cease to exist', () => {
  const e = engine();
  const token = { ...putBattlefield(e, 'player', 'grizzly-bears'), isToken: true };
  // Remove the helper-created battlefield object then place a token-shaped card in graveyard.
  const original = e.state.players.player.battlefield.pop();
  token.instanceId = original.instanceId;
  token.zone = 'graveyard';
  e.state.players.player.graveyard.push(token);
  e.stateBasedActions();
  assert.equal(e.zones.find(token.instanceId), null);
});

test('Step 12: illegal Equipment attachment is detached without destroying Equipment', () => {
  const e = engine();
  e._registerRuntimeCardDefinition('test-equipment', { id: 'test-equipment', name: 'Test Equipment', typeLine: 'Artifact — Equipment', keywords: [], abilities: [] });
  const land = putBattlefield(e, 'player', 'forest');
  const equipment = putBattlefield(e, 'player', 'test-equipment', { attachedTo: land.instanceId });
  e.stateBasedActions();
  assert.ok(e.findPermanent(equipment.instanceId));
  assert.equal(equipment.attachedTo, null);
});
