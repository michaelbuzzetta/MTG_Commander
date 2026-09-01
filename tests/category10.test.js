import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AIController } from '../src/ai/AIController.js';
import { db, decks, engine, putBattlefield, setPhase } from './helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COLORS = ['W', 'U', 'B', 'R', 'G'];
const isBasic = card => /(^|\s)Basic Land(?:\s|—|-|$)/i.test(card?.typeLine || '');
const sameIdentity = (a, b) => [...new Set(a)].sort().join('') === [...new Set(b)].sort().join('');

const OFFICIAL_EXPLORERS_NAMES = [
  'Hakbal of the Surging Soul', 'Benthic Biomancer', 'Cold-Eyed Selkie', 'Coralhelm Commander', 'Deeproot Elite', 'Deeproot Historian',
  'Emperor Mihail II', 'Evolution Sage', 'Herald of Secret Streams', "Kiora's Follower", 'Kopala, Warden of Waves', 'Kumena, Tyrant of Orazca',
  'Master of the Pearl Trident', 'Merfolk Cave-Diver', 'Merfolk Mistbinder', 'Merfolk Skydiver', 'Merfolk Sovereign', 'Merrow Reejerey',
  'Metallic Mimic', 'Mist Dancer', 'Nicanzil, Current Conductor', 'Prime Speaker Zegana', 'Realmwalker', 'Sage of Fables', 'Seafloor Oracle',
  'Singer of Swift Rivers', 'Stonybrook Banneret', 'Surgespanner', 'Svyelun of Sea and Sky', 'Tatyova, Benthic Druid', 'Thassa, God of the Sea',
  'Thieving Skydiver', 'Tishana, Voice of Thunder', 'Topography Tracker', 'Tributary Instructor', 'Vorel of the Hull Clade',
  'Xolatoyac, the Smiling Flood', 'Zegana, Utopian Speaker', 'Aetherize', 'Beast Within', 'Commit // Memory', 'Growth Spiral', 'Inspiring Call',
  'Quandrix Command', 'Rapid Hybridization', 'Ripples of Potential', 'Ruinous Intrusion', 'Bygone Marvels', 'Curse of the Swine', 'Explore',
  "Kodama's Reach", 'Ravenform', 'Wave Goodbye', 'Arcane Signet', "Commander's Sphere", 'Simic Signet', 'Sol Ring', 'Swiftfoot Boots',
  'Branching Evolution', 'Deeproot Waters', 'Hardened Scales', 'Kindred Discovery', 'Reflections of Littjara', 'Simic Ascendancy',
  "Alchemist's Refuge", 'Command Tower', 'Hinterland Harbor', "Karn's Bastion", 'Llanowar Reborn', 'Mosswort Bridge', 'Myriad Landscape',
  'Path of Ancestry', 'Reliquary Tower', "Rogue's Passage", 'Secluded Courtyard', 'Simic Growth Chamber', 'Temple of Mystery',
  'Temple of the False God', 'Unclaimed Territory', 'Vineglimmer Snarl', 'Forest', 'Island'
];

test('Category 10 BUG-056/057: every deck is Commander-legal and every playable deck is fully supported', () => {
  for (const deck of decks) {
    assert.equal(deck.format, 'Commander');
    assert.equal(deck.cards.reduce((sum, entry) => sum + entry.quantity, 0), 100);
    assert.equal(deck.cards.filter(entry => entry.id === deck.commander).reduce((n, entry) => n + entry.quantity, 0), 1);
    assert.ok(db[deck.commander]);
    assert.match(db[deck.commander].typeLine, /Legendary.*Creature|Creature.*Legendary/i);
    assert.ok(sameIdentity(deck.colorIdentity, db[deck.commander].colorIdentity));

    const entryIds = new Set();
    const allowed = new Set(deck.colorIdentity);
    for (const entry of deck.cards) {
      assert.ok(!entryIds.has(entry.id), `${deck.id}: duplicate deck entry ${entry.id}`);
      entryIds.add(entry.id);
      const card = db[entry.id];
      assert.ok(card, `${deck.id}: unresolved card ${entry.id}`);
      assert.ok(isBasic(card) || entry.quantity === 1, `${deck.id}: ${card.name} violates singleton`);
      assert.ok(card.colorIdentity.every(color => COLORS.includes(color) && allowed.has(color)), `${deck.id}: off-color ${card.name}`);
      if (deck.playable !== false) assert.notEqual(card.supported, false, `${deck.id}: unsupported playable card ${card.name}`);
    }
  }
});

test('Category 10 BUG-058: playable Explorers deck exactly preserves the published 100-card precon', () => {
  const deck = decks.find(candidate => candidate.id === 'explorers');
  assert.ok(deck);
  assert.equal(deck.playable, true, 'the exact physical precon should be the playable Explorers deck');
  const byName = new Map(deck.cards.map(entry => [db[entry.id].name, entry.quantity]));
  assert.deepEqual([...byName.keys()].sort(), [...OFFICIAL_EXPLORERS_NAMES].sort());
  assert.equal(byName.get('Forest'), 7);
  assert.equal(byName.get('Island'), 13);
  assert.equal(byName.get('Xolatoyac, the Smiling Flood'), 1);
  assert.equal(byName.get('Hakbal of the Surging Soul'), 1);
  assert.equal([...byName.values()].reduce((a, b) => a + b, 0), 100);
});

