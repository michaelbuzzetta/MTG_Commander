import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getBuiltInCardDatabase, getBuiltInDecks } from '../src/database/index.js';
import { HeadlessSimulationRunner } from '../src/engine/performance/HeadlessSimulationRunner.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, 'release-artifacts', 'gameplay-release-audit.json');
const WORKER = path.join(ROOT, 'scripts', 'run-gameplay-release-simulation.mjs');
const ACTION_BUDGET = Math.max(5, Number(process.env.MTG_GAMEPLAY_AUDIT_ACTIONS || 20));
const RUN_TIMEOUT_MS = Math.max(10000, Number(process.env.MTG_GAMEPLAY_AUDIT_TIMEOUT_MS || 30000));

const scenarios = Object.freeze([
  { id: 'temporal-vs-never-ending', deckIds: ['temporal-paradox', 'never-ending-story'], playerCount: 2, runs: 2 },
  { id: 'temporal-vs-explorers', deckIds: ['temporal-paradox', 'explorers'], playerCount: 2, runs: 2 },
  { id: 'never-ending-vs-explorers', deckIds: ['never-ending-story', 'explorers'], playerCount: 2, runs: 2 },
  { id: 'three-deck-user-pod', deckIds: ['explorers', 'temporal-paradox', 'never-ending-story'], playerCount: 3, runs: 1 }
]);

const db = getBuiltInCardDatabase();
const allDecks = getBuiltInDecks();
const deckById = new Map(allDecks.map(deck => [deck.id, deck]));
const results = [];
let totalActions = 0;
let failures = 0;

for (const scenario of scenarios) {
  const selected = scenario.deckIds.map(id => deckById.get(id));
  const missing = scenario.deckIds.filter((id, index) => !selected[index]);
  if (missing.length) throw new Error(`Gameplay release audit is missing deck(s): ${missing.join(', ')}`);
  console.log(`Scenario ${scenario.id}: ${scenario.deckIds.join(' vs ')} (${scenario.runs} run(s))`);

  const preflightRunner = new HeadlessSimulationRunner({
    db,
    decks: selected,
    invariantChecks: true,
    performanceOptimizations: true,
    engineOptions: { allowPartialSimulationOverride: true }
  });
  const preflight = preflightRunner.preflight({ playerCount: scenario.playerCount, strict: false });
  const scenarioResult = {
    id: scenario.id,
    deckIds: scenario.deckIds,
    deckNames: selected.map(deck => deck.name),
    playerCount: scenario.playerCount,
    requestedRuns: scenario.runs,
    actionBudgetPerRun: ACTION_BUDGET,
    preflight: {
      strictReady: !!preflight.strictReady,
      blockerCount: preflight.blockers?.length || 0,
      decks: (preflight.decks || []).map(deck => ({
        deckId: deck.deckId,
        name: deck.name,
        cardCount: deck.cardCount,
        statusCounts: deck.statusCounts,
        blockerCount: deck.blockers?.length || 0,
        silentUnsupportedCount: deck.silentUnsupportedCount || 0
      }))
    },
    runs: []
  };

  for (let index = 0; index < scenario.runs; index++) {
    const seed = `gameplay-release:${scenario.id}:${index}`;
    console.log(`  run ${index + 1}/${scenario.runs}: ${seed}`);
    const startedAt = Date.now();
    const child = spawnSync(process.execPath, [WORKER, scenario.deckIds.join(','), String(scenario.playerCount), seed, String(ACTION_BUDGET)], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: RUN_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024
    });
    const elapsedMs = Date.now() - startedAt;
    let payload = null;
    try {
      const lines = String(child.stdout || '').trim().split(/\r?\n/).filter(Boolean);
      payload = lines.length ? JSON.parse(lines.at(-1)) : null;
    } catch {}

    if (child.status === 0 && payload?.ok) {
      totalActions += payload.result.actionsExecuted;
      console.log(`    passed in ${elapsedMs}ms (${payload.result.actionsExecuted} actions)`);
      scenarioResult.runs.push({
        ok: true,
        seed,
        elapsedMs,
        ...payload.result,
        unsupportedDiagnosticCount: payload.unsupportedDiagnosticCount || 0,
        statisticsEligible: !!payload.statisticsEligible
      });
    } else {
      failures += 1;
      const timedOut = child.error?.code === 'ETIMEDOUT';
      console.log(`    FAILED in ${elapsedMs}ms${timedOut ? ' (timeout)' : ''}`);
      scenarioResult.runs.push({
        ok: false,
        seed,
        elapsedMs,
        code: payload?.code || child.error?.code || `worker-exit-${child.status}`,
        message: payload?.message || child.error?.message || String(child.stderr || 'Gameplay audit worker failed.'),
        timedOut,
        fuzz: payload?.fuzz || null
      });
    }
  }
  results.push(scenarioResult);
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  purpose: 'Gameplay-focused release audit: exercise the user-facing 100-card decks through authoritative legal actions with invariant checks enabled. This is interaction-failure discovery, not a win-rate benchmark.',
  actionBudgetPerRun: ACTION_BUDGET,
  perRunTimeoutMs: RUN_TIMEOUT_MS,
  scenarioCount: results.length,
  simulationCount: results.reduce((sum, row) => sum + row.runs.length, 0),
  totalActions,
  failureCount: failures,
  passed: failures === 0,
  supportPolicy: 'Partial support is allowed for this exploratory gameplay audit. Any actually encountered unsupported runtime interaction still fails closed in standard mode; no sandbox approximation is enabled.',
  scenarios: results
};

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Gameplay release audit: ${report.simulationCount} simulations, ${report.totalActions} authoritative actions, ${report.failureCount} failures.`);
console.log(`Wrote ${path.relative(ROOT, OUTPUT)}.`);
if (failures) process.exitCode = 1;
