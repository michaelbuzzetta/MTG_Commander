import test from 'node:test';
import assert from 'node:assert/strict';
import { engine, putBattlefield, setPhase } from './helpers.js';
import { makeCardInstance } from '../src/engine/GameState.js';

function addToHand(e, cardId, instanceId = `hand-${cardId}-${Math.random()}`) {
  const card = makeCardInstance(cardId, 'player', 'hand');
  card.instanceId = instanceId;
  e.state.players.player.hand.push(card);
  return card;
}

function readyMain(e) {
  setPhase(e, 'PRECOMBAT_MAIN', { activePlayer: 'player', priorityPlayer: 'player' });
  e.state.players.player.landPlaysRemaining = 1;
}

test('shockland play asks for life and enters untapped when paid', () => {
  const e = engine('explorers', 'blech');
  readyMain(e);
  e.state.players.player.life = 40;
  const grave = addToHand(e, 'arch-watery-grave', 'shock-pay');

  e.perform('player', { type: 'PLAY_LAND', cardInstanceId: grave.instanceId });
  assert.equal(e.state.pendingChoice?.type, 'ENTRY_LIFE_PAYMENT');
  assert.equal(e.state.pendingChoice?.lifeCost, 2);
  assert.equal(e.findPermanent(grave.instanceId), null, 'land should not enter before the replacement choice is made');

  e.perform('player', { type: 'CHOOSE_ENTRY_LIFE_PAYMENT', pay: true });
  const permanent = e.findPermanent(grave.instanceId);
  assert.ok(permanent);
  assert.equal(e.state.players.player.life, 38);
  assert.equal(permanent.tapped, false);
  assert.equal(e.state.players.player.landPlaysRemaining, 0);
});

test('shockland enters tapped when life payment is declined', () => {
  const e = engine('explorers', 'blech');
  readyMain(e);
  e.state.players.player.life = 40;
  const grave = addToHand(e, 'arch-watery-grave', 'shock-decline');

  e.perform('player', { type: 'PLAY_LAND', cardInstanceId: grave.instanceId });
  e.perform('player', { type: 'CHOOSE_ENTRY_LIFE_PAYMENT', pay: false });
  const permanent = e.findPermanent(grave.instanceId);
  assert.ok(permanent);
  assert.equal(e.state.players.player.life, 40);
  assert.equal(permanent.tapped, true);
});

test('shockland cannot pay more life than the player has', () => {
  const e = engine('explorers', 'blech');
  readyMain(e);
  e.state.players.player.life = 1;
  const grave = addToHand(e, 'arch-watery-grave', 'shock-low-life');

  e.perform('player', { type: 'PLAY_LAND', cardInstanceId: grave.instanceId });
  const permanent = e.findPermanent(grave.instanceId);
  assert.ok(permanent, 'when payment is impossible the land should finish entering without a dead-end prompt');
  assert.equal(permanent.tapped, true);
  assert.equal(e.state.players.player.life, 1);
});

test('check lands enter untapped when the required land subtype is controlled', () => {
  const e = engine('explorers', 'blech');
  readyMain(e);
  putBattlefield(e, 'player', 'island');
  const catacomb = addToHand(e, 'arch-drowned-catacomb', 'check-land');

  e.perform('player', { type: 'PLAY_LAND', cardInstanceId: catacomb.instanceId });
  assert.equal(e.findPermanent(catacomb.instanceId)?.tapped, false);
});

test('slow lands and fast lands evaluate the number of other lands correctly', () => {
  const slow = engine('explorers', 'blech');
  readyMain(slow);
  putBattlefield(slow, 'player', 'island');
  putBattlefield(slow, 'player', 'forest');
  const marsh = addToHand(slow, 'arch-shipwreck-marsh', 'slow-land');
  slow.perform('player', { type: 'PLAY_LAND', cardInstanceId: marsh.instanceId });
  assert.equal(slow.findPermanent(marsh.instanceId)?.tapped, false, 'slow land should be untapped with two other lands');

  const fast = engine('explorers', 'blech');
  readyMain(fast);
  putBattlefield(fast, 'player', 'island');
  putBattlefield(fast, 'player', 'forest');
  const canal = addToHand(fast, 'user-spirebluff-canal', 'fast-land');
  fast.perform('player', { type: 'PLAY_LAND', cardInstanceId: canal.instanceId });
  assert.equal(fast.findPermanent(canal.instanceId)?.tapped, false, 'fast land should be untapped with two or fewer other lands');
});

test('reveal lands offer the reveal choice even when imported without explicit entry metadata', () => {
  const e = engine('explorers', 'blech');
  readyMain(e);
  const trail = addToHand(e, 'arch-game-trail', 'game-trail');
  const mountain = addToHand(e, 'mountain', 'reveal-mountain');

  e.perform('player', { type: 'PLAY_LAND', cardInstanceId: trail.instanceId });
  assert.equal(e.state.pendingChoice?.type, 'ENTRY_REVEAL');
  assert.ok(e.state.pendingChoice?.candidateIds.includes(mountain.instanceId));
  e.perform('player', { type: 'CHOOSE_ENTRY_REVEAL', cardInstanceId: mountain.instanceId });
  assert.equal(e.findPermanent(trail.instanceId)?.tapped, false);
});
