import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(ROOT, 'src/App.jsx'), 'utf8');

test('Category 9 UI: Hakbal, Cultivate, Sisay, scry, and triggered-target decisions are explicit', () => {
  for (const token of ['EXPLORE_ORDER', 'ORDER_EXPLORES', 'HAKBAL_ATTACK', 'CHOOSE_HAKBAL_ATTACK', 'CULTIVATE_SEARCH', 'CHOOSE_CULTIVATE', 'SISAY_TUTOR', 'CHOOSE_SISAY_TUTOR', 'SCRY', 'CHOOSE_SCRY', 'TRIGGER_TARGET', 'CHOOSE_TRIGGER_TARGET']) {
    assert.match(app, new RegExp(token));
  }
  assert.match(app, /first.*selection enters tapped/i);
  assert.match(app, /Draw a Card/);
});

test('Category 9 UI: modal spells such as Healing Salve require a mode choice before target selection', () => {
  assert.match(app, /chooseCardAction/);
  assert.match(app, /Choose mode for/);
  assert.match(app, /definition\.modes/);
  assert.match(app, /beginTargeting/);
});
