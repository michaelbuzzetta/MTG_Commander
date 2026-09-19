import test from 'node:test';
import assert from 'node:assert/strict';
import { ENGINE_EVENT } from '../src/engine/events/index.js';
import { EffectPrimitiveLibrary } from '../src/cards/scripts/EffectPrimitiveLibrary.js';
import { engine as fullEngine, setPhase } from './helpers.js';
import {
  primitiveEngine, battlefieldCard, defineCard, stateHash, assertStateUnchanged,
  zoneOf, manaPool, simpleLockedCost
} from './fixtures/primitive-fixtures.js';

const WORKFLOW_PRIMITIVES = Object.freeze([
  'draw', 'damage', 'moveZone', 'destroy', 'exile', 'sacrifice', 'counters',
  'createToken', 'search', 'targeting', 'costPayment', 'copy', 'controlChange'
]);

// Marker consumed by scripts/check-rule-primitive-coverage.mjs.
export const STEP33_PRIMITIVE_CONTRACTS = Object.freeze(Object.fromEntries(WORKFLOW_PRIMITIVES.map(id => [id, true])));

const CANONICAL_EVENT_CONTRACTS = Object.freeze([
  ENGINE_EVENT.DRAW_CARD, ENGINE_EVENT.DEAL_DAMAGE, ENGINE_EVENT.MOVE_ZONE, ENGINE_EVENT.DESTROY,
  ENGINE_EVENT.EXILE, ENGINE_EVENT.SACRIFICE, ENGINE_EVENT.ADD_COUNTER, ENGINE_EVENT.CREATE_TOKEN,
  ENGINE_EVENT.CONTROL_CHANGE
]);

test('Step 33: workflow primitive contract list is complete and effect vocabulary exposes the matching script primitives', () => {
  assert.equal(WORKFLOW_PRIMITIVES.length, 13);
  assert.equal(CANONICAL_EVENT_CONTRACTS.length, 9);
  const library = new EffectPrimitiveLibrary();
  for (const id of ['draw','damage','moveZone','destroy','exile','sacrifice','createToken','search','copy','controlChange']) {
    assert.equal(library.has(id), true, `${id} must remain a registered effect primitive`);
  }
});

test('Step 33 primitive — draw: legal draw moves exactly one card and invalid player draw is atomic', () => {
  const e = primitiveEngine();
  const beforeLibrary = e.state.players.player.library.length;
  const beforeHand = e.state.players.player.hand.length;
  const topId = e.state.players.player.library[0].instanceId;
  const drawn = e.draw('player');
  assert.equal(drawn.instanceId, topId);
  assert.equal(e.state.players.player.library.length, beforeLibrary - 1);
  assert.equal(e.state.players.player.hand.length, beforeHand + 1);
  assert.equal(zoneOf(e, topId), 'hand');

  const before = stateHash(e);
  assert.throws(() => e.events.dispatch(ENGINE_EVENT.DRAW_CARD, { playerId: 'missing-player' }), /Unknown player/);
  assertStateUnchanged(e, before);
});

test('Step 33 primitive — damage: prevention changes actual damage dealt and invalid damage leaves state unchanged', () => {
  const e = primitiveEngine();
  const source = battlefieldCard(e, 'player', { id: 'step33-damage-source', keywords: ['lifelink'] });
  const target = battlefieldCard(e, 'ai', { id: 'step33-damage-target', toughness: 6 });
  e.prevention.addDamageShield(target, 2, { expires: null });
  const life = e.state.players.player.life;
  const result = e.dealDamageToPermanent(target, 5, source);
  assert.equal(result.amount, 3);
  assert.equal(result.prevented, 2);
  assert.equal(target.damageMarked, 3);
  assert.equal(e.state.players.player.life, life + 3, 'lifelink observes actual post-prevention damage');

  const before = stateHash(e);
  assert.throws(() => e.events.dispatch(ENGINE_EVENT.DEAL_DAMAGE, { targetId: target.instanceId, amount: -1 }), /positive|amount/i);
  assertStateUnchanged(e, before);
});

