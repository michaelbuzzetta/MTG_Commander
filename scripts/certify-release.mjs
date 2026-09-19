#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_TIMEOUT = 240_000;
const LONG_TIMEOUT = 900_000;

// This is intentionally exhaustive. `certify` is the release authority, not a fast smoke test.
const gates = [
  ['database', 'npm', ['run', 'check-db']],
  ['support', 'npm', ['run', 'check-support']],
  ['oracle-templates', 'npm', ['run', 'check-oracle-templates']],
  ['compiler-promotions', 'npm', ['run', 'check:promotions']],
  ['census', 'npm', ['run', 'check:census']],
  ['capability-gaps', 'npm', ['run', 'check:gaps']],
  ['mechanics-audit', 'npm', ['run', 'check:mechanics-audit']],
  ['architecture', 'npm', ['run', 'check:architecture']],
  ['step33-primitives-check', 'npm', ['run', 'check:step33']],
  ['step33-primitives-tests', 'npm', ['run', 'test:step33']],
  ['step34-cross-system-check', 'npm', ['run', 'check:step34']],
  ['step34-cross-system-tests', 'npm', ['run', 'test:step34']],
  ['step35-golden-check', 'npm', ['run', 'check:step35']],
  ['step35-golden-tests', 'npm', ['run', 'test:step35'], LONG_TIMEOUT],
  ['step36-judge-check', 'npm', ['run', 'check:step36']],
  ['step36-judge-tests', 'npm', ['run', 'test:step36']],
  ['step37-fuzz-framework-check', 'npm', ['run', 'check:step37']],
  ['step37-fuzz-tests', 'npm', ['run', 'test:step37']],
  ['step38-performance-check', 'npm', ['run', 'check:step38']],
  ['step38-performance-tests', 'npm', ['run', 'test:step38']],
  ['step39-ui-check', 'npm', ['run', 'check:step39']],
  ['step39-ui-tests', 'npm', ['run', 'test:step39']],
  ['step40-dashboard-data', 'npm', ['run', 'check:step40:data']],
  ['step40-dashboard-check', 'npm', ['run', 'check:step40']],
  ['step40-dashboard-tests', 'npm', ['run', 'test:step40']],
  ['step41-unsupported-check', 'npm', ['run', 'check:step41']],
  ['step41-unsupported-tests', 'npm', ['run', 'test:step41']],
  ['step42-strict-check', 'npm', ['run', 'check:step42']],
  ['step42-strict-tests', 'npm', ['run', 'test:step42']],
  ['step43-update-check', 'npm', ['run', 'check:step43']],
  ['step43-update-tests', 'npm', ['run', 'test:step43']],
  ['step44-version-check', 'npm', ['run', 'check:step44']],
  ['step44-version-tests', 'npm', ['run', 'test:step44']],
  ['step45-practical-check', 'npm', ['run', 'check:step45']],
  ['step45-practical-tests', 'npm', ['run', 'test:step45']],
  ['release-evidence', 'npm', ['run', 'check:release-evidence']],
  ['all-tests', 'npm', ['test'], LONG_TIMEOUT],
  ['production-build', 'npm', ['run', 'build'], LONG_TIMEOUT]
];

const results = [];
for (const [id, cmd, args, timeout = DEFAULT_TIMEOUT] of gates) {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    timeout
  });
  const ok = r.status === 0;
  results.push({
    id,
    ok,
    status: r.status,
    signal: r.signal || null,
    timeoutMs: timeout,
    stdout: (r.stdout || '').slice(-5000),
    stderr: (r.stderr || '').slice(-5000)
  });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id}`);
}

let practical = null;
let step43 = null;
try { practical = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/generated/practical-100-coverage-report.json'), 'utf8')); } catch {}
try { step43 = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/updates/step43-update-state.json'), 'utf8')); } catch {}

const allGatesGreen = results.every(result => result.ok);
const report = {
  schema: 'mtg-commander-release-certification',
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  rulesVersion: practical?.rulesVersion || null,
  catalogComplete: step43?.catalogComplete === true,
  oracleCatalogSha256: step43?.oracleCatalogSha256 || null,
  printingCatalogSha256: step43?.printingCatalogSha256 || null,
  practical100Ready: practical?.practical100Ready === true,
  gates: results,
  allGatesGreen,
  certified: allGatesGreen && practical?.practical100Ready === true && step43?.catalogComplete === true
};

fs.mkdirSync(path.join(ROOT, 'release-artifacts'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'release-artifacts/final-certification.json'), `${JSON.stringify(report, null, 2)}\n`);
if (!report.certified) {
  console.error('Release certification remains blocked. See release-artifacts/final-certification.json');
  process.exit(2);
}
console.log('Release certification PASSED.');
