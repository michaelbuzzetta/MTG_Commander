import test from 'node:test';
import assert from 'node:assert/strict';
import { engine, putBattlefield } from './helpers.js';
import { ENGINE_EVENT } from '../src/engine/events/EventTypes.js';

function addReplacement(e, definition) {
  return e.replacements.register(definition);
}

test('Step 10: multiple counter replacements are chosen by the affected controller and applied in that order', () => {
  const e = engine();
  putBattlefield(e, 'player', 'hardened-scales');
  putBattlefield(e, 'player', 'branching-evolution');
  const target = putBattlefield(e, 'player', 'grizzly-bears');

  const result = e.effects.addCounters('player', target, '+1/+1', 1);
  assert.equal(result?.deferred, true);
  assert.equal(e.state.pendingChoice?.type, 'REPLACEMENT_ORDER');
  assert.equal(e.state.pendingChoice?.playerId, 'player');
  const byEffect = new Map(e.state.pendingChoice.replacements.map(item => [item.effect, item.id]));
  e.perform('player', { type: 'ORDER_REPLACEMENTS', replacementIds: [byEffect.get('double'), byEffect.get('addOne')] });
  assert.equal(target.counters['+1/+1'], 3);

  const record = e.getEventLogSnapshot().filter(row => row.type === ENGINE_EVENT.ADD_COUNTER).at(-1);
  assert.deepEqual(record.replacementTrace.map(row => row.replacementId), [byEffect.get('double'), byEffect.get('addOne')]);
});

test('Step 10: a replacement cannot reapply to the same event even when its predicate remains true', () => {
  const e = engine();
  const before = e.state.players.player.life;
  addReplacement(e, {
    id: 'gain-plus-one',
    eventTypes: ENGINE_EVENT.GAIN_LIFE,
    affectedPlayer: event => event.payload.playerId,
    predicate: event => event.payload.playerId === 'player',
    transform: event => ({ ...event, payload: { ...event.payload, amount: Number(event.payload.amount) + 1 } })
  });

  e.changeLife('player', 2);
  assert.equal(e.state.players.player.life, before + 3);
  const record = e.getEventLogSnapshot().filter(row => row.type === ENGINE_EVENT.GAIN_LIFE).at(-1);
  assert.equal(record.replacementTrace.filter(row => row.replacementId === 'gain-plus-one').length, 1);
});

test('Step 10: replacement effects may replace an event with a different canonical event type', () => {
  const e = engine();
  const player = e.state.players.player;
  const handBefore = player.hand.length;
  const lifeBefore = player.life;
  addReplacement(e, {
    id: 'draw-becomes-life',
    eventTypes: ENGINE_EVENT.DRAW_CARD,
    affectedPlayer: event => event.payload.playerId,
    predicate: event => event.payload.playerId === 'player',
    transform: event => ({
      ...event,
      originalType: event.type,
      type: ENGINE_EVENT.GAIN_LIFE,
      payload: { playerId: event.payload.playerId, amount: 2 }
    })
  });

  e.draw('player');
  assert.equal(player.hand.length, handBefore, 'the replaced draw does not move a card');
  assert.equal(player.life, lifeBefore + 2, 'the replacement event uses the gain-life handler');
  const record = e.getEventLogSnapshot().filter(row => row.type === ENGINE_EVENT.GAIN_LIFE).at(-1);
  assert.equal(record.type, ENGINE_EVENT.GAIN_LIFE);
  assert.equal(record.replacementTrace[0].replacementId, 'draw-becomes-life');
});

test('Step 10: zone-change replacements can redirect a graveyard move before it commits', () => {
  const e = engine();
  const bear = putBattlefield(e, 'player', 'grizzly-bears');
  addReplacement(e, {
    id: 'graveyard-to-exile',
    eventTypes: ENGINE_EVENT.MOVE_ZONE,
    affectedPlayer: () => 'player',
    predicate: event => event.payload.toZone === 'graveyard',
    transform: event => ({ ...event, payload: { ...event.payload, toZone: 'exile' } })
  });

  e.destroy(bear);
  assert.equal(e.findPermanent(bear.instanceId), null);
  assert.ok(e.state.players.player.exile.some(card => card.instanceId === bear.instanceId));
  assert.ok(!e.state.players.player.graveyard.some(card => card.instanceId === bear.instanceId));
});

test('Step 10: entry replacements can make a permanent enter tapped and with counters', () => {
  const e = engine();
  const card = e.state.players.player.hand[0];
  assert.ok(card);
  addReplacement(e, {
    id: 'entry-state-test',
    eventTypes: ENGINE_EVENT.MOVE_ZONE,
    affectedPlayer: () => 'player',
    predicate: event => event.payload.cardInstanceId === card.instanceId && event.payload.toZone === 'battlefield',
    transform: event => ({
      ...event,
      payload: {
        ...event.payload,
        entryState: { tapped: true, counters: [{ type: '+1/+1', amount: 2 }] }
      }
    })
  });

  const moved = e.events.dispatch(ENGINE_EVENT.MOVE_ZONE, {
    cardInstanceId: card.instanceId,
    toZone: 'battlefield',
    toPlayerId: 'player',
    reason: 'step10-entry-test'
  }, { cause: 'step10-entry-test' });
  assert.equal(moved.tapped, true);
  assert.equal(moved.counters['+1/+1'], 2);
});

