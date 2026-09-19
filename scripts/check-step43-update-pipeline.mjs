#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  'src/database/update/CardDatabaseUpdateService.js',
  'scripts/update-card-database-step43.mjs',
  'scripts/run-step43-affected-tests.mjs',
  'src/data/updates/step43-update-plan.json',
  'src/data/updates/step43-oracle-diff-queue.json',
  'src/data/updates/step43-affected-test-plan.json',
  'src/data/updates/step43-update-state.json',
  'src/data/updates/step43-catalog-snapshot.json',
  'tests/step43-oracle-card-update-pipeline.test.js'
];
for (const rel of required) if (!fs.existsSync(path.join(ROOT, rel))) throw new Error(`Missing Step 43 deliverable: ${rel}`);
const plan = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/updates/step43-update-plan.json'), 'utf8'));
const state = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/updates/step43-update-state.json'), 'utf8'));
if (!Array.isArray(plan.changes) || !Array.isArray(plan.affectedOracleIds)) throw new Error('Step 43 update plan has invalid shape.');
if (!Number.isInteger(state.catalogCount) || state.catalogCount <= 0) throw new Error('Step 43 update state does not record a usable catalog.');
console.log(`Step 43 deliverable check PASS (${state.catalogCount} catalog cards; ${plan.changeCount} classified changes).`);
