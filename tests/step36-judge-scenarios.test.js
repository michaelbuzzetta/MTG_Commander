import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { ScenarioHarness } from './judge-scenarios/ScenarioHarness.js';
import { STEP36_IMPLEMENTATIONS } from './judge-scenarios/Step36ScenarioLibrary.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'judge-scenarios/step36-scenarios.json'), 'utf8'));
const snapshots = JSON.parse(fs.readFileSync(path.join(ROOT, 'judge-scenarios/snapshots/step36-critical-traces.json'), 'utf8')).snapshots;

const REQUIRED_FIELDS = ['id','title','tags','complexity','players','startingState','actions','expectedChoices','expectedOutcome','rulesReferences','notes'];

test('Step 36 scenario manifest provides the required judge-regression schema and high-risk categories', () => {
  assert.equal(manifest.schema, 'mtg-judge-scenario-library');
  assert.equal(manifest.schemaVersion, 1);
  assert.ok(manifest.scenarios.length >= 9);
  const ids = new Set();
  const tags = new Set();
  for (const scenario of manifest.scenarios) {
    for (const field of REQUIRED_FIELDS) assert.ok(Object.hasOwn(scenario, field), `${scenario.id || '<missing-id>'} missing ${field}`);
    assert.ok(!ids.has(scenario.id), `duplicate judge scenario id ${scenario.id}`);
    ids.add(scenario.id);
    scenario.tags.forEach(tag => tags.add(tag));
    assert.ok(Array.isArray(scenario.actions) && scenario.actions.length > 0, `${scenario.id} needs semantic actions`);
    assert.ok(Array.isArray(scenario.expectedOutcome) && scenario.expectedOutcome.length > 0, `${scenario.id} needs expected outcomes`);
    assert.ok(Array.isArray(scenario.rulesReferences) && scenario.rulesReferences.length > 0, `${scenario.id} needs rules references`);
    assert.equal(typeof STEP36_IMPLEMENTATIONS[scenario.id], 'function', `${scenario.id} needs an executable implementation`);
  }
  for (const required of ['layers','dependencies','replacement','simultaneous-deaths','multiplayer','player-elimination','control-change','commander','copy','bug-regression']) {
    assert.ok(tags.has(required), `Step 36 library missing required high-risk category ${required}`);
  }
});

for (const scenario of manifest.scenarios) {
  test(`Step 36 judge scenario — ${scenario.id}: ${scenario.title}`, () => {
    const harness = new ScenarioHarness(scenario);
    try {
      STEP36_IMPLEMENTATIONS[scenario.id](harness);
      if (scenario.traceSnapshot) {
        const expected = snapshots[scenario.traceSnapshot];
        assert.ok(expected, `missing critical trace snapshot ${scenario.traceSnapshot}`);
        assert.deepEqual(harness.semanticTrace, expected, `${scenario.id} semantic trace changed`);
      }
    } catch (error) {
      const failurePath = harness.persistFailure(error);
      error.message = `${error.message}\nStep 36 reproduction bundle: ${failurePath}`;
      throw error;
    }
  });
}
