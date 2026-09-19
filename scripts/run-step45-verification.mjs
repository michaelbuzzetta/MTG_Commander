#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const artifact = path.resolve('release-artifacts/step45-full-verification.json');
fs.mkdirSync(path.dirname(artifact), { recursive: true });

const commands = [
  ['card-db', 'node', ['scripts/build-card-db.mjs', '--check']],
  ['support', 'node', ['scripts/build-card-support.mjs', '--check']],
  ['oracle-templates', 'node', ['scripts/build-oracle-templates.mjs', '--check']],
  ['architecture', 'node', ['scripts/check-architecture.mjs']],
  ['step33-check', 'node', ['scripts/check-rule-primitive-coverage.mjs']],
  ['step34-check', 'node', ['scripts/check-step34-interaction-matrix.mjs']],
  ['step35-check', 'node', ['scripts/check-step35-golden-cards.mjs']],
  ['step36-check', 'node', ['scripts/check-step36-judge-scenarios.mjs']],
  ['step37-check', 'node', ['scripts/check-step37-fuzzing.mjs']],
  ['step38-check', 'node', ['scripts/check-step38-performance.mjs']],
  ['step39-check', 'node', ['scripts/check-step39-ui.mjs']],
  ['step40-build', 'node', ['scripts/build-step40-dashboard.mjs']],
  ['step40-check', 'node', ['scripts/check-step40-dashboard.mjs']],
  ['step41-check', 'node', ['scripts/check-step41-unsupported-failsafes.mjs']],
  ['step42-check', 'node', ['scripts/check-step42-strict-release.mjs']],
  ['step43-check', 'node', ['scripts/check-step43-update-pipeline.mjs']],
  ['step43-current', 'node', ['scripts/update-card-database-step43.mjs', '--check']],
  ['step44-build', 'node', ['scripts/build-step44-rules-impact.mjs']],
  ['step44-check', 'node', ['scripts/check-step44-rules-versioning.mjs']],
  ['step45-build', 'node', ['scripts/build-step45-final-coverage.mjs']],
  ['step45-check', 'node', ['scripts/check-step45-practical-coverage.mjs']],
  ['step30-45-tests', 'node', ['--test', '--test-concurrency=1',
    'tests/step30-deterministic-replay.test.js',
    'tests/step31-rules-event-logging.test.js',
    'tests/step32-runtime-invariants.test.js',
    'tests/step33-rules-primitives.test.js',
    'tests/step34-cross-system-interactions.test.js',
    'tests/step35-golden-card-behavior.test.js',
    'tests/step36-judge-scenarios.test.js',
    'tests/step37-simulation-fuzzing.test.js',
    'tests/step38-performance-scalability.test.js',
    'tests/step39-rules-driven-ui.test.js',
    'tests/step40-card-support-dashboard.test.js',
    'tests/step41-unsupported-interactions.test.js',
    'tests/step42-strict-rules-release-gate.test.js',
    'tests/step43-oracle-card-update-pipeline.test.js',
    'tests/step44-rules-versioning-compatibility.test.js',
    'tests/step45-final-edge-case-pass.test.js'
  ]],
  ['release-fuzz-artifact', 'node', ['scripts/check-step45-fuzz-artifact.mjs']],
  ['performance-benchmark', 'node', ['scripts/run-step38-benchmarks.mjs']]
];

const results = [];
let failed = false;
for (const [id, executable, args] of commands) {
  const started = Date.now();
  const run = spawnSync(executable, args, {
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 32 * 1024 * 1024,
    timeout: 120000
  });
  const output = `${run.stdout || ''}${run.stderr || ''}`.trim();
  const ok = run.status === 0 && !run.error;
  results.push({
    id,
    command: [executable, ...args].join(' '),
    ok,
    status: run.status,
    signal: run.signal || null,
    error: run.error?.message || null,
    durationMs: Date.now() - started,
    outputTail: output.split(/\r?\n/).slice(-30)
  });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id}`);
  if (!ok) { failed = true; break; }
}

const coverage = JSON.parse(fs.readFileSync('src/data/generated/practical-100-coverage-report.json', 'utf8'));
const payload = {
  schema: 'mtg-commander-step45-full-verification',
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  verificationPassed: !failed && results.length === commands.length,
  practical100Certified: coverage.practical100Ready === true,
  coverageStatus: coverage.status,
  strictCoveragePercent: coverage.strictCoveragePercent,
  catalogComplete: coverage.catalogComplete,
  blockers: coverage.blockers,
  completedChecks: results.length,
  totalChecks: commands.length,
  results
};
fs.writeFileSync(artifact, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`Step 45 verification artifact: ${artifact}`);
if (failed) process.exit(1);
