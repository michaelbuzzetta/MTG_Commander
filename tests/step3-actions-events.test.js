import test from 'node:test';
import assert from 'node:assert/strict';
import { engine, rawEngine, putBattlefield, setPhase, relocateZone } from './helpers.js';
import {
  ACTION_TYPE,
  ENGINE_EVENT,
  ENGINE_EVENT_TYPES,
  isEngineEventType,
  getLegacyMutationEventAdapterRegistry
} from '../src/engine/index.js';

function resetEventLog(e) {
  e.events.clearLog();
}

test('Step 3 exposes canonical player-action and engine-event vocabularies', () => {
  for (const action of ['CAST_SPELL', 'PLAY_LAND', 'ACTIVATE_ABILITY', 'DECLARE_ATTACKERS', 'PASS_PRIORITY']) {
    assert.equal(ACTION_TYPE[action], action);
  }
  for (const type of [
    'CAST', 'COPY', 'DRAW_CARD', 'DISCARD_CARD', 'MILL_CARD', 'MOVE_ZONE', 'DEAL_DAMAGE',
    'GAIN_LIFE', 'LOSE_LIFE', 'DESTROY', 'SACRIFICE', 'EXILE', 'TAP', 'UNTAP',
    'ADD_COUNTER', 'REMOVE_COUNTER', 'CREATE_TOKEN', 'SEARCH', 'SHUFFLE', 'ATTACK',
    'BLOCK', 'TRANSFORM', 'CONTROL_CHANGE'
  ]) {
    assert.ok(ENGINE_EVENT_TYPES.has(type), `missing canonical event ${type}`);
    assert.equal(isEngineEventType(type), true);
  }
});

test('draw uses a parent DRAW_CARD event with causal MOVE_ZONE and trigger observation children', () => {
  const e = engine();
  resetEventLog(e);
  const before = e.state.players.player.hand.length;
  const drawn = e.draw('player');
  assert.ok(drawn);
  assert.equal(e.state.players.player.hand.length, before + 1);

  const log = e.getEventLogSnapshot();
  const draw = log.find(record => record.type === ENGINE_EVENT.DRAW_CARD && record.status === 'committed');
  const move = log.find(record => record.type === ENGINE_EVENT.MOVE_ZONE && record.status === 'committed');
  const observed = log.find(record => record.type === 'CARD_DRAWN' && record.status === 'observed');
  assert.ok(draw && move && observed);
  assert.equal(move.provenance.parentEventId, draw.eventId);
  assert.equal(observed.provenance.parentEventId, draw.eventId);
  assert.ok(draw.sequence < move.sequence);
  assert.ok(move.sequence < observed.sequence);
  assert.deepEqual(log.map(record => record.sequence), [...log.map(record => record.sequence)].sort((a, b) => a - b));
});

test('illegal event validation is atomic and leaves authoritative state unchanged', () => {
  const e = engine();
  resetEventLog(e);
  const before = e.serializeState();
  assert.throws(() => e.events.dispatch(ENGINE_EVENT.MOVE_ZONE, {
    cardInstanceId: 'does-not-exist',
    toZone: 'graveyard',
    toPlayerId: 'player'
  }), /no longer in a game zone/i);
  assert.equal(e.serializeState(), before);
  assert.equal(e.getEventLogSnapshot().length, 0);
  assert.equal(e.events.rejectedEvents.at(-1)?.status, 'rejected');
});

test('event handlers can request transactional rollback when commit code throws', () => {
  const e = engine();
  resetEventLog(e);
  const before = e.serializeState();
  e.events.register('STEP3_ROLLBACK_TEST', {
    snapshotOnCommitError: true,
    commit: (_event, game) => {
      game.state.players.player.life -= 7;
      game.state.players.player.hand.pop();
      throw new Error('intentional transaction failure');
    }
  });
  assert.throws(() => e.events.dispatch('STEP3_ROLLBACK_TEST'), /intentional transaction failure/);
  assert.equal(e.serializeState(), before);
  assert.equal(e.events.rejectedEvents.at(-1)?.status, 'failed');
});