test('Step 10: token replacement effects use the generic event pipeline including Academy Manufactor', () => {
  const e = engine();
  putBattlefield(e, 'player', 'academy-manufactor');
  putBattlefield(e, 'player', 'parallel-lives');

  e.effects.createToken('player', { name: 'Treasure', typeLine: 'Artifact — Treasure' }, 1);
  assert.equal(e.state.pendingChoice, null, 'commutative token replacements do not require a meaningless order prompt');

  const utility = e.state.players.player.battlefield
    .map(card => e.db[card.cardId]?.name)
    .filter(name => ['Treasure', 'Food', 'Clue'].includes(name));
  assert.equal(utility.filter(name => name === 'Treasure').length, 2);
  assert.equal(utility.filter(name => name === 'Food').length, 2);
  assert.equal(utility.filter(name => name === 'Clue').length, 2);
  const record = e.getEventLogSnapshot().filter(row => row.type === ENGINE_EVENT.CREATE_TOKEN).at(-1);
  assert.equal(record.replacementTrace.length, 2);
});

test('Step 10: damage replacement runs before prevention and both are traced', () => {
  const e = engine();
  const target = putBattlefield(e, 'ai', 'grizzly-bears');
  addReplacement(e, {
    id: 'double-damage-test',
    eventTypes: ENGINE_EVENT.DEAL_DAMAGE,
    affectedPlayer: () => 'ai',
    predicate: event => event.payload.targetId === target.instanceId,
    transform: event => ({ ...event, payload: { ...event.payload, amount: Number(event.payload.amount) * 2 } })
  });
  e.prevention.addDamageShield(target, 3, { expires: null });

  const result = e.dealDamageToPermanent(target, 2, null);
  assert.deepEqual({ amount: result.amount, prevented: result.prevented }, { amount: 1, prevented: 3 });
  assert.equal(target.damageMarked, 1);
  const record = e.getEventLogSnapshot().filter(row => row.type === ENGINE_EVENT.DEAL_DAMAGE).at(-1);
  assert.equal(record.replacementTrace[0].replacementId, 'double-damage-test');
  assert.equal(record.preventionTrace[0].amount, 3);
});

test('Step 10: unpreventable damage ignores prevention shields without consuming them', () => {
  const e = engine();
  const target = putBattlefield(e, 'ai', 'grizzly-bears');
  e.prevention.addDamageShield(target, 3, { expires: null });
  const result = e.events.dispatch(ENGINE_EVENT.DEAL_DAMAGE, {
    targetId: target.instanceId,
    amount: 2,
    source: null,
    preventable: false
  }, { cause: 'unpreventable-test' });
  assert.equal(result.amount, 2);
  assert.equal(result.prevented, 0);
  assert.equal(target.damagePrevention, 3);
});

test('Step 10: consumable prevention shields expire at cleanup and survive state serialization beforehand', () => {
  const e = engine();
  const target = e.state.players.player;
  e.prevention.addDamageShield(target, 3);
  const serialized = JSON.parse(e.serializeState());
  assert.equal(serialized.state.preventionEffects.length, 1);
  e.prevention.pruneExpired({ forceEndOfTurn: true, turn: e.state.turn });
  assert.equal(e.state.preventionEffects.length, 0);
  assert.equal(target.damagePrevention, 0);
});

test('Step 10: generic multiple replacement choices are exposed through the same UI/AI choice protocol', () => {
  const e = engine();
  const before = e.state.players.player.life;
  addReplacement(e, {
    id: 'generic-add-one', eventTypes: ENGINE_EVENT.GAIN_LIFE, affectedPlayer: () => 'player', metadata: { effect: 'addOne' },
    transform: event => ({ ...event, payload: { ...event.payload, amount: Number(event.payload.amount) + 1 } })
  });
  addReplacement(e, {
    id: 'generic-double', eventTypes: ENGINE_EVENT.GAIN_LIFE, affectedPlayer: () => 'player', metadata: { effect: 'double' },
    transform: event => ({ ...event, payload: { ...event.payload, amount: Number(event.payload.amount) * 2 } })
  });

  const result = e.replacements.dispatchWithChoice(ENGINE_EVENT.GAIN_LIFE, { playerId: 'player', amount: 1 }, { affectedPlayerId: 'player', cause: 'step10-choice' });
  assert.equal(result.deferred, true);
  const request = e.getPendingChoiceRequest();
  assert.equal(request.choiceType, 'order');
  assert.equal(request.requestingPlayer, 'player');
  e.perform('player', { type: 'ORDER_REPLACEMENTS', replacementIds: ['generic-add-one', 'generic-double'] });
  assert.equal(e.state.players.player.life, before + 4, 'add one then double yields four life');
});

test('Step 10: replacement diagnostics record considered, selected, and applied stages', () => {
  const e = engine();
  addReplacement(e, {
    id: 'trace-life-plus-one',
    eventTypes: ENGINE_EVENT.GAIN_LIFE,
    affectedPlayer: event => event.payload.playerId,
    predicate: event => event.payload.playerId === 'player',
    transform: event => ({ ...event, payload: { ...event.payload, amount: Number(event.payload.amount) + 1 } })
  });

  e.changeLife('player', 1);
  const trace = e.getReplacementTraceSnapshot().filter(row => row.replacementId === 'trace-life-plus-one' || row.replacementIds?.includes('trace-life-plus-one'));
  assert.ok(trace.some(row => row.stage === 'considered'));
  assert.ok(trace.some(row => row.stage === 'selected' && row.replacementId === 'trace-life-plus-one'));
  assert.ok(trace.some(row => row.stage === 'applied' && row.replacementId === 'trace-life-plus-one'));
});