test('Step 33 primitive — move zone: valid movement creates a new object incarnation and invalid destination is atomic', () => {
  const e = primitiveEngine();
  const card = e.state.players.player.hand[0];
  const instanceId = card.instanceId;
  const oldObjectId = card.gameObjectId;
  const moved = e._moveZoneNow(card, 'graveyard', 'player', { reason: 'step33-zone-move' });
  assert.equal(zoneOf(e, instanceId), 'graveyard');
  assert.notEqual(moved.gameObjectId, oldObjectId);

  const second = e.state.players.player.hand[0];
  const before = stateHash(e);
  assert.throws(() => e._moveZoneNow(second, 'not-a-zone', 'player', { reason: 'step33-invalid-zone' }), /Unsupported destination zone/);
  assertStateUnchanged(e, before);
  assert.equal(zoneOf(e, second.instanceId), 'hand');
});

test('Step 33 primitives — destroy/exile/sacrifice: destination semantics and indestructible distinction', () => {
  const cases = [
    {
      name: 'destroy',
      execute: (e, card) => e.destroy(card),
      expectedZone: 'graveyard',
      special: e => battlefieldCard(e, 'ai', { id: 'step33-indestructible', keywords: ['indestructible'] }),
      specialAssert: (e, card) => { assert.equal(e.destroy(card), false); assert.equal(zoneOf(e, card), 'battlefield'); }
    },
    {
      name: 'exile',
      execute: (e, card) => e.exile(card),
      expectedZone: 'exile'
    },
    {
      name: 'sacrifice',
      execute: (e, card) => e.sacrifice(card),
      expectedZone: 'graveyard',
      special: e => battlefieldCard(e, 'ai', { id: 'step33-sac-indestructible', keywords: ['indestructible'] }),
      specialAssert: (e, card) => { e.sacrifice(card); assert.equal(zoneOf(e, card), 'graveyard', 'indestructible does not stop sacrifice'); }
    }
  ];
  for (const row of cases) {
    const e = primitiveEngine();
    const card = battlefieldCard(e, 'ai', { id: `step33-${row.name}-target` });
    row.execute(e, card);
    assert.equal(zoneOf(e, card), row.expectedZone, `${row.name} should move to the correct zone`);
    if (row.special) row.specialAssert(e, row.special(e));
  }
});

test('Step 33 primitives — destroy/exile/sacrifice reject stale object references without mutating state', () => {
  for (const type of [ENGINE_EVENT.DESTROY, ENGINE_EVENT.EXILE, ENGINE_EVENT.SACRIFICE]) {
    const e = primitiveEngine();
    const before = stateHash(e);
    assert.throws(() => e.events.dispatch(type, { permanentId: 'missing-object' }), /no longer|available|battlefield/i);
    assertStateUnchanged(e, before, `${type} rejection must be atomic`);
  }
});

test('Step 33 primitive — counters: add/remove are canonical events and a replacement can alter placement', () => {
  const e = primitiveEngine();
  const card = battlefieldCard(e, 'player', { id: 'step33-counter-target' });
  e.replacements.register({
    id: 'step33-double-counter',
    eventTypes: ENGINE_EVENT.ADD_COUNTER,
    affectedPlayer: () => 'player',
    predicate: event => event.payload.objectId === card.instanceId,
    transform: event => ({ ...event, payload: { ...event.payload, amount: Number(event.payload.amount) * 2 } })
  });
  const added = e.addCounters(card, '+1/+1', 2, { playerId: 'player' });
  assert.equal(added, 4);
  assert.equal(e.counters.count(card, '+1/+1'), 4);
  const removed = e.removeCounters(card, '+1/+1', 10, 'player');
  assert.equal(removed, 4, 'removal clamps to counters actually present');
  assert.equal(e.counters.count(card, '+1/+1'), 0);

  const before = stateHash(e);
  assert.throws(() => e.events.dispatch(ENGINE_EVENT.ADD_COUNTER, { objectId: card.instanceId, counterType: '+1/+1', amount: 0 }), /positive|amount/i);
  assertStateUnchanged(e, before);
});

test('Step 33 primitive — token creation: generic registry creates unique game objects and zero creation is a no-op', () => {
  const e = primitiveEngine();
  const before = e.state.players.player.battlefield.length;
  const tokens = e.tokens.create('player', 'token:treasure', 2, { cause: 'step33-token' });
  assert.equal(tokens.length, 2);
  assert.equal(e.state.players.player.battlefield.length, before + 2);
  assert.equal(new Set(tokens.map(token => token.instanceId)).size, 2);
  assert.ok(tokens.every(token => token.isToken && token.tokenDefinitionId === 'token:treasure'));
  const none = e.tokens.create('player', 'token:treasure', 0, { cause: 'step33-zero-token' });
  assert.deepEqual(none, []);

  const hash = stateHash(e);
  assert.throws(() => e.events.dispatch(ENGINE_EVENT.CREATE_TOKEN, { playerId: 'missing', amount: 1, tokenDefinition: e.tokens.getDefinition('token:treasure') }), /Unknown player/);
  assertStateUnchanged(e, hash);
});

