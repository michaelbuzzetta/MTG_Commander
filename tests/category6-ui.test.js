import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(ROOT, 'src/App.jsx'), 'utf8');

test('Category 6 UI: target selection is an explicit decision before casting', () => {
  assert.match(app, /targetingAction/);
  assert.match(app, /engine\.targeting\.getCandidates\('player'/);
  assert.match(app, /beginTargeting/);
  assert.match(app, /chooseCardAction/);
  assert.match(app, /Choose a legal target/);
  assert.match(app, /targets: nextTargets/);
});

test('Category 6 UI: ward exposes pay and decline decisions', () => {
  assert.match(app, /WARD_PAYMENT/);
  assert.match(app, /PAY_WARD/);
  assert.match(app, /DECLINE_WARD/);
  assert.match(app, /engine\.canPayWard\(pendingWard\)/);
});
