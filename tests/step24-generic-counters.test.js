import test from 'node:test';
import assert from 'node:assert/strict';
import { engine, putBattlefield } from './helpers.js';
import { ENGINE_EVENT } from '../src/engine/events/EventTypes.js';
import { makeCardInstance } from '../src/engine/GameState.js';

function addToHand(e, id, definition) {
  e._registerRuntimeCardDefinition(id, { id, name: id, keywords: [], abilities: [], ...definition });
  const card = makeCardInstance(id, 'player', 'hand', {}, e.db[id]);
  e.state.players.player.hand.push(card);
  return card;
}

test('Step 24: arbitrary named counters use a generic keyed store and canonical events', () => {
  const e = engine();
  const permanent = putBattlefield(e, 'player', 'grizzly-bears');
  e.counters.add(permanent, 'quest', 3, { cause: 'step24-arbitrary' });
  assert.deepEqual(e.getCounterSnapshot(permanent), { quest: 3 });
  const row = e.getEventLogSnapshot().filter(item => item.type === ENGINE_EVENT.ADD_COUNTER).at(-1);
  assert.equal(row.payload.counterType, 'quest');
  assert.equal(row.payload.amount, 3);
});

test('Step 24: players support poison, energy, experience, and arbitrary counters without schema changes', () => {
  const e = engine();
  e.counters.add('player', 'energy', 4);
  e.counters.add('player', 'experience', 2);
  e.counters.add('player', 'mystery', 7);
  assert.deepEqual(e.getCounterSnapshot('player'), { energy: 4, experience: 2, mystery: 7 });
  e.counters.remove('player', 'energy', 1);
  assert.equal(e.state.players.player.counters.energy, 3);
});

test('Step 24: counter additions flow through replacement effects including doublers', () => {
  const e = engine();
  const permanent = putBattlefield(e, 'player', 'grizzly-bears');
  e.replacements.register({
    id: 'step24-double-charge', eventTypes: ENGINE_EVENT.ADD_COUNTER, affectedPlayer: () => 'player',
    predicate: event => event.payload.counterType === 'charge', metadata: { effect: 'double' },
    transform: event => ({ ...event, payload: { ...event.payload, amount: Number(event.payload.amount) * 2 } })
  });
  e.counters.add(permanent, 'charge', 2);
  assert.equal(permanent.counters.charge, 4);
});

test('Step 24: counter placement can be prevented through the replacement pipeline', () => {
  const e = engine();
  const permanent = putBattlefield(e, 'player', 'grizzly-bears');
  e.replacements.register({
    id: 'step24-no-doom', eventTypes: ENGINE_EVENT.ADD_COUNTER, affectedPlayer: () => 'player',
    predicate: event => event.payload.counterType === 'doom',
    transform: event => ({ ...event, prevented: true, result: 0 })
  });
  e.counters.add(permanent, 'doom', 2);
  assert.equal(e.counters.count(permanent, 'doom'), 0);
  const row = e.getEventLogSnapshot().filter(item => item.type === ENGINE_EVENT.ADD_COUNTER).at(-1);
  assert.equal(row.status, 'prevented');
});

test('Step 24: +1/+1 and -1/-1 counters change derived P/T through the layer engine', () => {
  const e = engine();
  const permanent = putBattlefield(e, 'player', 'grizzly-bears');
  const base = e.getDerivedStats(permanent);
  e.counters.add(permanent, '+1/+1', 3);
  e.counters.add(permanent, '-1/-1', 1);
  const after = e.getDerivedStats(permanent);
  assert.equal(after.power, base.power + 2);
  assert.equal(after.toughness, base.toughness + 2);
});

test('Step 24: +1/+1 and -1/-1 cancellation is an SBA routed through REMOVE_COUNTER events', () => {
  const e = engine();
  const permanent = putBattlefield(e, 'player', 'grizzly-bears');
  e.counters.add(permanent, '+1/+1', 3);
  e.counters.add(permanent, '-1/-1', 2);
  e.stateBasedActions();
  assert.equal(e.counters.count(permanent, '+1/+1'), 1);
  assert.equal(e.counters.count(permanent, '-1/-1'), 0);
  const removes = e.getEventLogSnapshot().filter(item => item.type === ENGINE_EVENT.REMOVE_COUNTER && item.provenance.cause === 'sba-counter-cancellation');
  assert.equal(removes.length, 2);
});

