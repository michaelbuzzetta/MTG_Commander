import test from 'node:test';
import assert from 'node:assert/strict';
import db from '../src/data/generated/cards.json' with { type: 'json' };
import {
  autoBuildCommanderDeck,
  commanderLegal,
  deckCardCount,
  deckRoleSummary,
  detectCommanderProfile,
  isCommanderCandidate,
  recommendationList,
} from '../src/utils/deckBuilder.js';

test('deck builder exposes supported legendary creatures as commanders', () => {
  assert.equal(isCommanderCandidate(db.hakbal), true);
  assert.equal(isCommanderCandidate(db['sol-ring']), false);
});

test('commander analysis recognizes real tribal and mechanic signals from rules text', () => {
  const profile = detectCommanderProfile(db.hakbal);
  assert.ok(profile.strategies.some(item => item.key === 'merfolk-tribal'));
  assert.ok(profile.strategies.some(item => item.key === 'combat'));
  assert.ok(profile.strategies.some(item => item.key === 'draw'));
});

test('recommendations favor cards that directly support the commander', () => {
  const recommendations = recommendationList(db, db.hakbal, { limit: 12 });
  assert.ok(recommendations.length >= 5);
  assert.ok(recommendations.some(item => /Merfolk/i.test(item.def.typeLine || item.def.oracleText || '')));
  assert.ok(recommendations[0].score >= recommendations.at(-1).score);
});


test('human-payoff commander profile explicitly prioritizes Human cards', () => {
  const humanCommander = {
    id: 'test-human-commander',
    name: 'Test Human Commander',
    typeLine: 'Legendary Creature — Human Soldier',
    colorIdentity: ['W'],
    manaValue: 3,
    manaCost: '{2}{W}',
    oracleText: 'Whenever another Human enters the battlefield under your control, draw a card.'
  };
  const recommendations = recommendationList(db, humanCommander, { limit: 20 });
  const humanCard = recommendations.find(item => /\bHuman\b/i.test(item.def.typeLine || ''));
  assert.ok(humanCard, 'expected at least one legal Human card in the recommendation pool');
  assert.ok(humanCard.reasons.some(reason => /Human/i.test(reason)));
  assert.ok(humanCard.score >= 40);
});

test('auto builder creates a legal 99-card main deck with a real commander mana base', () => {
  const commander = db.hakbal;
  const deck = autoBuildCommanderDeck(db, commander);
  assert.equal(deckCardCount(deck), 99);
  assert.equal(deck.some(entry => entry.id === commander.id), false);
  for (const entry of deck) assert.equal(commanderLegal(db[entry.id], commander), true, db[entry.id]?.name);
  for (const entry of deck) {
    const def = db[entry.id];
    if (!/Basic Land/i.test(def.typeLine || '')) assert.equal(entry.quantity, 1, `${def.name} must remain singleton`);
  }
  const roles = deckRoleSummary(deck, db);
  assert.equal(roles.Land, 37);
  assert.ok(roles.Ramp >= 7);
  assert.ok(roles['Card Draw'] >= 6);
});

test('auto builder preserves legal manual selections before completing the deck', () => {
  const commander = db.hakbal;
  const deck = autoBuildCommanderDeck(db, commander, { existing: [{ id: 'sol-ring', quantity: 1 }] });
  assert.equal(deckCardCount(deck), 99);
  assert.equal(deck.find(entry => entry.id === 'sol-ring')?.quantity, 1);
});