test('Step 33 primitive — search: legal exact-card search moves only the selected card and illegal selection is atomic', () => {
  const e = primitiveEngine();
  const target = e.state.players.player.library[0];
  const result = e.libraryOps.searchImmediate({
    searchingPlayerId: 'player', filter: { cardId: target.cardId }, minCount: 1, maxCount: 1,
    destination: 'hand', shuffleAfter: false, allowFailToFind: false, reason: 'step33-search'
  }, [target.instanceId]);
  assert.equal(result.selectedIds[0], target.instanceId);
  assert.equal(zoneOf(e, target), 'hand');

  const beforeZones = {
    library: e.state.players.player.library.map(card => card.instanceId),
    hand: e.state.players.player.hand.map(card => card.instanceId)
  };
  assert.throws(() => e.libraryOps.searchImmediate({
    searchingPlayerId: 'player', filter: { type: 'Land' }, minCount: 0, maxCount: 1,
    destination: 'hand', shuffleAfter: false, reason: 'step33-illegal-selection'
  }, ['not-in-library']), /legal search result/);
  assert.deepEqual(e.state.players.player.library.map(card => card.instanceId), beforeZones.library, 'illegal selection moves no library cards');
  assert.deepEqual(e.state.players.player.hand.map(card => card.instanceId), beforeZones.hand, 'illegal selection adds no card to hand');
});

test('Step 33 primitive — targeting: legal filters reject protected targets and resolution recheck supports partial resolution', () => {
  const e = primitiveEngine();
  const source = battlefieldCard(e, 'player', { id: 'step33-target-source', typeLine: 'Creature — Wizard' });
  const a = battlefieldCard(e, 'ai', { id: 'step33-target-a' });
  const b = battlefieldCard(e, 'ai', { id: 'step33-target-b' });
  const hexproof = battlefieldCard(e, 'ai', { id: 'step33-target-hexproof', keywords: ['hexproof'] });
  const spell = { targets: { kind: 'permanent', type: 'Creature', controller: 'opponent' }, minTargets: 1, maxTargets: 2 };
  assert.equal(e.targeting.isLegalTarget('player', a.instanceId, spell.targets, { sourceObject: source }), true);
  assert.equal(e.targeting.isLegalTarget('player', hexproof.instanceId, spell.targets, { sourceObject: source }), false);

  e._moveZoneNow(a, 'graveyard', a.owner, { reason: 'step33-target-left' });
  const checked = e.targeting.recheckTargets('player', spell, [a.instanceId, b.instanceId], { sourceObject: source });
  assert.deepEqual(checked.legalTargets, [b.instanceId]);
  assert.deepEqual(checked.illegalTargets, [a.instanceId]);
  assert.deepEqual(checked.resolutionTargets, [null, b.instanceId]);
  assert.equal(checked.allIllegal, false);
});

test('Step 33 primitive — cost payment: successful mana/life payment commits and an unaffordable cost pays nothing', () => {
  const e = primitiveEngine();
  manaPool(e, 'player', { C: 2 });
  const life = e.state.players.player.life;
  const paid = e.payments.payLockedCost('player', simpleLockedCost('player', '{2}', [{ type: 'payLife', amount: 3 }]), { context: { kind: 'test' } });
  assert.ok(paid);
  assert.equal(e.state.players.player.manaPool.C, 0);
  assert.equal(e.state.players.player.life, life - 3);

  const sacrifice = battlefieldCard(e, 'player', { id: 'step33-payment-sac' });
  manaPool(e, 'player', {});
  const before = stateHash(e);
  const failed = e.payments.payLockedCost('player', simpleLockedCost('player', '{9}', [{ type: 'sacrifice', permanentId: sacrifice.instanceId }]), { context: { kind: 'test' } });
  assert.equal(failed, null);
  assertStateUnchanged(e, before, 'unpayable cost must not sacrifice or consume resources');
  assert.equal(zoneOf(e, sacrifice), 'battlefield');
});