test('generic subscribers and transformers can observe or prevent events without card-specific hooks', () => {
  const e = engine();
  resetEventLog(e);
  const seen = [];
  const unsubscribe = e.events.subscribe(ENGINE_EVENT.LOSE_LIFE, record => seen.push(record));
  const removeTransformer = e.events.addTransformer(event => {
    if (event.type !== ENGINE_EVENT.LOSE_LIFE) return event;
    return {
      ...event,
      prevented: true,
      preventionTrace: [...(event.preventionTrace || []), { source: 'step3-test', amount: event.payload.amount }]
    };
  });

  const before = e.state.players.ai.life;
  const result = e.changeLife('ai', -5);
  assert.equal(result, null);
  assert.equal(e.state.players.ai.life, before);
  const record = e.getEventLogSnapshot().find(item => item.type === ENGINE_EVENT.LOSE_LIFE);
  assert.equal(record?.status, 'prevented');
  assert.equal(record?.preventionTrace?.[0]?.source, 'step3-test');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].status, 'prevented');

  removeTransformer();
  unsubscribe();
});

test('representative counter, token, damage and zone mutations all produce canonical events', () => {
  const e = engine();
  resetEventLog(e);
  const creature = putBattlefield(e, 'player', 'grizzly-bears');

  e.effects.addCounters('player', creature, '+1/+1', 1);
  e.effects.createToken('player', { name: 'Step 3 Test Token', typeLine: 'Creature — Test', power: 1, toughness: 1 }, 1);
  e.dealDamageToPlayer('ai', 2, creature, { combat: false });
  e._moveZoneNow(creature, 'graveyard', creature.owner);

  const committedTypes = new Set(e.getEventLogSnapshot().filter(record => record.status === 'committed').map(record => record.type));
  for (const type of [ENGINE_EVENT.ADD_COUNTER, ENGINE_EVENT.CREATE_TOKEN, ENGINE_EVENT.DEAL_DAMAGE, ENGINE_EVENT.LOSE_LIFE, ENGINE_EVENT.MOVE_ZONE]) {
    assert.ok(committedTypes.has(type), `expected committed ${type} event`);
  }
  assert.equal(e.state.players.ai.life, 38);
  assert.ok(e.state.players.player.graveyard.some(card => card.instanceId === creature.instanceId));
});

test('submitted cast action attaches action provenance to the CAST event and replay', () => {
  const e = engine();
  resetEventLog(e);
  const p = e.state.players.player;
  relocateZone(e, 'player', 'hand', 'library');
  const spell = {
    instanceId: 'step3-cast-spell', cardId: 'merfolk-mistbinder', owner: 'player', controller: 'player', zone: 'hand',
    tapped: false, summoningSick: false, counters: {}, damageMarked: 0, modifiers: { power: 0, toughness: 0, keywords: [] }
  };
  p.hand.push(spell);
  putBattlefield(e, 'player', 'forest');
  putBattlefield(e, 'player', 'island');
  setPhase(e, 'PRECOMBAT_MAIN');

  e.cast('player', spell.instanceId);
  const cast = e.getEventLogSnapshot().find(record => record.type === ENGINE_EVENT.CAST && record.status === 'committed');
  assert.ok(cast);
  assert.equal(cast.provenance.actionType, ACTION_TYPE.CAST_SPELL);
  assert.equal(cast.provenance.actingPlayer, 'player');
  assert.equal(cast.provenance.actionSequence, 3); // two KEEP_HAND actions precede this cast
  assert.equal(e.state.stack.at(-1)?.card?.instanceId, spell.instanceId);

  const replay = JSON.parse(e.serializeReplay());
  assert.ok(replay.events.some(record => record.eventId === cast.eventId));
  assert.equal(replay.actions.at(-1).action.type, ACTION_TYPE.CAST_SPELL);
});

test('legacy mutation adapters are explicitly registered as event-routed compatibility shims', () => {
  const registry = getLegacyMutationEventAdapterRegistry();
  assert.ok(registry.length >= 15);
  for (const name of [
    'GameEngine.draw', 'GameEngine._moveZoneNow', 'GameEngine.changeLife', 'GameEngine.tapPermanent',
    'EffectEngine.addCounters', 'EffectEngine.createTokenRaw', 'GameEngine.dealDamageToPlayer'
  ]) {
    const entry = registry.find(item => item.legacy === name);
    assert.ok(entry, `missing adapter registry entry for ${name}`);
    assert.match(entry.status, /^routed/);
  }
});
