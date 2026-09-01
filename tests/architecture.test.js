import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = rel => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

test('Category 1 uses one authoritative source schema and generated runtime artifacts', () => {
  const sourceCards = readJson('src/data/source/cards.json');
  const sourceDecks = readJson('src/data/source/decks.json');
  const generatedCards = readJson('src/data/generated/cards.json');
  const generatedDecks = readJson('src/data/generated/decks.json');

  assert.deepEqual(generatedCards, sourceCards);
  assert.deepEqual(generatedDecks, sourceDecks);
  assert.equal(fs.existsSync(path.join(ROOT, 'public/data')), false);
  assert.equal(fs.existsSync(path.join(ROOT, 'src/data/cardDatabase.json')), false);
  assert.equal(fs.existsSync(path.join(ROOT, 'src/data/decks')), false);
});

test('database check fails closed on unresolved ids and validates current source cleanly', () => {
  const result = spawnSync(process.execPath, ['scripts/build-card-db.mjs', '--check'], {
    cwd: ROOT,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Validated \d+ cards and \d+ decks/);
});



test('database builder rejects unresolved required cards instead of substituting filler', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mtg-db-invalid-'));
  try {
    const cards = readJson('src/data/source/cards.json');
    const decks = readJson('src/data/source/decks.json');
    decks[0] = structuredClone(decks[0]);
    decks[0].cards = structuredClone(decks[0].cards);
    decks[0].cards[1] = { id: 'definitely-missing-card', quantity: decks[0].cards[1].quantity };
    fs.writeFileSync(path.join(temp, 'cards.json'), JSON.stringify(cards));
    fs.writeFileSync(path.join(temp, 'decks.json'), JSON.stringify(decks));

    const result = spawnSync(process.execPath, ['scripts/build-card-db.mjs', '--check', `--source-dir=${temp}`], {
      cwd: ROOT,
      encoding: 'utf8'
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unresolved card definitely-missing-card/);
    assert.doesNotMatch(result.stderr, /filler|substitut/i);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('package scripts and dependencies are reproducible', () => {
  const pkg = readJson('package.json');
  assert.equal(pkg.scripts['build-db'], 'node scripts/build-card-db.mjs');
  assert.equal(pkg.scripts['check-db'], 'node scripts/build-card-db.mjs --check');
  assert.equal(pkg.scripts['build-db:refresh'], 'node scripts/build-card-db.mjs --refresh-scryfall');

  for (const name of ['react', 'react-dom', 'vite', '@vitejs/plugin-react']) {
    assert.match(pkg.dependencies[name], /^\d+\.\d+\.\d+$/, `${name} must be pinned to an explicit tested version`);
  }
});

test('audited migration-era modules are removed', () => {
  const removed = [
    'src/ai/StrategyAI.js',
    'src/cards/registry.js',
    'src/engine/Effects.js',
    'src/components/PhaseBar.jsx',
    'src/components/PermanentZone.jsx',
    'src/components/ZoneViewer.jsx',
    'src/components/StackView.jsx',
    'src/database/CardDatabase.js'
  ];
  for (const rel of removed) assert.equal(fs.existsSync(path.join(ROOT, rel)), false, `${rel} should not exist`);
});

test('runtime app and tests import generated data, not abandoned public data', () => {
  const app = fs.readFileSync(path.join(ROOT, 'src/App.jsx'), 'utf8');
  const helpers = fs.readFileSync(path.join(ROOT, 'tests/helpers.js'), 'utf8');
  const builder = fs.readFileSync(path.join(ROOT, 'scripts/build-card-db.mjs'), 'utf8');

  assert.match(app, /data\/generated\/cards\.json/);
  assert.match(app, /data\/generated\/decks\.json/);
  assert.match(helpers, /data\/generated\/cards\.json/);
  assert.match(helpers, /data\/generated\/decks\.json/);
  assert.doesNotMatch(app, /public\/data|\/data\/cards\.json|\/data\/decks\.json/);
  assert.doesNotMatch(builder, /public["']\s*,\s*["']data/);
  assert.match(builder, /User-Agent/);
  assert.match(builder, /Content-Type/);
});


test('all local source imports resolve to existing files', () => {
  const sourceRoot = path.join(ROOT, 'src');
  const files = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(?:js|jsx)$/.test(entry.name)) files.push(full);
    }
  };
  walk(sourceRoot);

  const importPattern = /(?:from\s*|import\s*)['"](\.{1,2}\/[^'"]+)['"]/g;
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(importPattern)) {
      const target = path.resolve(path.dirname(file), match[1]);
      const candidates = [target, `${target}.js`, `${target}.jsx`, `${target}.json`, path.join(target, 'index.js')];
      assert.ok(candidates.some(candidate => fs.existsSync(candidate)), `${path.relative(ROOT, file)} has unresolved local import ${match[1]}`);
    }
  }
});