test('Step 24: proliferate adds one of every existing kind across players and permanents', () => {
  const e = engine();
  const permanent = putBattlefield(e, 'player', 'grizzly-bears');
  e.counters.add(permanent, '+1/+1', 1);
  e.counters.add(permanent, 'charge', 2);
  e.counters.add('ai', 'poison', 3);
  e.counters.add('ai', 'energy', 1);
  const eligible = e.counters.beginProliferate('player');
  assert.ok(eligible.includes(permanent.instanceId));
  assert.ok(eligible.includes('ai'));
  e.counters.chooseProliferate('player', [permanent.instanceId, 'ai']);
  assert.equal(permanent.counters['+1/+1'], 2);
  assert.equal(permanent.counters.charge, 3);
  assert.equal(e.state.players.ai.counters.poison, 4);
  assert.equal(e.state.players.ai.counters.energy, 2);
});

test('Step 24: proliferate rejects targets that did not have counters when the choice opened', () => {
  const e = engine();
  const withCounter = putBattlefield(e, 'player', 'grizzly-bears');
  const withoutCounter = putBattlefield(e, 'player', 'merfolk-mistbinder');
  e.counters.add(withCounter, 'charge', 1);
  e.counters.beginProliferate('player');
  assert.throws(() => e.counters.chooseProliferate('player', [withoutCounter.instanceId]), /only players\/permanents/i);
});

test('Step 24: moving counters is event-routed and transfers only counters actually present', () => {
  const e = engine();
  const first = putBattlefield(e, 'player', 'grizzly-bears');
  const second = putBattlefield(e, 'player', 'merfolk-mistbinder');
  e.counters.add(first, 'charge', 2);
  const moved = e.moveCounters(first, second, 'charge', 5);
  assert.deepEqual(moved, { removed: 2, added: 2 });
  assert.equal(e.counters.count(first, 'charge'), 0);
  assert.equal(e.counters.count(second, 'charge'), 2);
  assert.ok(e.getEventLogSnapshot().some(row => row.type === ENGINE_EVENT.REMOVE_COUNTER && row.provenance.cause === 'move-counter-remove'));
  assert.ok(e.getEventLogSnapshot().some(row => row.type === ENGINE_EVENT.ADD_COUNTER && row.provenance.cause === 'move-counter-add'));
});

test('Step 24: doubling counters uses ADD_COUNTER rather than direct collection mutation', () => {
  const e = engine();
  const permanent = putBattlefield(e, 'player', 'grizzly-bears');
  e.counters.add(permanent, 'charge', 3);
  e.doubleCounters(permanent, 'charge');
  assert.equal(permanent.counters.charge, 6);
  const adds = e.getEventLogSnapshot().filter(row => row.type === ENGINE_EVENT.ADD_COUNTER && row.payload.counterType === 'charge');
  assert.equal(adds.length, 2);
});

test('Step 24: stun counters replace untapping with removing one stun counter', () => {
  const e = engine();
  const permanent = putBattlefield(e, 'player', 'grizzly-bears', { tapped: true });
  e.counters.add(permanent, 'stun', 2);
  assert.equal(e.untapPermanent(permanent), false);
  assert.equal(permanent.tapped, true);
  assert.equal(permanent.counters.stun, 1);
  assert.equal(e.untapPermanent(permanent), false);
  assert.equal(permanent.tapped, true);
  assert.equal(e.counters.count(permanent, 'stun'), 0);
  assert.equal(e.untapPermanent(permanent), true);
  assert.equal(permanent.tapped, false);
});

test('Step 24: Planeswalkers enter with loyalty counters through ADD_COUNTER', () => {
  const e = engine();
  const card = addToHand(e, 'step24-walker', { typeLine: 'Legendary Planeswalker — Test', loyalty: 5 });
  const moved = e.events.dispatch(ENGINE_EVENT.MOVE_ZONE, { cardInstanceId: card.instanceId, toZone: 'battlefield', toPlayerId: 'player' }, { cause: 'step24-walker-entry' });
  assert.equal(moved.counters.loyalty, 5);
  assert.ok(e.getEventLogSnapshot().some(row => row.type === ENGINE_EVENT.ADD_COUNTER && row.payload.counterType === 'loyalty' && row.provenance.cause === 'planeswalker-entry-loyalty'));
});

test('Step 24: Battles enter with defense counters through ADD_COUNTER', () => {
  const e = engine();
  const card = addToHand(e, 'step24-battle', { typeLine: 'Battle — Siege', defense: 4 });
  const moved = e.events.dispatch(ENGINE_EVENT.MOVE_ZONE, { cardInstanceId: card.instanceId, toZone: 'battlefield', toPlayerId: 'player' }, { cause: 'step24-battle-entry' });
  assert.equal(moved.counters.defense, 4);
  assert.ok(e.getEventLogSnapshot().some(row => row.type === ENGINE_EVENT.ADD_COUNTER && row.payload.counterType === 'defense'));
});

