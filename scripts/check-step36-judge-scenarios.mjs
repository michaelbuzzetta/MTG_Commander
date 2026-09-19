import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(ROOT, 'tests/judge-scenarios/step36-scenarios.json');
const snapshotsPath = path.join(ROOT, 'tests/judge-scenarios/snapshots/step36-critical-traces.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const snapshots = JSON.parse(fs.readFileSync(snapshotsPath, 'utf8')).snapshots || {};
const { STEP36_IMPLEMENTATIONS } = await import(pathToFileURL(path.join(ROOT, 'tests/judge-scenarios/Step36ScenarioLibrary.js')));

const requiredFields = ['id','title','tags','complexity','players','startingState','actions','expectedChoices','expectedOutcome','rulesReferences','notes'];
const requiredCategories = ['layers','dependencies','replacement','simultaneous-deaths','multiplayer','player-elimination','control-change','commander','copy','bug-regression'];
const errors = [];
const ids = new Set();
const tags = new Set();

if (manifest.schema !== 'mtg-judge-scenario-library') errors.push(`Unexpected schema ${manifest.schema}`);
if (manifest.schemaVersion !== 1) errors.push(`Unexpected schemaVersion ${manifest.schemaVersion}`);
if (!Array.isArray(manifest.scenarios) || manifest.scenarios.length < 9) errors.push('At least nine curated scenarios are required.');

for (const scenario of manifest.scenarios || []) {
  for (const field of requiredFields) if (!Object.hasOwn(scenario, field)) errors.push(`${scenario.id || '<missing-id>'} missing ${field}`);
  if (!scenario.id) continue;
  if (ids.has(scenario.id)) errors.push(`Duplicate scenario id ${scenario.id}`);
  ids.add(scenario.id);
  for (const tag of scenario.tags || []) tags.add(tag);
  if (!Array.isArray(scenario.actions) || !scenario.actions.length) errors.push(`${scenario.id} has no actions.`);
  if (!Array.isArray(scenario.expectedOutcome) || !scenario.expectedOutcome.length) errors.push(`${scenario.id} has no expected outcomes.`);
  if (!Array.isArray(scenario.rulesReferences) || !scenario.rulesReferences.length) errors.push(`${scenario.id} has no rules references.`);
  if (typeof STEP36_IMPLEMENTATIONS[scenario.id] !== 'function') errors.push(`${scenario.id} has no executable implementation.`);
  if (scenario.traceSnapshot && !Array.isArray(snapshots[scenario.traceSnapshot])) errors.push(`${scenario.id} references missing trace snapshot ${scenario.traceSnapshot}.`);
}
for (const category of requiredCategories) if (!tags.has(category)) errors.push(`Missing required category/tag: ${category}`);
for (const id of Object.keys(STEP36_IMPLEMENTATIONS)) if (!ids.has(id)) errors.push(`Implementation ${id} has no manifest entry.`);

const coverage = {
  step: 36,
  schemaVersion: manifest.schemaVersion,
  rulesVersion: manifest.rulesVersion,
  scenarioCount: manifest.scenarios?.length || 0,
  executableScenarioCount: (manifest.scenarios || []).filter(s => typeof STEP36_IMPLEMENTATIONS[s.id] === 'function').length,
  criticalTraceSnapshotCount: (manifest.scenarios || []).filter(s => !!s.traceSnapshot).length,
  categories: [...tags].sort(),
  requiredCategories,
  pass: errors.length === 0,
  errors,
  scenarios: (manifest.scenarios || []).map(s => ({ id: s.id, title: s.title, complexity: s.complexity, tags: s.tags, traceSnapshot: s.traceSnapshot || null }))
};
fs.mkdirSync(path.join(ROOT, 'coverage'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'coverage/step36-judge-scenario-coverage.json'), `${JSON.stringify(coverage, null, 2)}\n`);
fs.writeFileSync(path.join(ROOT, 'coverage/step36-judge-scenario-coverage.md'), `# Step 36 Judge Scenario Coverage\n\nScenarios: **${coverage.scenarioCount}**  \nExecutable: **${coverage.executableScenarioCount}**  \nCritical trace snapshots: **${coverage.criticalTraceSnapshotCount}**  \nStatus: **${coverage.pass ? 'PASS' : 'FAIL'}**\n\n${coverage.scenarios.map(s => `- [${s.traceSnapshot ? 'trace' : 'run'}] **${s.id}** — ${s.title} (${s.tags.join(', ')})`).join('\n')}\n`);

if (errors.length) {
  console.error(`Step 36 judge-scenario gate FAILED:\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log(`Step 36 judge-scenario gate PASS: ${coverage.scenarioCount} curated scenarios, ${coverage.criticalTraceSnapshotCount} critical trace snapshots.`);
