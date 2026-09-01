import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(ROOT, 'src/App.jsx'), 'utf8');

test('Category 7 UI: optional and simultaneous triggers expose explicit choices', () => {
  assert.match(app, /OPTIONAL_TRIGGER/);
  assert.match(app, /CHOOSE_TRIGGER/);
  assert.match(app, /TRIGGER_ORDER/);
  assert.match(app, /ORDER_TRIGGERS/);
  assert.match(app, /Simultaneous triggers/);
});

test('Category 7 UI: proliferate and replacement effects expose selection and order controls', () => {
  assert.match(app, /PROLIFERATE/);
  assert.match(app, /CHOOSE_PROLIFERATE/);
  assert.match(app, /eligibleIds/);
  assert.match(app, /REPLACEMENT_ORDER/);
  assert.match(app, /ORDER_REPLACEMENTS/);
});
