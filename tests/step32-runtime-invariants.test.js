import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../src/engine/GameEngine.js';
import { db, decks } from './helpers.js';

const playable = decks.filter(deck => deck.playable !== false);
function make(seed = 'step32-seed') {
  const e = new GameEngine(playable[0], playable[1], db, { seed, startingPlayer: 'first', rulesVersion: 'step32-test' });
  e.start();
  return e;
}

test('Step 32 healthy authoritative state passes runtime invariants', () => {
  const e = make();
  const report = e.checkInvariants();
  assert.equal(report.ok, true);
  assert.equal(report.failures.length, 0);
  assert.ok(report.stateHash);
});

test('Step 32 detects a physical card duplicated across zones', () => {
  const e = make();
  const pid = e.state.playerOrder[0];
  const card = e.state.players[pid].library[0];
  e.state.players[pid].hand.push(card);
  assert.throws(() => e.checkInvariants(), err => err.code === 'INVARIANT_VIOLATION' && err.failures.some(f => f.code === 'OBJECT_IN_MULTIPLE_ZONES'));
});

test('Step 32 detects a zone/object declaration mismatch', () => {
  const e = make();
  const pid = e.state.playerOrder[0];
  const card = e.state.players[pid].library[0];
  card.zone = 'graveyard';
  assert.throws(() => e.checkInvariants(), err => err.failures.some(f => f.code === 'OBJECT_ZONE_MISMATCH'));
});

test('Step 32 detects invalid stack references', () => {
  const e = make();
  e.state.stack.push({ id: 'bad-stack', gameObjectId: 'bad-stack-obj', type: 'ability', controller: 'missing-player', targets: [], selectedModes: [], additionalCosts: [], copyMetadata: {} });
  assert.throws(() => e.checkInvariants(), err => err.failures.some(f => f.code === 'STACK_CONTROLLER_MISSING'));
});

test('Step 32 prevents eliminated players from retaining priority', () => {
  const e = make();
  const pid = e.state.priorityPlayer || e.state.activePlayer;
  e.state.players[pid].lost = true;
  e.state.priorityPlayer = pid;
  assert.throws(() => e.checkInvariants(), err => err.failures.some(f => f.code === 'ELIMINATED_PLAYER_HAS_PRIORITY'));
});

test('Step 32 detects missing attachment relationships', () => {
  const e = make();
  e.state.attachments.push({ id: 'broken-attachment', attachedId: 'missing-aura', hostId: 'missing-host', hostKind: 'permanent' });
  assert.throws(() => e.checkInvariants(), err => err.failures.some(f => f.code === 'ATTACHMENT_SOURCE_MISSING') && err.failures.some(f => f.code === 'ATTACHMENT_HOST_MISSING'));
});

test('Step 32 detects NaN authoritative/derived numeric state', () => {
  const e = make();
  const pid = e.state.playerOrder[0];
  e.state.players[pid].life = Number.NaN;
  assert.throws(() => e.checkInvariants(), err => err.failures.some(f => f.code === 'INVALID_NUMERIC_PLAYER_STATE'));
});

test('Step 32 catches injected corruption at the next action transaction boundary', () => {
  const e = make();
  const pid = e.state.priorityPlayer;
  assert.ok(pid);
  const card = e.state.players[pid].library[0];
  e.state.players[pid].hand.push(card);
  const result = e.submitAction(pid, { type: 'PASS_PRIORITY' });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'INVARIANT_VIOLATION');
  const failure = e.getInvariantFailureBundle();
  assert.ok(failure?.report?.failures?.some(f => f.code === 'OBJECT_IN_MULTIPLE_ZONES'));
  assert.equal(failure?.diagnosticBundle?.reproduction?.rulesVersion, 'step32-test');
  assert.ok(Array.isArray(failure?.diagnosticBundle?.logs?.developer));
});

test('Step 32 invariant checks can be disabled for explicit developer setup only', () => {
  const e = make();
  e.setInvariantChecks(false);
  const pid = e.state.playerOrder[0];
  const card = e.state.players[pid].library[0];
  e.state.players[pid].hand.push(card);
  const report = e.checkInvariants();
  assert.equal(report.ok, true);
  assert.equal(report.skipped, true);
});

test('Step 32 detects a non-token physical card disappearing from authoritative zones', () => {
  const e = make();
  const pid = e.state.playerOrder[0];
  e.state.players[pid].library.pop();
  assert.throws(() => e.checkInvariants(), err => err.failures.some(f => f.code === 'PHYSICAL_CARD_DISAPPEARED'));
});

test('Step 32 detects duplicate active gameObjectIds', () => {
  const e = make();
  const pid = e.state.playerOrder[0];
  const [a, b] = e.state.players[pid].library;
  b.gameObjectId = a.gameObjectId;
  assert.throws(() => e.checkInvariants(), err => err.failures.some(f => f.code === 'DUPLICATE_GAME_OBJECT_ID'));
});
