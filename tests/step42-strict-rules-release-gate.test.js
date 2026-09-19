import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GameEngine } from '../src/engine/GameEngine.js';
import { HeadlessSimulationRunner } from '../src/engine/performance/index.js';
import { StrictModeViolation, STRICT_ENGINE_BUILD, STRICT_RULES_MODE_VERSION } from '../src/engine/strict/index.js';
import { db } from './helpers.js';

function strictReadyDeck(id) {
  return {
    id,
    name: `Strict Ready ${id}`,
    format: 'Commander',
    commander: 'hakbal',
    colorIdentity: ['G', 'U'],
    cards: [
      { id: 'hakbal', quantity: 1 },
      { id: 'forest', quantity: 99 }
    ],
    cardCount: 100
  };
}

const a = strictReadyDeck('step42-a');
const b = strictReadyDeck('step42-b');
const syntheticSupport = {
  cards: [
    { cardId: 'hakbal', name: db.hakbal.name, supportStatus: 'fully_supported', strictEligible: true, caveats: [], testCount: 2, requiredCustomHooks: [], lastValidatedRulesVersion: 'step42-test' },
    { cardId: 'forest', name: db.forest.name, supportStatus: 'fully_supported', strictEligible: true, caveats: [], testCount: 2, requiredCustomHooks: [], lastValidatedRulesVersion: 'step42-test' }
  ]
};

function strictEngine(extra = {}) {
  return new GameEngine(a, b, db, {
    seed: 'step42-strict-seed',
    validateDecks: false,
    rulesVersion: 'step42-test-rules',
    cardDatabaseVersion: 'step42-test-db',
    simulationPurpose: 'official-simulation',
    cardSupportOptions: { supportPayload: syntheticSupport },
    strictRulesMode: true,
    invariantChecks: true,
    ...extra
  });
}

test('Step 42 strict config exposes all release guarantees and startup preflight passes only with certified inputs', () => {
  const engine = strictEngine();
  const config = engine.getStrictModeConfig();
  assert.equal(config.enabled, true);
  assert.equal(config.version, STRICT_RULES_MODE_VERSION);
  assert.equal(config.guarantees.noApproximations, true);
  assert.equal(config.guarantees.noUnsupportedScripts, true);
  assert.equal(config.guarantees.noManualStateEdits, true);
  assert.equal(config.guarantees.noSkippedMandatoryTriggers, true);
  assert.equal(config.guarantees.aiUsesAuthoritativeLegalActionsOnly, true);
  assert.equal(config.guarantees.deterministicSimulationRandomness, true);

  const report = engine.getStrictPreflightReport();
  assert.equal(report.strictReady, true);
  assert.equal(report.engineBuild, STRICT_ENGINE_BUILD);
  assert.equal(report.rulesVersion, 'step42-test-rules');
  assert.equal(report.cardDatabaseVersion, 'step42-test-db');
  assert.equal(report.deckSupport.blockers.length, 0);
  assert.ok(report.checks.every(row => row.ok));
});

test('Step 42 startup preflight fails closed for missing mechanic modules, external RNG, or disabled invariants', () => {
  assert.throws(
    () => strictEngine({ strictRulesMode: { enabled: true, requiredMechanics: ['step42-not-a-real-mechanic'] } }),
    error => error instanceof StrictModeViolation && error.code === 'STRICT_PREFLIGHT_FAILED' && error.failures.some(row => row.id === 'required-mechanic-modules')
  );

  assert.throws(
    () => strictEngine({ seed: null, rng: () => 0.5 }),
    error => error instanceof StrictModeViolation && error.code === 'STRICT_PREFLIGHT_FAILED' && error.failures.some(row => row.id === 'deterministic-simulation-randomness')
  );

  assert.throws(
    () => strictEngine({ invariantChecks: false }),
    error => error instanceof StrictModeViolation && error.code === 'STRICT_PREFLIGHT_FAILED' && error.failures.some(row => row.id === 'runtime-invariant-checks')
  );
});

