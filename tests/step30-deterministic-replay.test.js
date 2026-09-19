import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GameEngine } from '../src/engine/GameEngine.js';
import { ReplayRunner } from '../src/engine/replay/index.js';
import { AIController } from '../src/ai/index.js';
import { db, decks } from './helpers.js';

const playable = decks.filter(deck => deck.playable !== false);

function make(seed = 'step30-seed') {
  const game = new GameEngine(playable[0], playable[1], db, { seed, startingPlayer: 'random' });
  game.start();
  return game;
}

function actorFor(game) {
  const state = game.getStateSnapshot();
  return state.pendingChoice?.playerId || (state.pregame?.active ? state.pregame.currentPlayer : state.priorityPlayer);
}

function drive(game, count = 20) {
  for (let i = 0; i < count && !game.getStateSnapshot().winner; i++) {
    const actor = actorFor(game);
    assert.ok(actor, `missing actor at action ${i}`);
    const ai = new AIController(game, actor);
    const action = ai.choose();
    assert.ok(action, `missing action for ${actor}`);
    ai.submit(action);
  }
}

test('Step 30: same seed reproduces opening state and RNG ledger', () => {
  const a = make('same-seed');
  const aState = a.getStateSnapshot();
  const aRng = a.getReplayMetadata().rng;
  const b = new GameEngine(playable[0], playable[1], db, {
    seed: 'same-seed',
    startingPlayer: 'random',
    uidSequenceStart: a.getReplayMetadata().uidSequenceStart
  });
  b.start();
  assert.deepEqual(
    Object.fromEntries(Object.entries(aState.players).map(([id, p]) => [id, p.library.map(c => c.cardId)])),
    Object.fromEntries(Object.entries(b.getStateSnapshot().players).map(([id, p]) => [id, p.library.map(c => c.cardId)]))
  );
  assert.equal(aState.activePlayer, b.getStateSnapshot().activePlayer);
  assert.equal(aRng.calls, b.getReplayMetadata().rng.calls);
});

test('Step 30: replay runner reproduces every recorded action hash and final state hash', () => {
  const original = make('replay-seed');
  drive(original, 24);
  const replay = original.serializeReplay();
  const result = ReplayRunner.run(replay, { deckA: playable[0], deckB: playable[1], db });
  assert.equal(result.finalStateHash, JSON.parse(replay).finalStateHash);
  assert.equal(result.checkpoints.length, JSON.parse(replay).actions.length);
  assert.ok(result.checkpoints.every(point => typeof point.stateHash === 'string' && point.stateHash.length === 16));
});

test('Step 30: replay detects tampered checkpoint hashes', () => {
  const original = make('tamper-seed');
  drive(original, 8);
  const replay = JSON.parse(original.serializeReplay());
  replay.actions[0].stateHash = '0000000000000000';
  assert.throws(
    () => ReplayRunner.run(replay, { deckA: playable[0], deckB: playable[1], db }),
    /state hash mismatch/
  );
});

test('Step 30: checkpoints restore full authoritative state and seeded RNG state', () => {
  const game = make('checkpoint-seed');
  drive(game, 8);
  const checkpoint = game.createCheckpoint('before-more-actions');
  const checkpointHash = game.getReplayStateHash();
  const rngCalls = game.getReplayMetadata().rng.calls;
  drive(game, 6);
  assert.notEqual(game.getReplayStateHash(), checkpointHash);
  game.loadCheckpoint(checkpoint);
  assert.equal(game.getReplayStateHash(), checkpointHash);
  assert.equal(game.getReplayMetadata().rng.calls, rngCalls);
  assert.equal(game.getStateSnapshot().pendingChoice?.type || null, JSON.parse(checkpoint.state).state.pendingChoice?.type || null);
  assert.deepEqual(game.getStateSnapshot().stack, JSON.parse(checkpoint.state).state.stack);
});

test('Step 30: replay metadata contains seed, rules/database versions and bug reproduction coordinates', () => {
  const game = make('metadata-seed');
  drive(game, 4);
  const replay = JSON.parse(game.serializeReplay());
  assert.equal(replay.schema, 'mtg-commander-replay');
  assert.equal(replay.schemaVersion, 1);
  assert.equal(replay.metadata.seed, 'metadata-seed');
  assert.equal(replay.metadata.rulesVersion, 'workflow-step30-v1');
  assert.equal(replay.metadata.cardDatabaseVersion, 'embedded-generated-db');
  assert.ok(Number.isInteger(replay.actions.at(-1).sequence));
  assert.ok(replay.actions.at(-1).turn >= 1);
  assert.equal(typeof replay.actions.at(-1).phase, 'string');
  assert.ok(Number.isInteger(replay.actions.at(-1).rngCalls));
});

test('Step 30: all successful replay actions carry deterministic post-action hashes', () => {
  const game = make('hash-seed');
  drive(game, 12);
  const actions = JSON.parse(game.serializeReplay()).actions;
  assert.ok(actions.length > 0);
  assert.ok(actions.every(entry => /^[0-9a-f]{16}$/.test(entry.stateHash)));
});

test('Step 30: rules and AI modules contain no direct Math.random calls', () => {
  const roots = [new URL('../src/engine/', import.meta.url), new URL('../src/ai/', import.meta.url)];
  const files = [];
  const walk = url => {
    for (const entry of fs.readdirSync(url, { withFileTypes: true })) {
      const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), url);
      if (entry.isDirectory()) walk(child);
      else if (entry.name.endsWith('.js')) files.push(child);
    }
  };
  roots.forEach(walk);
  const offenders = files.filter(file => fs.readFileSync(file, 'utf8').includes('Math.random'));
  assert.deepEqual(offenders.map(file => file.pathname), []);
});

test('Step 30: explicit shuffles consume only the centralized game RNG service', () => {
  const game = make('shuffle-seed');
  const before = game.getReplayMetadata().rng.calls;
  game.shuffleLibrary('player', 'step30-test');
  const after = game.getReplayMetadata().rng.calls;
  assert.equal(after - before, Math.max(0, game.getStateSnapshot().players.player.library.length - 1));
});