test('Step 33 primitive — copy: permanent copies use copiable values, not counters/tapped/current buffs', () => {
  const e = primitiveEngine();
  const source = battlefieldCard(e, 'player', { id: 'step33-copy-source', name: 'Copy Source', power: 4, toughness: 4, keywords: ['flying'] }, {
    tapped: true, counters: { '+1/+1': 3 }, modifiers: { power: 5, toughness: 5, keywords: ['haste'] }
  });
  const target = battlefieldCard(e, 'player', { id: 'step33-copy-target', name: 'Copy Target', power: 1, toughness: 1 });
  e.copy.applyPermanentCopy(target, source);
  const values = e.copy.getCopiableValues(target);
  assert.equal(values.name, 'Copy Source');
  assert.equal(values.power, 4);
  assert.equal(values.toughness, 4);
  assert.ok(values.keywords.includes('flying'));
  assert.equal(target.tapped, false, 'copy does not copy tapped state');
  assert.equal(e.counters.count(target, '+1/+1'), 0, 'copy does not copy counters');

  const before = stateHash(e);
  assert.throws(() => e.copy.applyPermanentCopy(target, 'missing-copy-source'), /Copy source no longer exists|Copy source must/);
  assertStateUnchanged(e, before);
});

test('Step 33 primitive — control change: battlefield ownership stays fixed while controller and zone container change', () => {
  const e = primitiveEngine();
  const creature = battlefieldCard(e, 'ai', { id: 'step33-control-target' });
  const owner = creature.owner;
  const moved = e.changeController(creature.instanceId, 'player');
  assert.equal(moved.owner, owner);
  assert.equal(moved.controller, 'player');
  assert.ok(e.state.players.player.battlefield.some(card => card.instanceId === creature.instanceId));
  assert.equal(e.state.players.ai.battlefield.some(card => card.instanceId === creature.instanceId), false);

  const before = stateHash(e);
  assert.throws(() => e.changeController(creature.instanceId, 'missing-player'), /Unknown player/);
  assertStateUnchanged(e, before);
});

test('Step 33: successful primitive events expose trigger/SBA scheduling at the authoritative event boundary', () => {
  const e = primitiveEngine();
  const source = battlefieldCard(e, 'player', { id: 'step33-sba-source' });
  const victim = battlefieldCard(e, 'ai', { id: 'step33-sba-victim', toughness: 2 });
  const seen = [];
  const unsubscribe = e.events.subscribe(ENGINE_EVENT.DEAL_DAMAGE, record => seen.push(record.type));
  e.dealDamageBatch([{ targetId: victim.instanceId, amount: 2, source }], { stabilize: true, cause: 'step33-sba-boundary' });
  unsubscribe();
  assert.deepEqual(seen, [ENGINE_EVENT.DEAL_DAMAGE]);
  assert.equal(e.findPermanent(victim.instanceId), null, 'stabilized damage invokes the SBA layer after event commit');
  assert.equal(zoneOf(e, victim), 'graveyard');
});

test('Step 33 regression — a search choice during spell resolution keeps the physical spell authoritative and finishes it afterward', () => {
  const e = fullEngine('explorers', 'explorers');
  const player = e.state.players.player;
  const zones = ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'];
  let spell = null;
  for (const zone of zones) {
    spell = player[zone].find(card => card.cardId === 'lcc-kodama-s-reach');
    if (spell) break;
  }
  assert.ok(spell, "Explorers fixture must contain Kodama's Reach");
  if (spell.zone !== 'hand') spell = e.zones.move(spell.instanceId, 'hand', 'player');
  manaPool(e, 'player', { G: 4, C: 4 });
  setPhase(e, 'PRECOMBAT_MAIN', { activePlayer: 'player', priorityPlayer: 'player' });

  e.perform('player', { type: 'CAST_SPELL', cardInstanceId: spell.instanceId });
  e.perform('player', { type: 'PASS_PRIORITY' });
  e.perform('ai', { type: 'PASS_PRIORITY' });
  assert.equal(e.state.pendingChoice?.type, 'CULTIVATE_SEARCH');
  assert.equal(e.state.pendingResolution?.item?.card?.instanceId, spell.instanceId);
  assert.equal(e.checkInvariants().ok, true, 'a resolving spell awaiting a choice is still an authoritative stack object');

  const selected = e.state.pendingChoice.eligibleIds.slice(0, 2);
  e.perform('player', { type: 'CHOOSE_CULTIVATE', cardInstanceIds: selected });
  assert.equal(e.state.pendingResolution, null, 'finishing the search choice resumes and completes spell resolution');
  assert.equal(zoneOf(e, spell.instanceId), 'graveyard');
  assert.equal(e.checkInvariants().ok, true);
});

