#!/usr/bin/env node
import fs from 'node:fs';

const required = [
  'src/engine/performance/PerformanceProfiler.js',
  'src/engine/performance/PerformanceService.js',
  'src/engine/performance/HeadlessSimulationRunner.js',
  'tests/step38-performance-scalability.test.js',
  'tests/performance/step38-thresholds.json',
  'scripts/run-step38-benchmarks.mjs',
  '.github/workflows/step38-performance.yml',
  'step38-performance-scalability.md'
];
const missing = required.filter(file => !fs.existsSync(file));
if (missing.length) {
  console.error(`Missing Step 38 deliverables:\n${missing.map(file => ` - ${file}`).join('\n')}`);
  process.exit(1);
}
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
for (const script of ['test:step38', 'check:step38', 'benchmark:step38']) {
  if (!pkg.scripts?.[script]) throw new Error(`package.json is missing ${script}`);
}
const gameEngine = fs.readFileSync('src/engine/GameEngine.js', 'utf8');
if (!gameEngine.includes('performanceOptimizations') || !gameEngine.includes('headless')) throw new Error('GameEngine Step 38 options are missing');
const triggerRegistry = fs.readFileSync('src/engine/triggers/TriggerRegistry.js', 'utf8');
const replacementRegistry = fs.readFileSync('src/engine/replacement/ReplacementRegistry.js', 'utf8');
if (!triggerRegistry.includes('indexedSourcesForEvent')) throw new Error('Trigger event index is missing');
if (!replacementRegistry.includes('cardAbilityIndex')) throw new Error('Replacement event index is missing');
console.log('Step 38 performance/scalability deliverables present.');
