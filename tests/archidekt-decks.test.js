import test from 'node:test';
import assert from 'node:assert/strict';
import { db, decks, engine, putBattlefield } from './helpers.js';

const IDS = ['ertai-self-counter','myojin-challenge','stangg-twin','inspirit-spacecraft','bullies-face-down'];
const idFor = name => Object.values(db).find(card => card.name === name)?.id;

test('five selected Archidekt decks are exact, playable 100-card main decks', () => {
  for (const id of IDS) {
    const deck = decks.find(candidate => candidate.id === id);
    assert.ok(deck, `missing ${id}`);
    assert.equal(deck.playable, true);
    assert.equal(deck.cards.reduce((sum, entry) => sum + entry.quantity, 0), 100);
    assert.equal(deck.cards.filter(entry => entry.id === deck.commander).reduce((sum, entry) => sum + entry.quantity, 0), 1);
    assert.match(deck.source, /^https:\/\/archidekt\.com\/decks\//);
    assert.ok(deck.cards.every(entry => db[entry.id]?.supported !== false));
  }
});

test('Myojin converts its indestructible counter into a Spirit army', () => {
  const e = engine('myojin-challenge', 'explorers');
  const myojin = putBattlefield(e, 'player', idFor('Myojin of Blooming Dawn'), { counters: { indestructible: 1 } });
  putBattlefield(e, 'player', 'plains');
  putBattlefield(e, 'player', 'sol-ring');
  const ability = db[myojin.cardId].abilities.find(item => item.effect?.type === 'createSpiritsPerPermanent');
  e.effects.resolve(ability.effect, { controller: 'player', source: myojin });
  assert.equal(e.state.players.player.battlefield.filter(card => e.db[card.cardId]?.name === 'Spirit Token').length, 3);
});

test('Stangg creates a tapped-and-attacking Twin', () => {
  const e = engine('stangg-twin', 'explorers');
  const stangg = putBattlefield(e, 'player', idFor('Stangg, Echo Warrior'), { attacking: true, attackTarget: 'ai' });
  e.state.combat.attackers = [stangg.instanceId];
  e.state.combat.attackTargets = { [stangg.instanceId]: 'ai' };
  e.state.combat.defendingPlayers = ['ai'];
  e.effects.resolve({ type: 'stanggTwin' }, { controller: 'player', source: stangg, eventPayload: { defendingPlayer: 'ai' } });
  const twin = e.state.players.player.battlefield.find(card => e.db[card.cardId]?.name === 'Stangg Twin');
  assert.ok(twin?.attacking);
  assert.equal(twin.tapped, true);
  assert.equal(e.state.combat.attackTargets[twin.instanceId], 'ai');
});

test('Inspirit becomes a flying creature at eight charge counters and shields artifacts', () => {
  const e = engine('inspirit-spacecraft', 'explorers');
  const ship = putBattlefield(e, 'player', idFor('Inspirit, Flagship Vessel'), { counters: { charge: 8 } });
  const artifact = putBattlefield(e, 'player', 'sol-ring');
  assert.equal(e.static.isType(ship, 'Creature'), true);
  assert.ok(e.static.derivedStats(ship).keywords.includes('flying'));
  assert.ok(e.static.derivedStats(artifact).keywords.includes('hexproof'));
  assert.ok(e.static.derivedStats(artifact).keywords.includes('indestructible'));
});

test('Beamtown Bullies loans a graveyard creature to an opponent temporarily', () => {
  const e = engine('bullies-face-down', 'explorers');
  const creature = putBattlefield(e, 'ai', 'grizzly-bears');
  e._moveZoneNow(creature, 'graveyard', 'ai');
  e.effects.resolve({ type: 'bulliesDonate' }, { controller: 'player', targets: ['ai', creature.instanceId] });
  const loan = e.findPermanent(creature.instanceId);
  assert.equal(loan?.controller, 'ai');
  assert.equal(loan?.exileAtEndTurn, e.state.turn);
  assert.ok(loan?.modifiers.keywords.includes('haste'));
});

test('Ertai counters a targeted spell and replaces it with a card for its controller', () => {
  const e = engine('ertai-self-counter', 'explorers');
  const before = e.state.players.ai.hand.length;
  const card = e.state.players.ai.library.shift();
  card.zone = 'stack';
  e.state.stack.push({ id: 'test-spell', type: 'spell', controller: 'ai', card, targets: [] });
  e.effects.resolve({ type: 'ertaiCounterOrDestroy' }, { controller: 'player', targets: [card.instanceId] });
  assert.equal(e.state.stack.length, 0);
  assert.ok(e.state.players.ai.graveyard.some(item => item.instanceId === card.instanceId));
  assert.equal(e.state.players.ai.hand.length, before + 1);
});
