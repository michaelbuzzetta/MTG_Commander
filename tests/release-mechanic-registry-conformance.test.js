import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../src/engine/GameEngine.js';
import { db, decks, putBattlefield } from './helpers.js';

function game() {
  const selected = decks.filter(deck => deck.playable !== false).slice(0, 2);
  return new GameEngine(selected[0], selected[1], structuredClone(db), { rng: () => 0.42 });
}

function addDefinition(engine, id, fields = {}) {
  engine.db[id] = {
    id,
    name: id,
    typeLine: 'Creature — Test',
    manaCost: '{1}',
    manaValue: 1,
    power: 2,
    toughness: 2,
    colors: [],
    colorIdentity: [],
    subtypes: ['Test'],
    keywords: [],
    abilities: [],
    spellEffects: [],
    oracleText: '',
    supported: true,
    ...fields
  };
  return engine.db[id];
}

test('release mechanic audit: Islandwalk registry entry is backed by authoritative combat legality', () => {
  const e = game();
  addDefinition(e, 'release-islandwalk', { keywords: ['islandwalk'], oracleText: 'Islandwalk' });
  const attacker = putBattlefield(e, 'player', 'release-islandwalk');
  const blocker = putBattlefield(e, 'ai', 'grizzly-bears');
  putBattlefield(e, 'ai', 'island');
  e.state.combat.attackDefendingPlayers[attacker.instanceId] = 'ai';

  assert.equal(e.mechanics.has(attacker, 'islandwalk'), true);
  assert.equal(e.combat.canBlock(blocker, attacker), false);
});

test('release mechanic audit: Changeling is a continuous characteristic rule for every creature type', () => {
  const e = game();
  addDefinition(e, 'release-changeling', { keywords: ['changeling'], oracleText: 'Changeling', subtypes: ['Shapeshifter'] });
  const changeling = putBattlefield(e, 'player', 'release-changeling');

  assert.equal(e.mechanics.has(changeling, 'changeling'), true);
  assert.equal(e.static.hasSubtype(changeling, 'Merfolk'), true);
  assert.equal(e.static.hasSubtype(changeling, 'Dragon'), true);
  assert.equal(e.static.hasSubtype(changeling, 'Island'), false, 'Changeling does not grant noncreature subtypes');
});

test('release mechanic audit: Mentor resolves through the shared counter effect and registry', () => {
  const e = game();
  const mentorDef = e.db['lcc-tributary-instructor'];
  assert.ok(mentorDef, 'representative real Mentor card is present');
  const mentor = putBattlefield(e, 'player', 'lcc-tributary-instructor');
  const target = putBattlefield(e, 'player', 'grizzly-bears');

  assert.equal(e.mechanics.has(mentor, 'mentor'), true);
  e.effects.resolve({ type: 'mentor' }, { controller: 'player', source: mentor, targets: [target.instanceId] });
  assert.equal(target.counters?.['+1/+1'], 1);
});
