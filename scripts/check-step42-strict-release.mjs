#!/usr/bin/env node
import fs from 'node:fs';

const required = [
  'src/engine/strict/StrictRulesService.js',
  'src/engine/strict/index.js',
  'tests/step42-strict-rules-release-gate.test.js',
  'scripts/run-step42-release-gate.mjs',
  'step42-release-checklist.json',
  'step42-strict-rules-mode-release-gate.md'
];
const missing = required.filter(file => !fs.existsSync(file));
if (missing.length) throw new Error(`Missing Step 42 deliverables:\n${missing.map(file => ` - ${file}`).join('\n')}`);

const game = fs.readFileSync('src/engine/GameEngine.js', 'utf8');
const strict = fs.readFileSync('src/engine/strict/StrictRulesService.js', 'utf8');
const replay = fs.readFileSync('src/engine/replay/ReplayService.js', 'utf8');
const runner = fs.readFileSync('src/engine/performance/HeadlessSimulationRunner.js', 'utf8');
const api = fs.readFileSync('src/engine/public/api.js', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const checklist = JSON.parse(fs.readFileSync('step42-release-checklist.json', 'utf8'));

for (const marker of ['StrictRulesService', 'strictRulesMode', 'assertStartupReady', 'getStrictModeConfig', 'getStrictPreflightReport', 'getSimulationCertification']) {
  if (!game.includes(marker)) throw new Error(`GameEngine missing Step 42 marker: ${marker}`);
}
for (const marker of ['noApproximations','noManualStateEdits','noSkippedMandatoryTriggers','aiUsesAuthoritativeLegalActionsOnly','deterministicSimulationRandomness','required-mechanic-modules','STRICT_MODE_FORBIDDEN_TOOL']) {
  if (!strict.includes(marker)) throw new Error(`StrictRulesService missing Step 42 guarantee: ${marker}`);
}
if (!replay.includes('strictCertification') || !replay.includes('strictPreflightReady') || !replay.includes('step42-strict-release-gate')) throw new Error('Replay output is missing Step 42 certification metadata.');
if (!runner.includes('certification') || !runner.includes('strictPreflight') || !runner.includes('officialSimulation')) throw new Error('Headless official simulation is not Step 42 certification gated.');
for (const marker of ['getStrictModeConfig','getStrictPreflightReport','getSimulationCertification']) if (!api.includes(marker)) throw new Error(`Public API missing ${marker}`);
for (const script of ['check:step42','test:step42','release:step42']) if (!pkg.scripts?.[script]) throw new Error(`package.json is missing ${script}`);
if (!Array.isArray(checklist.gates) || checklist.gates.length < 12) throw new Error('Step 42 release checklist is incomplete.');
console.log(`Step 42 strict rules/release-gate deliverables present (${checklist.gates.length} release gates).`);
