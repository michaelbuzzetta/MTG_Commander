import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../src/engine/GameEngine.js';
import { FuzzBot } from '../src/engine/fuzz/index.js';
import { HeadlessSimulationRunner } from '../src/engine/performance/index.js';
import { db, decks, engine, putBattlefield } from './helpers.js';

const playable = decks.filter(deck => deck.playable !== false);

function seededEngine(seed, performanceOptimizations) {
  return new GameEngine(playable[0], playable[1], db, {
    seed,
    startingPlayer: 'first',
    rulesVersion: 'step38-test',
    uidSequenceStart: 0,
    invariantChecks: true,
    performanceOptimizations,
    headless: true
  });
}

test('Step 38 derived-characteristic memoization invalidates on dependency changes', () => {
  const e = engine();
  e.setPerformanceProfiling(true);
  e._registerRuntimeCardDefinition('step38-hand-avatar', {
    id: 'step38-hand-avatar', name: 'Step 38 Hand Avatar', typeLine: 'Creature — Avatar', power: 0, toughness: 0,
    dynamicPowerToughness: 'handSize', keywords: [], abilities: []
  });
  const avatar = putBattlefield(e, 'player', 'step38-hand-avatar');
  const before = e.state.players.player.hand.length;
  assert.equal(e.getDerivedStats(avatar).power, before);
  assert.equal(e.getDerivedStats(avatar).power, before);
  assert.ok(e.getPerformanceSnapshot().stats.derivedHits >= 1, 'second stable query should hit the derived cache');
  e.state.players.player.hand.pop(); // legacy/direct mutation compatibility is intentionally detected by dependency fingerprint.
  assert.equal(e.getDerivedStats(avatar).power, before - 1);
});

test('Step 38 legal-action and zone candidate caches are state-safe and reusable', () => {
  const e = engine();
  const first = e.getLegalActions('player');
  const second = e.getLegalActions('player');
  assert.deepEqual(second, first);
  assert.ok(e.getPerformanceSnapshot().stats.legalActionHits >= 1);

  const bear = putBattlefield(e, 'player', 'grizzly-bears');
  const source = { targets: { kind: 'permanent', zone: 'battlefield' }, minTargets: 1, maxTargets: 1 };
  const one = e.targeting.getCandidates('player', source);
  const two = e.targeting.getCandidates('player', source);
  assert.ok(one.some(candidate => candidate.id === bear.instanceId));
  assert.deepEqual(two.map(candidate => candidate.id), one.map(candidate => candidate.id));
  assert.ok(e.getPerformanceSnapshot().stats.zoneHits >= 1);
});

test('Step 38 trigger and replacement indexes rebuild once per stable source topology', () => {
  const e = engine();
  e.setPerformanceProfiling(true);
  putBattlefield(e, 'player', 'treasure-maker');
  const target = putBattlefield(e, 'player', 'grizzly-bears');
  putBattlefield(e, 'player', 'hardened-scales');

  const a = e.triggers.registry.indexedSourcesForEvent('ENTER_BATTLEFIELD');
  const b = e.triggers.registry.indexedSourcesForEvent('ENTER_BATTLEFIELD');
  assert.deepEqual(b.map(row => row.definition.definitionId), a.map(row => row.definition.definitionId));

  e.replacements.preview('ADD_COUNTER', { permanentId: target.instanceId, counterType: '+1/+1', amount: 1, playerId: 'player' });
  e.replacements.preview('ADD_COUNTER', { permanentId: target.instanceId, counterType: '+1/+1', amount: 1, playerId: 'player' });
  const metrics = e.getPerformanceSnapshot().profiler;
  assert.equal(metrics['trigger-index.rebuild']?.count, 1);
  assert.equal(metrics['replacement-index.rebuild']?.count, 1);
});

test('Step 38 optimized and non-optimized seeded runs preserve identical replay/state results', () => {
  const run = performanceOptimizations => {
    const e = seededEngine('step38-hash-parity', performanceOptimizations);
    const bot = new FuzzBot(e, { seed: 'step38-hash-parity', maxActions: 6, persistFailures: false });
    return { result: bot.run(), trace: bot.trace, replay: JSON.parse(e.serializeReplay()) };
  };
  const optimized = run(true);
  const baseline = run(false);
  assert.equal(optimized.result.stateHash, baseline.result.stateHash);
  assert.deepEqual(optimized.trace, baseline.trace);
  assert.deepEqual(optimized.replay.actions.map(row => row.stateHash), baseline.replay.actions.map(row => row.stateHash));
});

test('Step 38 headless simulation mode supports four players and suppresses UI-facing rules logging', () => {
  const runner = new HeadlessSimulationRunner({ db, decks: playable.slice(0, 4), invariantChecks: true });
  const e = runner.createEngine({ seed: 'step38-headless-4p', playerCount: 4, profiling: true });
  assert.equal(e.headless, true);
  assert.equal(e.playerIds().length, 4);
  const result = new FuzzBot(e, { seed: 'step38-headless-4p', maxActions: 4, persistFailures: false }).run();
  assert.equal(result.ok, true);
  assert.equal(e.getRulesLogSnapshot().length, 0);
  assert.equal(e.checkInvariants({ throwOnFailure: false }).ok, true);
});
