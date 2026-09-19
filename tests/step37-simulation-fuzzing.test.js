import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../src/engine/GameEngine.js';
import { FuzzBot, FailureCorpus, ReplayMinimizer } from '../src/engine/fuzz/index.js';
import { db, decks } from './helpers.js';

const playable = decks.filter(deck => deck.playable !== false);

function make(seed = 'step37-smoke', a = 0, b = 1) {
  return new GameEngine(playable[a % playable.length], playable[b % playable.length], db, {
    seed,
    startingPlayer: 'first',
    rulesVersion: 'step37-test',
    uidSequenceStart: 0,
    invariantChecks: true
  });
}

test('Step 37 fuzz bot consumes only authoritative legal actions and preserves invariants', () => {
  const e = make('step37-smoke-a');
  const bot = new FuzzBot(e, { seed: 'step37-smoke-a', maxActions: 20, persistFailures: false });
  const result = bot.run();
  assert.equal(result.ok, true);
  assert.ok(result.actionsExecuted > 0);
  assert.equal(e.checkInvariants({ throwOnFailure: false }).ok, true);
  assert.ok(JSON.parse(e.serializeReplay()).actions.length > 0);
});

test('Step 37 same game seed and bot seed reproduce the same fuzz trace/state hash', () => {
  const run = () => {
    const e = make('step37-repro-seed');
    const bot = new FuzzBot(e, { seed: 'step37-repro-seed', maxActions: 20, persistFailures: false });
    return { result: bot.run(), trace: bot.trace };
  };
  const a = run();
  const b = run();
  assert.equal(a.result.stateHash, b.result.stateHash);
  assert.deepEqual(a.trace, b.trace);
});

test('Step 37 explores multiple deck pairings with seeded random legal actions', () => {
  const summaries = [];
  const count = Math.min(3, playable.length - 1);
  for (let i = 0; i < count; i++) {
    const e = make(`step37-pair-${i}`, i, i + 1);
    const bot = new FuzzBot(e, { seed: `step37-pair-${i}`, maxActions: 15, persistFailures: false });
    summaries.push(bot.run());
  }
  assert.equal(summaries.length, count);
  assert.ok(summaries.every(row => row.ok && row.actionsExecuted > 0));
});

test('Step 37 failure corpus persists seed and replay reproduction artifacts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtg-step37-corpus-'));
  const e = make('step37-corpus');
  e.start();
  const corpus = new FailureCorpus(dir);
  const error = Object.assign(new Error('synthetic fuzz failure'), { code: 'SYNTHETIC_FAILURE' });
  const persisted = corpus.persist({ seed: 'step37-corpus', botSeed: 'step37-corpus:bot', error, engine: e, actionIndex: 0, action: null });
  assert.ok(fs.existsSync(persisted.reportPath));
  assert.ok(fs.existsSync(persisted.replayPath));
  const report = JSON.parse(fs.readFileSync(persisted.reportPath, 'utf8'));
  assert.equal(report.seed, 'step37-corpus');
  assert.equal(report.error.code, 'SYNTHETIC_FAILURE');
});

test('Step 37 replay minimizer finds the shortest failing prefix without reordering actions', () => {
  const replay = { actions: [1, 2, 3, 4, 5].map((n) => ({ sequence: n, action: { type: `A${n}` } })) };
  const minimized = ReplayMinimizer.minimizePrefix(replay, candidate => candidate.actions.length >= 3);
  assert.equal(minimized.actions.length, 3);
  assert.deepEqual(minimized.actions, replay.actions.slice(0, 3));
});
