import test from 'node:test';
import assert from 'node:assert/strict';
import { db, decks, engine, putBattlefield } from './helpers.js';

const idFor = name => Object.values(db).find(card => card.name === name)?.id;

test('both user-supplied Commander decks are exact playable 100-card lists', () => {
  for (const id of ['temporal-paradox', 'never-ending-story']) {
    const deck = decks.find(candidate => candidate.id === id);
    assert.ok(deck, `missing ${id}`);
    assert.equal(deck.playable, true);
    assert.equal(deck.cards.reduce((sum, entry) => sum + entry.quantity, 0), 100);
    assert.equal(deck.cards.find(entry => entry.id === deck.commander)?.quantity, 1);
    assert.ok(deck.cards.every(entry => db[entry.id]?.supported !== false));
  }
});

test('Jhoira suspends a nonland hand card with four time counters and upkeep casts it', () => {
  const e = engine('temporal-paradox', 'explorers');
  const threatId = idFor('Artisan of Kozilek');
  const player = e.state.players.player;
  const threat = [...player.hand, ...player.library].find(card => card.cardId === threatId);
  if (threat.zone !== 'hand') e._moveZoneNow(threat, 'hand', 'player');
  e.effects.resolve({ type: 'jhoiraSuspend', counters: 4 }, { controller: 'player', targets: [threat.instanceId] });
  assert.equal(threat.zone, 'exile');
  assert.equal(threat.suspended, true);
  assert.equal(threat.counters.time, 4);
  threat.counters.time = 1;
  e._processSuspendUpkeep('player');
  assert.equal(threat.zone, 'stack');
  assert.equal(e.state.stack.at(-1).card.instanceId, threat.instanceId);
});

test('extra-turn effects retain the active player for the next turn', () => {
  const e = engine('temporal-paradox', 'explorers');
  e.effects.resolve({ type: 'extraTurn', amount: 2 }, { controller: 'player' });
  assert.equal(e.state.extraTurns.player, 2);
});

test('Sagas gain lore, queue chapters, and Tom gains protection at four lore', () => {
  const e = engine('never-ending-story', 'explorers');
  const tom = putBattlefield(e, 'player', idFor('Tom Bombadil'));
  const saga = putBattlefield(e, 'player', idFor('Binding the Old Gods'));
  e.effects.addCounters('player', saga, 'lore', 1);
  assert.equal(saga.counters.lore, 1);
  assert.equal(e.state.stack.at(-1)?.effect?.type, 'resolveSagaChapter');
  saga.counters.lore = 4;
  const keywords = e.static.derivedStats(tom).keywords;
  assert.ok(keywords.includes('hexproof'));
  assert.ok(keywords.includes('indestructible'));
});

test('Tom Bombadil finds the next Saga and only does so once each turn', () => {
  const e = engine('never-ending-story', 'explorers');
  const tom = putBattlefield(e, 'player', idFor('Tom Bombadil'));
  const sagaId = idFor('Binding the Old Gods');
  const saga = e.state.players.player.library.find(card => card.cardId === sagaId);
  assert.ok(saga);
  e.state.players.player.library.splice(e.state.players.player.library.indexOf(saga), 1);
  e.state.players.player.library.unshift(saga);
  e.effects.resolve({ type: 'tomBombadilCascade' }, { controller: 'player', source: tom });
  assert.ok(e.state.players.player.battlefield.some(card => card.instanceId === saga.instanceId));
  assert.equal(tom.tomCascadeTurn, e.state.turn);
  const battlefieldCount = e.state.players.player.battlefield.length;
  e.effects.resolve({ type: 'tomBombadilCascade' }, { controller: 'player', source: tom });
  assert.equal(e.state.players.player.battlefield.length, battlefieldCount);
});