test('Step 24: damage removes loyalty and defense with REMOVE_COUNTER events', () => {
  const e = engine();
  e._registerRuntimeCardDefinition('step24-walker-damage', { id: 'step24-walker-damage', name: 'Walker', typeLine: 'Planeswalker — Test', loyalty: 5, keywords: [], abilities: [] });
  const walker = putBattlefield(e, 'ai', 'step24-walker-damage', { counters: { loyalty: 5 } });
  e.dealDamageToPermanent(walker, 2, null);
  assert.equal(walker.counters.loyalty, 3);
  const row = e.getEventLogSnapshot().filter(item => item.type === ENGINE_EVENT.REMOVE_COUNTER && item.payload.counterType === 'loyalty').at(-1);
  assert.equal(row.payload.amount, 2);
  assert.equal(row.provenance.cause, 'planeswalker-damage');
});

test('Step 24: lore-counter semantics still queue Saga chapters from the generic counter service', () => {
  const e = engine();
  e._registerRuntimeCardDefinition('step24-saga', {
    id: 'step24-saga', name: 'Step24 Saga', typeLine: 'Enchantment — Saga', keywords: [], abilities: [],
    sagaChapters: [{ number: 1, effects: [{ type: 'gainLife', amount: 1 }] }]
  });
  const saga = putBattlefield(e, 'player', 'step24-saga');
  e.counters.add(saga, 'lore', 1);
  assert.ok(e.state.stack.some(item => item.source?.instanceId === saga.instanceId || item.id?.startsWith(`saga-${saga.instanceId}-1`)));
});

test('Step 24: suspend time-counter placement/removal is routed through counter events', () => {
  const e = engine('temporal-paradox', 'explorers');
  const card = e.state.players.player.hand.find(c => !String(e.db[c.cardId]?.typeLine || '').includes('Land'));
  assert.ok(card);
  e.effects.resolve({ type: 'jhoiraSuspend', counters: 4 }, { controller: 'player', targets: [card.instanceId] });
  assert.equal(e.counters.count(card, 'time'), 4);
  e.counters.remove(card, 'time', 2, { cause: 'step24-time-remove' });
  assert.equal(e.counters.count(card, 'time'), 2);
  assert.ok(e.getEventLogSnapshot().some(row => row.type === ENGINE_EVENT.ADD_COUNTER && row.payload.counterType === 'time'));
  assert.ok(e.getEventLogSnapshot().some(row => row.type === ENGINE_EVENT.REMOVE_COUNTER && row.payload.counterType === 'time'));
});

test('Step 24: arbitrary player and permanent counters survive serialization/hydration', () => {
  const e = engine();
  const source = e.state.players.player.hand[0];
  assert.ok(source);
  const permanent = e.events.dispatch(ENGINE_EVENT.MOVE_ZONE, { cardInstanceId: source.instanceId, toZone: 'battlefield', toPlayerId: 'player' }, { cause: 'step24-serialization-fixture' });
  e.counters.add(permanent, 'quest', 6);
  e.counters.add('player', 'energy', 9);
  const serialized = e.serializeState();
  e.restoreState(serialized);
  const restored = e.findPermanent(permanent.instanceId);
  assert.equal(e.counters.count(restored, 'quest'), 6);
  assert.equal(e.counters.count('player', 'energy'), 9);
});

test('Step 24: counter semantics are extensible without changing the state schema', () => {
  const e = engine();
  const permanent = putBattlefield(e, 'player', 'grizzly-bears');
  let seen = 0;
  e.counters.registerSemantic('custom-step24', { afterAdd: ({ amount }) => { seen += amount; } });
  e.counters.add(permanent, 'custom-step24', 3);
  assert.equal(seen, 3);
  assert.equal(e.counters.semantic('custom-step24').category, 'generic');
});

test('Step 24: source metadata is preserved on counter events for diagnostics/triggers', () => {
  const e = engine();
  const source = putBattlefield(e, 'player', 'merfolk-mistbinder');
  const target = putBattlefield(e, 'player', 'grizzly-bears');
  e.counters.add(target, 'charge', 1, { source, cause: 'step24-source' });
  const row = e.getEventLogSnapshot().filter(item => item.type === ENGINE_EVENT.ADD_COUNTER).at(-1);
  assert.equal(row.provenance.sourceObjectId, source.instanceId);
  assert.equal(row.provenance.cause, 'step24-source');
});