test('Step 42 strict gameplay locks developer/manual mutation tools while internal transactional restore remains available', () => {
  const engine = strictEngine();
  const snapshot = engine.serializeState();
  const checkpoint = engine.createCheckpoint('strict-test-checkpoint');

  for (const invoke of [
    () => engine.restoreState(snapshot),
    () => engine.loadCheckpoint(checkpoint),
    () => engine._registerRuntimeCardDefinition('step42-dev-card', { id: 'step42-dev-card', name: 'Dev Card', typeLine: 'Artifact' }),
    () => engine.registerTokenDefinition({ id: 'step42-dev-token', name: 'Dev Token', typeLine: 'Token Creature', power: 1, toughness: 1 }),
    () => engine.registerLegalityRule({ id: 'step42-dev-rule', operation: 'cast', kind: 'restriction', applies: () => true }),
    () => engine.setInvariantChecks(false)
  ]) {
    assert.throws(invoke, error => error instanceof StrictModeViolation && error.code === 'STRICT_MODE_FORBIDDEN_TOOL');
  }

  assert.doesNotThrow(() => engine.replay.restoreCheckpoint(checkpoint));
  assert.equal(engine.getReplayStateHash(), checkpoint.stateHash);
});

test('Step 42 strict certification is attached to replay output with versions, preflight result, seed, and replay hash', () => {
  const engine = strictEngine();
  engine.start();
  const certification = engine.getSimulationCertification();
  assert.equal(certification.certified, true);
  assert.equal(certification.strictModeVersion, STRICT_RULES_MODE_VERSION);
  assert.equal(certification.engineBuild, STRICT_ENGINE_BUILD);
  assert.equal(certification.rulesVersion, 'step42-test-rules');
  assert.equal(certification.cardDatabaseVersion, 'step42-test-db');
  assert.equal(certification.preflightResult.strictReady, true);
  assert.equal(certification.unsupportedPolicy.mode, 'strict');
  assert.equal(certification.unsupportedPolicy.diagnosticCount, 0);
  assert.equal(certification.rng.deterministic, true);
  assert.equal(certification.rng.seed, 'step42-strict-seed');
  assert.match(certification.replayHash, /^[0-9a-f]{16}$/);

  const replay = JSON.parse(engine.serializeReplay());
  assert.equal(replay.metadata.engineBuild, STRICT_ENGINE_BUILD);
  assert.equal(replay.metadata.strictRulesMode.enabled, true);
  assert.equal(replay.metadata.strictPreflightReady, true);
  assert.equal(replay.strictCertification.certified, true);
  assert.equal(replay.strictCertification.replayHash, replay.finalStateHash);
});

test('Step 42 official headless simulation emits a valid strict certification and cannot enable partial/sandbox escape hatches', () => {
  const runner = new HeadlessSimulationRunner({
    db,
    decks: [a, b],
    engineOptions: {
      validateDecks: false,
      cardSupportOptions: { supportPayload: syntheticSupport },
      rulesVersion: 'step42-runner-rules',
      cardDatabaseVersion: 'step42-runner-db'
    }
  });
  const output = runner.runOfficialFuzz({ seed: 'step42-runner-seed', playerCount: 2, maxActions: 4 });
  assert.equal(output.statisticsEligible, true);
  assert.equal(output.strictPreflight.strictReady, true);
  assert.equal(output.certification.certified, true);
  assert.equal(output.certification.rulesVersion, 'step42-runner-rules');
  assert.equal(output.certification.cardDatabaseVersion, 'step42-runner-db');
  assert.equal(output.replay.strictCertification.certified, true);

  assert.throws(
    () => runner.createEngine({ seed: 'step42-sandbox-block', playerCount: 2, officialSimulation: true, unsupportedInteractionMode: 'sandbox' }),
    /cannot run in permissive sandbox mode/i
  );
});

test('Step 42 release checklist declares all strict release gates and package scripts wire the gate into verification', () => {
  const checklist = JSON.parse(fs.readFileSync(new URL('../step42-release-checklist.json', import.meta.url), 'utf8'));
  const ids = new Set(checklist.gates.map(row => row.id));
  for (const id of ['architecture','support-metadata','triggers','ai-legality','replay','invariants','primitives','interactions','golden-cards','judge-scenarios','fuzzing','performance','unsupported-failsafes','strict-mode']) {
    assert.equal(ids.has(id), true, `missing release gate ${id}`);
  }
  assert.ok(checklist.gates.every(row => typeof row.command === 'string' && row.command.length > 0));

  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(pkg.scripts['check:step42']);
  assert.ok(pkg.scripts['test:step42']);
  assert.ok(pkg.scripts['release:step42']);
  assert.match(pkg.scripts.verify, /check:step42/);
  assert.match(pkg.scripts.verify, /test:step42/);
});
