import { getBuiltInCardDatabase, getBuiltInDecks } from '../src/database/index.js';
import { HeadlessSimulationRunner } from '../src/engine/performance/HeadlessSimulationRunner.js';

const [deckArg = '', playerArg = '2', seed = 'gameplay-release-worker', actionsArg = '20'] = process.argv.slice(2);
const deckIds = deckArg.split(',').filter(Boolean);
const playerCount = Number(playerArg);
const maxActions = Number(actionsArg);
const db = getBuiltInCardDatabase();
const all = getBuiltInDecks();
const decks = deckIds.map(id => all.find(deck => deck.id === id));
const missing = deckIds.filter((id, index) => !decks[index]);
if (missing.length) throw new Error(`Missing deck(s): ${missing.join(', ')}`);

const runner = new HeadlessSimulationRunner({
  db,
  decks,
  invariantChecks: true,
  performanceOptimizations: true,
  engineOptions: { allowPartialSimulationOverride: true }
});

try {
  const run = runner.runFuzz({ seed, playerCount, maxActions });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    result: run.result,
    unsupportedDiagnosticCount: run.supportPolicy?.diagnosticCount || 0,
    statisticsEligible: !!run.statisticsEligible
  })}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    ok: false,
    code: error?.code || null,
    message: error?.message || String(error),
    fuzz: error?.fuzz || null
  })}\n`);
  process.exitCode = 1;
}
