#!/usr/bin/env node
import fs from 'node:fs';
const file = 'fuzz-artifacts/step37-summary.json';
if (!fs.existsSync(file)) throw new Error('Step 45 release fuzz summary is missing.');
const summary = JSON.parse(fs.readFileSync(file, 'utf8'));
if (Number(summary.seeds || 0) < 2 || Number(summary.actionsPerSeed || 0) < 80) throw new Error('Step 45 release fuzz campaign is below the recorded minimum (2 seeds x 80 legal actions).');
if (!Array.isArray(summary.summaries) || summary.summaries.length !== summary.seeds) throw new Error('Step 45 fuzz summary count mismatch.');
if (summary.summaries.some(row => row.ok !== true || Number(row.actionsExecuted || 0) < 1)) throw new Error('Step 45 release fuzz campaign contains a failed/incomplete run.');
const failureDir = 'fuzz-artifacts/step45-failures';
const failures = fs.existsSync(failureDir) ? fs.readdirSync(failureDir).filter(name => name.endsWith('.json')) : [];
if (failures.length) throw new Error(`Step 45 release fuzz campaign produced ${failures.length} failure artifact(s).`);
console.log(`Step 45 release fuzz artifact PASS (${summary.seeds} seeds x ${summary.actionsPerSeed} actions; ${summary.summaries.reduce((n,row)=>n+Number(row.actionsExecuted||0),0)} legal actions).`);
