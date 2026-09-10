import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(ROOT, 'src/App.jsx'), 'utf8');
const picker = fs.readFileSync(path.join(ROOT, 'src/components/LibrarySearchPicker.jsx'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'src/styles.css'), 'utf8');

test('library searches render actual Card components in a visual picker', () => {
  assert.match(app, /LibrarySearchPicker/);
  assert.match(app, /effectChoiceIsLibrarySearch/);
  assert.match(app, /searchLand/);
  assert.match(app, /myriadLandscape/);
  assert.match(app, /Cultivate — Search Your Library/);
  assert.match(app, /Sisay — Search Your Library/);
  assert.match(picker, /<Card perm=\{card\} def=\{def\}/);
  assert.match(css, /\.library-search-grid/);
  assert.match(css, /\.library-search-option \.card\{width:126px;height:176px\}/);
});


test('single-card library searches resolve directly from the visual card click', () => {
  assert.match(app, /onSelect=\{id => act\(\{ type: 'CHOOSE_EFFECT_CARDS', cardInstanceIds: \[id\] \}\)\}/);
  assert.match(app, /resolveOnSingleSelect=\{pendingEffectCards\.max === 1\}/);
  assert.match(picker, /className="library-search-card-button"/);
  assert.match(picker, /if \(resolveOnSingleSelect && max === 1\)/);
  assert.match(css, /\.library-search-card-button/);
});
