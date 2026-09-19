#!/usr/bin/env node
import fs from 'node:fs';

const required = [
  'src/engine/diagnostics/UnsupportedInteraction.js',
  'tests/step41-unsupported-interactions.test.js',
  'scripts/check-step41-unsupported-failsafes.mjs',
  'step41-unsupported-interaction-failsafes.md'
];
const missing = required.filter(file => !fs.existsSync(file));
if (missing.length) throw new Error(`Missing Step 41 deliverables:\n${missing.map(file => ` - ${file}`).join('\n')}`);

const game = fs.readFileSync('src/engine/GameEngine.js', 'utf8');
const effects = fs.readFileSync('src/engine/EffectEngine.js', 'utf8');
const events = fs.readFileSync('src/engine/events/EventDispatcher.js', 'utf8');
const replay = fs.readFileSync('src/engine/replay/ReplayService.js', 'utf8');
const runner = fs.readFileSync('src/engine/performance/HeadlessSimulationRunner.js', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

for (const marker of ['UnsupportedInteractionService', 'preflightDeckSupport', 'getUnsupportedDiagnostics', 'isSimulationStatisticsEligible', 'action-checkpoint-restored']) {
  if (!game.includes(marker)) throw new Error(`GameEngine missing Step 41 marker: ${marker}`);
}
if (!effects.includes('explicit-no-op') || !effects.includes('not implemented by the authoritative effect engine')) throw new Error('EffectEngine does not fail safely on unknown effect nodes.');
if (!events.includes('No authoritative event handler is registered')) throw new Error('EventDispatcher does not fail safely on missing event handlers.');
if (!replay.includes('statisticsEligible') || !replay.includes('unsupportedInteractions')) throw new Error('Replay metadata does not label unsupported/sandbox output.');
if (!runner.includes('officialSimulation') || !runner.includes('UNSUPPORTED_INTERACTION_MODE.STRICT')) throw new Error('Headless official simulation is not strict-support gated.');
for (const script of ['check:step41','test:step41']) if (!pkg.scripts?.[script]) throw new Error(`package.json is missing ${script}`);
console.log('Step 41 unsupported-interaction fail-safe deliverables present.');