test('Category 10 BUG-058: exact Explorers precon is fully supported and playable', () => {
  const deck = decks.find(candidate => candidate.id === 'explorers');
  assert.ok(deck?.playable);
  assert.equal(deck.commander, 'hakbal');
  assert.equal(deck.cards.reduce((sum, entry) => sum + entry.quantity, 0), 100);
  assert.ok(deck.cards.every(entry => db[entry.id].supported !== false));
});

test('Category 10 BUG-056/057 build gate rejects singleton and color-identity violations', () => {
  const sourceCards = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/source/cards.json'), 'utf8'));
  const sourceDecks = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/source/decks.json'), 'utf8'));
  const runInvalid = mutate => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mtg-cat10-deck-'));
    try {
      const altered = structuredClone(sourceDecks);
      mutate(altered);
      fs.writeFileSync(path.join(temp, 'cards.json'), JSON.stringify(sourceCards));
      fs.writeFileSync(path.join(temp, 'decks.json'), JSON.stringify(altered));
      return spawnSync(process.execPath, ['scripts/build-card-db.mjs', '--check', `--source-dir=${temp}`], { cwd: ROOT, encoding: 'utf8' });
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  };

  const singleton = runInvalid(all => {
    const deck = all.find(d => d.id === 'smaug');
    deck.cards.find(e => e.id === 'vampire-nighthawk').quantity = 2;
    deck.cards.find(e => e.id === 'swamp').quantity -= 1;
  });
  assert.notEqual(singleton.status, 0);
  assert.match(singleton.stderr, /singleton construction/i);

  const identity = runInvalid(all => {
    const deck = all.find(d => d.id === 'smaug');
    deck.cards.push({ id: 'treasure-maker', quantity: 1 });
    deck.cards.find(e => e.id === 'swamp').quantity -= 1;
  });
  assert.notEqual(identity.status, 0);
  assert.match(identity.stderr, /off-color card Prosperous Pirates/i);
});

test('Category 10 BUG-050: AI builds a legal two-creature menace block through engine legality', () => {
  const e = engine();
  const attacker = putBattlefield(e, 'player', 'menace-ogre');
  attacker.attacking = true;
  putBattlefield(e, 'ai', 'grizzly-bears');
  putBattlefield(e, 'ai', 'giant-spider');
  e.state.combat.attackers = [attacker.instanceId];
  e.state.combat.blockers = {};
  e.state.combat.blocked = {};
  setPhase(e, 'DECLARE_BLOCKERS', { activePlayer: 'player', priorityPlayer: 'ai', turnActionPending: 'DECLARE_BLOCKERS' });
  e.state.combat.attackers = [attacker.instanceId];
  attacker.attacking = true;

  const action = new AIController(e, 'ai').choose();
  assert.equal(action.type, 'DECLARE_BLOCKERS');
  assert.equal(action.blockers[attacker.instanceId].length, 2);
  assert.equal(new Set(action.blockers[attacker.instanceId]).size, 2);
  assert.ok(e.isActionLegal('ai', action));
});

test('Category 10 BUG-051: AI does not tap a mana permanent without a concrete payable action', () => {
  const e = engine();
  const ai = e.state.players.ai;
  ai.hand = [{ instanceId: 'uncastable-blue', cardId: 'divination', owner: 'ai', controller: 'ai', zone: 'hand', tapped: false, summoningSick: false, counters: {}, damageMarked: 0, modifiers: { power: 0, toughness: 0, keywords: [] } }];
  putBattlefield(e, 'ai', 'sol-ring');
  setPhase(e, 'PRECOMBAT_MAIN', { activePlayer: 'ai', priorityPlayer: 'ai' });
  const legal = e.getLegalActions('ai');
  assert.ok(legal.some(action => action.type === 'ACTIVATE_MANA'));
  assert.ok(!legal.some(action => ['CAST_SPELL', 'CAST_COMMANDER'].includes(action.type) && action.cardInstanceId === 'uncastable-blue'));
  const action = new AIController(e, 'ai').choose();
  assert.notEqual(action.type, 'ACTIVATE_MANA');
  assert.equal(action.type, 'PASS_PRIORITY');
});

test('Category 10 BUG-053/054/055: UI uses true priority, END_STEP metadata, playable deck filtering, and readable local rules text', () => {
  const app = fs.readFileSync(path.join(ROOT, 'src/App.jsx'), 'utf8');
  const card = fs.readFileSync(path.join(ROOT, 'src/components/Card.jsx'), 'utf8');
  assert.match(app, /END_STEP:\s*\{\s*label:\s*'End Step'/);
  assert.match(app, /s\.priorityPlayer === 'player' \? 'You have priority' : 'Opponent has priority'/);
  assert.match(app, /playableDecks = decks\.filter\(deck => deck\.playable !== false\)/);
  assert.match(card, /def\.oracleText \|\| def\.customRulesText \|\| def\.unsupportedReason/);
  for (const [id, definition] of Object.entries(db)) {
    if (definition.supported !== false) assert.ok(definition.oracleText?.trim(), `${id} is missing local readable rules text`);
  }
});
