#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const checklist = JSON.parse(fs.readFileSync('step42-release-checklist.json', 'utf8'));
const artifactPath = path.resolve('release-artifacts/step42-release-gate.json');
fs.mkdirSync(path.dirname(artifactPath), { recursive: true });

const results = [];
let failed = false;
for (const gate of checklist.gates) {
  const started = Date.now();
  const run = spawnSync(gate.command, {
    shell: true,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 16 * 1024 * 1024
  });
  const ok = run.status === 0;
  if (!ok) failed = true;
  const output = `${run.stdout || ''}${run.stderr || ''}`.trim();
  const result = {
    id: gate.id,
    purpose: gate.purpose,
    command: gate.command,
    ok,
    status: run.status,
    durationMs: Date.now() - started,
    outputTail: output.split(/\r?\n/).slice(-30)
  };
  results.push(result);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${gate.id} (${result.durationMs} ms)`);
  if (!ok) break;
}

const artifact = {
  schema: 'mtg-commander-step42-release-gate-result',
  schemaVersion: 1,
  strictModeVersion: checklist.strictModeVersion,
  engineBuild: checklist.engineBuild,
  passed: !failed && results.length === checklist.gates.length,
  completedGates: results.length,
  totalGates: checklist.gates.length,
  results
};
fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`Release gate artifact: ${artifactPath}`);
if (!artifact.passed) process.exit(1);
