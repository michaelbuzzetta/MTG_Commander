import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCardInstance } from '../src/engine/GameState.js';
import { getObjectCardDefinition } from '../src/engine/state/CardFace.js';
import { engine, setPhase } from './helpers.js';

function place(e, cardId, playerId, zone, extra = {}) {
  const card = makeCardInstance(cardId, playerId, zone, {
    controller: playerId,
    summoningSick: false,
    createdTurn: e.state.turn,
    controlledSinceTurn: e.state.turn,
    ...extra
  }, e.db[cardId]);
  e.zones.place(card, zone, playerId);
  return card;
}

function resolveTop(e) {
  const start = e.state.stack.length;
  let guard = 0;
  while (e.state.stack.length >= start && !e.state.pendingChoice && !e.state.winner) {
    e.passPriority(e.state.priorityPlayer);
    if (++guard > 20) throw new Error('priority loop guard exceeded');
  }
}

test('release MDFC: legal actions expose both Esika faces and preserve the chosen Bridge face through resolution', () => {
  const e = engine();
  e.setInvariantChecks(false);
  setPhase(e, 'PRECOMBAT_MAIN', { activePlayer: 'player', priorityPlayer: 'player' });
  Object.assign(e.state.players.player.manaPool, { W: 10, U: 10, B: 10, R: 10, G: 10, C: 10 });

  const esika = place(e, 'esika', 'player', 'hand');
  const casts = e.getLegalActions('player').filter(action => action.cardInstanceId === esika.instanceId && action.type === 'CAST_SPELL');
  assert.deepEqual(new Set(casts.map(action => action.castFaceIndex)), new Set([0, 1]));

  const bridgeCast = casts.find(action => action.castFaceIndex === 1);
  assert.ok(bridgeCast, 'Bridge face must be a legal cast action');
  e.perform('player', bridgeCast);

  const stackCard = e.state.stack.at(-1).card;
  const stackDefinition = getObjectCardDefinition(e.db.esika, stackCard, 'stack');
  assert.equal(stackDefinition.name, 'The Prismatic Bridge');
  assert.equal(stackDefinition.manaCost, '{W}{U}{B}{R}{G}');
  assert.equal(stackDefinition.typeLine, 'Legendary Enchantment');

  resolveTop(e);
  const permanent = e.findPermanent(esika.instanceId);
  assert.ok(permanent);
  assert.equal(permanent.faceState.currentFaceIndex, 1);
  const battlefieldDefinition = getObjectCardDefinition(e.db.esika, permanent, 'battlefield');
  assert.equal(battlefieldDefinition.name, 'The Prismatic Bridge');
  assert.equal(battlefieldDefinition.typeLine, 'Legendary Enchantment');
  assert.equal(permanent.summoningSick, false);
});

test('release MDFC: The Prismatic Bridge reveal-until trigger puts the first creature onto the battlefield and random-bottoms prior cards', () => {
  const e = engine();
  e.setInvariantChecks(false);
  setPhase(e, 'UPKEEP', { activePlayer: 'player', priorityPlayer: 'player' });

  const bridge = place(e, 'esika', 'player', 'battlefield', {
    faceState: { currentFaceIndex: 1, castFaceIndex: null, transformed: true, faceUp: true }
  });
  bridge.faceState.currentFaceIndex = 1;
  bridge.faceState.transformed = true;

  const first = place(e, 'forest', 'player', 'library');
  const second = place(e, 'island', 'player', 'library');
  const hit = place(e, 'grizzly-bears', 'player', 'library');
  e.zones.moveWithinZone('player', 'library', hit.instanceId, 0);
  e.zones.moveWithinZone('player', 'library', second.instanceId, 0);
  e.zones.moveWithinZone('player', 'library', first.instanceId, 0);

  e.emit('PHASE_BEGIN', { controller: 'player', phase: 'UPKEEP' });
  assert.equal(e.state.stack.length, 1, 'Bridge upkeep trigger should use the normal stack');
  resolveTop(e);

  assert.equal(e.zones.find(hit.instanceId)?.zone, 'battlefield');
  assert.equal(e.zones.find(first.instanceId)?.zone, 'library');
  assert.equal(e.zones.find(second.instanceId)?.zone, 'library');
  assert.ok(e.state.players.player.library.indexOf(first) > 0);
  assert.ok(e.state.players.player.library.indexOf(second) > 0);
  assert.equal(e.knownInformation.isKnown('ai', first), false, 'random-bottom cards must not retain trackable hidden-zone identity');
  assert.equal(e.knownInformation.isKnown('ai', second), false, 'random-bottom cards must not retain trackable hidden-zone identity');
});

test('release MDFC: a modal double-faced commander can cast either face from the command zone with one commander tax identity', () => {
  const e = engine();
  e.setInvariantChecks(false);
  setPhase(e, 'PRECOMBAT_MAIN', { activePlayer: 'player', priorityPlayer: 'player' });
  Object.assign(e.state.players.player.manaPool, { W: 20, U: 20, B: 20, R: 20, G: 20, C: 20 });

  const esika = place(e, 'esika', 'player', 'command', { isCommander: true });
  const actions = e.getLegalActions('player').filter(action => action.cardInstanceId === esika.instanceId && action.type === 'CAST_COMMANDER');
  assert.deepEqual(new Set(actions.map(action => action.castFaceIndex)), new Set([0, 1]));

  const bridgeCast = actions.find(action => action.castFaceIndex === 1);
  e.perform('player', bridgeCast);
  assert.equal(e.state.stack.at(-1).castFaceIndex, 1);
});
