#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLAN = path.join(ROOT, 'src/data/updates/step43-affected-test-plan.json');
const plan = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
const testFiles = [...new Set(plan.testFiles || [])].map(file => path.join(ROOT, 'tests', file));
if (plan.includeCompilerValidation) testFiles.push(path.join(ROOT, 'tests/step18-oracle-template-compiler.test.js'));
if (plan.includeGoldenValidation) testFiles.push(path.join(ROOT, 'tests/step35-golden-card-behavior.test.js'));
if (!testFiles.length) {
  console.log('Step 43 affected-test runner: no runtime implementations changed; no card behavior tests are required.');
  process.exit(0);
}
const args = ['--test', ...[...new Set(testFiles)].filter(fs.existsSync)];
const result = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit', timeout: 160000 });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
