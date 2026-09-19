#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import db from '../src/data/generated/cards.json' with { type: 'json' };
import decks from '../src/data/generated/decks.json' with { type: 'json' };
import thresholds from '../tests/performance/step38-thresholds.json' with { type: 'json' };
import { GameEngine } from '../src/engine/GameEngine.js';
import { FuzzBot } from '../src/engine/fuzz/index.js';
import { LAYER } from '../src/engine/continuous/index.js';

const playable = decks.filter(deck => deck.playable !== false);
if (playable.length < 4) throw new Error('Step 38 benchmark requires four playable decks.');

function elapsed(callback) {
  const started = globalThis.performance?.now?.() ?? Date.now();
  const result = callback();
  const ended = globalThis.performance?.now?.() ?? Date.now();
  return { ms: ended - started, result };
}

function isPermanent(definition = {}) {
  const line = String(definition.typeLine || '').toLowerCase();
  return line && !line.includes('instant') && !line.includes('sorcery');
}

function stressEngine() {
  const e = new GameEngine(playable[0], playable.slice(1, 4), db, {
    seed: 'step38-benchmark-board', startingPlayer: 'first', rulesVersion: 'step38-performance-v1',
  simulationPurpose: 'performance-benchmark',
  allowPartialSimulationOverride: true,
    invariantChecks: false, headless: true, performanceOptimizations: true, profilePerformance: true, uidSequenceStart: 0
  });
  for (const playerId of e.playerIds()) {
    const player = e.state.players[playerId];
    const ids = player.library.filter(card => isPermanent(e.db[card.cardId])).slice(0, 8).map(card => card.instanceId);
    for (const id of ids) e.zones.move(id, 'battlefield', playerId);
  }
  e.performance.markTopology('benchmark-board-setup');
  const battlefield = Object.values(e.state.players).flatMap(player => player.battlefield);
  // Add multiple global continuous effects to exercise layer ordering/caching on a busy board.
  for (let i = 0; i < Math.min(12, battlefield.length); i++) {
    e.continuous.register({
      id: `step38-bench-effect-${i}`,
      layer: LAYER.PT_MODIFY,
      duration: 'custom',
      filter: { zone: 'battlefield' },
      transform: { powerDelta: i % 2, toughnessDelta: (i + 1) % 2 }
    });
  }
  return { e, battlefield };
}

const { e, battlefield } = stressEngine();
// Warm caches once before timed repeated-query workloads.
for (const permanent of battlefield) e.getDerivedStats(permanent);
e.targeting.getCandidates('player', { targets: { kind: 'permanent', zone: 'battlefield' }, minTargets: 1, maxTargets: 1 });

const derived = elapsed(() => {
  for (let pass = 0; pass < 8; pass++) for (const permanent of battlefield) e.getDerivedStats(permanent);
});

const targetGeneration = elapsed(() => {
  const source = { targets: { kind: 'permanent', zone: 'battlefield' }, minTargets: 1, maxTargets: 1 };
  for (let i = 0; i < 24; i++) e.targeting.getCandidates('player', source);
});

const legalEngine = new GameEngine(playable[0], playable.slice(1, 4), db, {
  seed: 'step38-benchmark-legal', startingPlayer: 'first', invariantChecks: false,
  headless: true, performanceOptimizations: true, profilePerformance: true, uidSequenceStart: 0,
  simulationPurpose: 'performance-benchmark', allowPartialSimulationOverride: true
});
legalEngine.start();
const actor = legalEngine.state.pregame.currentPlayer;
legalEngine.getLegalActions(actor);
const legalActions = elapsed(() => {
  for (let i = 0; i < 40; i++) legalEngine.getLegalActions(actor);
});

const simEngine = new GameEngine(playable[0], playable.slice(1, 4), db, {
  seed: 'step38-benchmark-4p', startingPlayer: 'first', invariantChecks: true,
  headless: true, performanceOptimizations: true, profilePerformance: true, uidSequenceStart: 0,
  simulationPurpose: 'performance-benchmark', allowPartialSimulationOverride: true
});
const fourPlayer = elapsed(() => new FuzzBot(simEngine, { seed: 'step38-benchmark-4p', maxActions: 8, persistFailures: false }).run());

const measured = {
  derivedCharacteristicsMs: Number(derived.ms.toFixed(3)),
  targetGenerationMs: Number(targetGeneration.ms.toFixed(3)),
  legalActionRepeatedMs: Number(legalActions.ms.toFixed(3)),
  fourPlayerHeadless8ActionsMs: Number(fourPlayer.ms.toFixed(3))
};
const failures = Object.entries(measured).filter(([key, value]) => value > Number(thresholds[key]));
const report = {
  schema: 'mtg-step38-performance-benchmark', schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  node: process.version,
  workload: { players: 4, battlefieldPermanents: battlefield.length, continuousEffects: e.state.continuousEffects.length, derivedPasses: 8, targetPasses: 24, legalActionQueries: 40, headlessActions: 8 },
  measured,
  thresholds: Object.fromEntries(Object.keys(measured).map(key => [key, thresholds[key]])),
  passed: failures.length === 0,
  failures: failures.map(([key, value]) => ({ metric: key, value, threshold: thresholds[key] })),
  cacheStats: e.getPerformanceSnapshot(),
  headlessSimulation: { stateHash: fourPlayer.result.stateHash, actionsExecuted: fourPlayer.result.actionsExecuted, performance: simEngine.getPerformanceSnapshot() }
};
const out = path.resolve('performance-artifacts/step38-benchmarks.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(report, null, 2));
for (const [key, value] of Object.entries(measured)) console.log(`[step38] ${key}: ${value} ms (limit ${thresholds[key]} ms)`);
console.log(`[step38] report: ${out}`);
if (failures.length) {
  console.error(`[step38] ${failures.length} performance regression threshold(s) exceeded.`);
  process.exitCode = 1;
} else {
  console.log('[step38] performance thresholds PASS');
}
