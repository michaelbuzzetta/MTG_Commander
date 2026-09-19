import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGame, GameEngine } from '../src/engine/GameEngine.js';
import { PUBLIC_GAME_ENGINE_METHODS } from '../src/engine/public/api.js';
import { checkArchitecture } from '../scripts/check-architecture.mjs';
import { db, decks } from './helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function freshGame() {
  const a = decks.find(deck => deck.id === 'explorers');
  const b = decks.find(deck => deck.id === 'blech');
  const game = createGame(a, b, db, { rng: () => 0.42 });
  game.start();
  return game;
}

test('Step 1: required GameEngine public API is present', () => {
  assert.equal(typeof createGame, 'function');
  assert.equal(typeof GameEngine.createGame, 'function');
  const game = freshGame();
  for (const method of PUBLIC_GAME_ENGINE_METHODS.filter(name => name !== 'createGame')) {
    assert.equal(typeof game[method], 'function', `${method} must be public`);
  }
});

test('Step 1: state and database snapshots are immutable and detached from authoritative state', () => {
  const game = freshGame();
  const snapshot = game.getStateSnapshot();
  const database = game.getCardDatabaseSnapshot();
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.players));
  assert.ok(Object.isFrozen(snapshot.players.player));
  assert.ok(Object.isFrozen(snapshot.players.player.hand));
  assert.ok(Object.isFrozen(database));
  const originalLife = game.state.players.player.life;
  assert.throws(() => { snapshot.players.player.life = 1; }, TypeError);
  assert.equal(game.state.players.player.life, originalLife);
  const firstCardId = Object.keys(database)[0];
  assert.throws(() => { database[firstCardId].name = 'mutated'; }, TypeError);
  assert.notEqual(game.db[firstCardId].name, 'mutated');
});

test('Step 1: illegal public actions return structured errors without changing state', () => {
  const game = freshGame();
  const before = JSON.stringify(game.getStateSnapshot());
  const result = game.submitAction('player', { type: 'CAST_SPELL', cardInstanceId: 'not-a-card' });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'ILLEGAL_ACTION');
  assert.equal(result.error.playerId, 'player');
  assert.equal(result.error.actionType, 'CAST_SPELL');
  assert.equal(JSON.stringify(game.getStateSnapshot()), before);
});

test('Step 1: submitChoice and passPriority expose structured public gateways', () => {
  const game = freshGame();
  const noChoice = game.submitChoice('player', { type: 'KEEP_HAND' });
  assert.equal(noChoice.ok, false);
  assert.equal(noChoice.error.code, 'NO_PENDING_CHOICE');
  const prematurePass = game.passPriority('player');
  assert.equal(prematurePass.ok, false);
  assert.equal(prematurePass.error.code, 'ILLEGAL_ACTION');
});

test('Step 1: successful public actions are serialized into the replay action log', () => {
  const game = freshGame();
  const first = game.submitAction('player', { type: 'KEEP_HAND' });
  assert.equal(first.ok, true);
  const second = game.submitAction('ai', { type: 'KEEP_HAND' });
  assert.equal(second.ok, true);
  const replay = JSON.parse(game.serializeReplay());
  assert.equal(replay.apiVersion, 1);
  assert.equal(replay.actions.length, 2);
  assert.deepEqual(replay.actions.map(entry => entry.action.type), ['KEEP_HAND', 'KEEP_HAND']);
});

test('Step 1: production UI and AI cannot use authoritative state or internal engine subsystems directly', () => {
  assert.deepEqual(checkArchitecture(), []);
});

test('Step 1: mutation inventory classifies production UI and AI as zero authoritative mutation paths', () => {
  const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/architecture/step1-mutation-inventory.json'), 'utf8'));
  const consumers = inventory.entries.filter(entry => entry.category === 'UI/consumer' || entry.category === 'AI');
  const engineMutations = inventory.entries.filter(entry => entry.category === 'core engine' || entry.category === 'card/mechanic engine');
  assert.deepEqual(consumers, []);
  assert.ok(engineMutations.length > 0, 'inventory must retain the existing internal mutation paths for later migration');
});

test('Step 1: legacy adapters remain registered but production callers have migrated', () => {
  const game = freshGame();
  const registry = game.getLegacyAdapterRegistry();
  assert.ok(registry.some(entry => entry.id === 'GameEngine.perform' && entry.status === 'deprecated'));
  assert.ok(registry.some(entry => entry.id === 'GameEngine.state'));
  assert.doesNotThrow(() => game.perform('player', { type: 'KEEP_HAND' }));
});
