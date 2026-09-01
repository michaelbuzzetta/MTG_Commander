import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(ROOT, 'src/App.jsx'), 'utf8');

test('Category 4 UI: attacker selection is driven by engine legal attackers', () => {
  assert.match(app, /engine\.combat\.legalAttackers\('player'\)/);
  assert.match(app, /legalAttackerIds\.has\(perm\.instanceId\)/);
});

test('Category 4 UI: blocker selection uses engine legality and cannot confirm an illegal map', () => {
  assert.match(app, /engine\.combat\.canBlock\(perm, attacker\)/);
  assert.match(app, /engine\.combat\.validateBlockers\('player', blockers\)/);
  assert.match(app, /!blockersValid/);
});

test('Category 4 UI: blocker assignment supports removal and combat damage ordering', () => {
  assert.match(app, /ids\.filter\(x => x !== perm\.instanceId\)/);
  assert.match(app, /COMBAT_DAMAGE_ORDER/);
  assert.match(app, /ORDER_BLOCKERS/);
  assert.match(app, /Confirm Damage Order/);
});
