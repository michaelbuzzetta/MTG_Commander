#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_AGE_DAYS = Number(process.env.RELEASE_EVIDENCE_MAX_AGE_DAYS || 14);
const MIN_FUZZ_ACTIONS = Number(process.env.RELEASE_MIN_FUZZ_ACTIONS || 1_000_000);
const failures = [];

function readJson(relative, fallback = null) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8')); } catch { return fallback; }
}
function shaFile(relative) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, relative))).digest('hex'); } catch { return null; }
}
function ageDays(value) {
  const ms = Date.parse(value || '');
  return Number.isFinite(ms) ? (Date.now() - ms) / 86_400_000 : Infinity;
}
function requireFresh(label, value) {
  const age = ageDays(value);
  if (!Number.isFinite(age) || age > MAX_AGE_DAYS) failures.push(`${label} is missing or stale (${Number.isFinite(age) ? age.toFixed(1) : 'unknown'} days; limit ${MAX_AGE_DAYS}).`);
}

const support = readJson('src/data/generated/card-support.json', {});
const step43 = readJson('src/data/updates/step43-update-state.json', {});
const fuzz = readJson('fuzz-artifacts/step37-summary.json');
const perf = readJson('performance-artifacts/step38-benchmarks.json');
const compilerSha256 = shaFile('src/cards/compiler/OracleAstCompiler.js');
const identity = {
  rulesVersion: support.rulesVersion || null,
  oracleCatalogSha256: step43.oracleCatalogSha256 || null,
  printingCatalogSha256: step43.printingCatalogSha256 || null,
  compilerSha256
};

if (!fuzz) {
  failures.push('Long-fuzz evidence is missing: fuzz-artifacts/step37-summary.json.');
} else {
  requireFresh('Long-fuzz evidence', fuzz.generatedAt);
  const summaries = Array.isArray(fuzz.summaries) ? fuzz.summaries : [];
  const totalActions = summaries.reduce((sum, row) => sum + Number(row.actionsExecuted || 0), 0);
  if (!summaries.length) failures.push('Long-fuzz evidence contains no completed seeded runs.');
  if (totalActions < MIN_FUZZ_ACTIONS) failures.push(`Long-fuzz evidence contains ${totalActions} executed legal actions; release minimum is ${MIN_FUZZ_ACTIONS}.`);
  if (summaries.some(row => row.failure || row.error || row.ok === false)) failures.push('Long-fuzz evidence contains a failed run.');
}

if (!perf) {
  failures.push('Performance evidence is missing: performance-artifacts/step38-benchmarks.json.');
} else {
  requireFresh('Performance evidence', perf.generatedAt);
  if (perf.passed !== true) failures.push('Latest performance benchmark evidence is not passing.');
}

for (const platform of ['windows', 'macos']) {
  const relative = `release-artifacts/platform/${platform}.json`;
  const artifact = readJson(relative);
  if (!artifact) {
    failures.push(`Clean-install platform evidence is missing: ${relative}.`);
    continue;
  }
  requireFresh(`${platform} platform evidence`, artifact.generatedAt);
  if (artifact.passed !== true) failures.push(`${platform} platform evidence is not passing.`);
  for (const [key, expected] of Object.entries(identity)) {
    if (!expected) continue;
    if (artifact[key] !== expected) failures.push(`${platform} platform evidence does not match current ${key}.`);
  }
  if (!artifact.sourceRevision) failures.push(`${platform} platform evidence is missing sourceRevision.`);
  if (!artifact.nodeVersion || !artifact.npmVersion) failures.push(`${platform} platform evidence must record Node and npm versions.`);
}

const report = {
  schema: 'mtg-commander-release-evidence-check',
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  maxAgeDays: MAX_AGE_DAYS,
  minimumFuzzActions: MIN_FUZZ_ACTIONS,
  currentIdentity: identity,
  fuzz: fuzz ? {
    generatedAt: fuzz.generatedAt || null,
    seededRuns: Array.isArray(fuzz.summaries) ? fuzz.summaries.length : 0,
    executedActions: Array.isArray(fuzz.summaries) ? fuzz.summaries.reduce((sum, row) => sum + Number(row.actionsExecuted || 0), 0) : 0
  } : null,
  performance: perf ? { generatedAt: perf.generatedAt || null, passed: perf.passed === true } : null,
  passed: failures.length === 0,
  failures
};

fs.mkdirSync(path.join(ROOT, 'release-artifacts'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'release-artifacts/release-evidence-check.json'), `${JSON.stringify(report, null, 2)}\n`);

if (failures.length) {
  console.error(`Release evidence check FAILED (${failures.length} issue${failures.length === 1 ? '' : 's'}):`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(2);
}
console.log(`Release evidence PASS: current fuzz, performance, Windows, and macOS artifacts match the release identity.`);
