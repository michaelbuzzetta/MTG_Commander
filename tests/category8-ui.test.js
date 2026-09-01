import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(ROOT, 'src/App.jsx'), 'utf8');

test('Category 8 UI: nonland explore exposes keep-on-top and graveyard choices', () => {
  assert.match(app, /EXPLORE_NONLAND/);
  assert.match(app, /CHOOSE_EXPLORE/);
  assert.match(app, /Keep on Top/);
  assert.match(app, /Put in Graveyard/);
});

test('Category 8 UI: utility-token abilities remain reachable through the shared permanent activation path', () => {
  assert.match(app, /ACTIVATE_ABILITY/);
  assert.match(app, /ACTIVATE_MANA/);
  assert.match(app, /manaColor/);
});
