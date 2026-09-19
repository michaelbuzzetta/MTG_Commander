import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../src/engine/GameEngine.js';
import { FormatValidator } from '../src/engine/pregame/index.js';
import { db, decks } from './helpers.js';

const playable = decks.filter(deck => deck.playable !== false);
const clone = value => structuredClone(value);

function decrementOneBasic(deck) {
  const entry = deck.cards.find(item => Number(item.quantity || 0) > 1 && /basic land/i.test(db[item.id]?.typeLine || ''));
  if (!entry) throw new Error('fixture deck has no repeated basic land');
  entry.quantity -= 1;
  return entry;
}

test('Step 20: all current project decks pass format-aware Commander validation', () => {
  const validator = new FormatValidator(db);
  for (const deck of playable) {
    const result = validator.validate(deck);
    assert.equal(result.ok, true, `${deck.id}: ${result.errors.join('; ')}`);
    assert.equal(result.cardCount, 100);
  }
});

test('Step 20: Commander validator rejects wrong size, singleton violations, off-color cards, and configured bans', () => {
  const size = clone(playable[0]);
  decrementOneBasic(size);
  assert.match(new FormatValidator(db).validate(size).errors.join('\n'), /exactly 100/i);

  const singleton = clone(playable[0]);
  decrementOneBasic(singleton);
  singleton.cards.find(entry => entry.id === 'sol-ring').quantity += 1;
  assert.match(new FormatValidator(db).validate(singleton).errors.join('\n'), /singleton/i);

  const offColor = clone(playable[0]);
  decrementOneBasic(offColor);
  offColor.cards.push({ id: 'smaug', quantity: 1 });
  assert.match(new FormatValidator(db).validate(offColor).errors.join('\n'), /color identity/i);

  const banned = new FormatValidator(db, { bannedCardIds: ['sol-ring'], bannedListVersion: 'step20-test' }).validate(playable[0]);
  assert.match(banned.errors.join('\n'), /not legal in Commander/i);
  assert.equal(banned.bannedListVersion, 'step20-test');
});

test('Step 20: an illegal deck is rejected before opening hands are drawn', () => {
  const bad = clone(playable[0]);
  decrementOneBasic(bad);
  const e = new GameEngine(bad, playable[1], db, { rng: () => 0.42 });
  assert.throws(() => e.start(), /exactly 100/i);
  assert.equal(e.state.started, false);
  assert.equal(e.state.players.player.hand.length, 0);
});

test('Step 20: companion designation is validated by a data/rule-backed restriction and kept outside the 100-card count', () => {
  const customDb = {
    commander: { id: 'commander', name: 'Test Commander', typeLine: 'Legendary Creature — Human', colorIdentity: ['W'], manaCost: '{1}{W}', manaValue: 2, oracleText: '' },
    filler: { id: 'filler', name: 'Filler', typeLine: 'Sorcery', colorIdentity: [], manaCost: '{1}{W}', manaValue: 2, oracleText: '' },
    bad: { id: 'bad', name: 'Bad Symbols', typeLine: 'Sorcery', colorIdentity: ['W'], manaCost: '{W}{W}', manaValue: 2, oracleText: '' },
    jegantha: { id: 'jegantha', name: 'Jegantha, the Wellspring', typeLine: 'Legendary Creature — Elemental Elk', colorIdentity: [], manaCost: '{4}{G}', manaValue: 5, oracleText: 'Companion' }
  };
  const base = { id: 'companion-test', format: 'Commander', commander: 'commander', colorIdentity: ['W'], companion: 'jegantha', cards: [{ id: 'commander', quantity: 1 }, { id: 'filler', quantity: 1 }] };
  const validator = new FormatValidator(customDb, { exactDeckSize: 2, minimumDeckSize: 2 });
  assert.equal(validator.validate(base).ok, true);
  const bad = clone(base);
  bad.cards[1] = { id: 'bad', quantity: 1 };
  assert.match(validator.validate(bad).errors.join('\n'), /Companion restriction.*repeats mana symbol/i);
});

test('Step 20: seeded random starting-player selection and opening libraries are reproducible', () => {
  const selected = playable.slice(0, 4);
  const make = () => new GameEngine(selected[0], selected.slice(1), db, { seed: 'step20-repro', startingPlayer: 'random' });
  const a = make(), b = make();
  a.start(); b.start();
  assert.deepEqual(a.state.playerOrder, b.state.playerOrder);
  for (const id of a.state.playerOrder) {
    assert.deepEqual(a.state.players[id].hand.map(card => card.cardId), b.state.players[id].hand.map(card => card.cardId));
    assert.deepEqual(a.state.players[id].library.slice(0, 8).map(card => card.cardId), b.state.players[id].library.slice(0, 8).map(card => card.cardId));
  }
  assert.equal(a.getPregameSnapshot().rng.deterministic, true);
});

test('Step 20: reset reproduces seeded starting order and opening hands', () => {
  const e = new GameEngine(playable[0], playable[1], db, { seed: 20260916, startingPlayer: 'random' });
  e.start();
  const before = {
    order: [...e.state.playerOrder],
    hands: Object.fromEntries(e.state.playerOrder.map(id => [id, e.state.players[id].hand.map(card => card.cardId)]))
  };
  e.reset();
  const after = {
    order: [...e.state.playerOrder],
    hands: Object.fromEntries(e.state.playerOrder.map(id => [id, e.state.players[id].hand.map(card => card.cardId)]))
  };
  assert.deepEqual(after, before);
});

test('Step 20: multiplayer London mulligan grants exactly one free mulligan', () => {
  const e = new GameEngine(playable[0], playable[1], db, { seed: 'mulligan-free' });
  e.start();
  assert.equal(e.state.pregame.freeMulligans, 1);
  e.perform('player', { type: 'MULLIGAN' });
  assert.equal(e.state.players.player.mulligans, 1);
  e.perform('player', { type: 'KEEP_HAND' });
  assert.equal(e.state.pendingChoice, null, 'first multiplayer mulligan is free');
  assert.equal(e.state.players.player.hand.length, 7);

  e.perform('ai', { type: 'MULLIGAN' });
  e.perform('ai', { type: 'MULLIGAN' });
  e.perform('ai', { type: 'KEEP_HAND' });
  assert.equal(e.state.pendingChoice?.type, 'MULLIGAN_BOTTOM');
  assert.equal(e.state.pendingChoice?.count, 1);
});

test('Step 20: companion designation is revealed in pregame metadata without entering the command zone', () => {
  const a = clone(playable[0]);
  a.companion = 'sol-ring';
  const e = new GameEngine(a, playable[1], db, { rng: () => 0.42, validateDecks: false });
  e.start();
  assert.deepEqual(e.state.pregame.companions.player, { cardId: 'sol-ring', revealed: true });
  assert.equal(e.state.players.player.command.some(card => card.cardId === 'sol-ring'), false);
});

test('Step 20: declarative Leyline-style opening-hand action prompts and enters before turn one through MOVE_ZONE', () => {
  const customDb = clone(db);
  customDb['step20-leyline'] = {
    id: 'step20-leyline', name: 'Step 20 Leyline', typeLine: 'Enchantment', colorIdentity: [], manaCost: '{2}', manaValue: 2,
    oracleText: 'If Step 20 Leyline is in your opening hand, you may begin the game with it on the battlefield.',
    pregameActions: [{ type: 'put-from-opening-hand-onto-battlefield', optional: true }], abilities: [], spellEffects: [], supported: true
  };
  const e = new GameEngine(playable[0], playable[1], customDb, { seed: 'leyline' });
  e.start();
  const card = e.state.players.player.hand[0];
  card.cardId = 'step20-leyline';
  e.perform('player', { type: 'KEEP_HAND' });
  e.perform('ai', { type: 'KEEP_HAND' });
  assert.equal(e.state.gameBegun, false);
  assert.equal(e.state.pendingChoice?.type, 'PREGAME_ACTION');
  assert.equal(e.state.pendingChoice?.playerId, 'player');
  assert.deepEqual(e.getLegalActions('player').map(action => [action.type, action.accept]), [['CHOOSE_PREGAME_ACTION', true], ['CHOOSE_PREGAME_ACTION', false]]);
  e.perform('player', { type: 'CHOOSE_PREGAME_ACTION', accept: true });
  assert.equal(e.state.players.player.battlefield.some(item => item.instanceId === card.instanceId), true);
  assert.equal(e.state.gameBegun, true);
  assert.equal(e.state.turn, 1);
  assert.ok(e.state.history.some(entry => entry.type === 'PREGAME_ACTION' && entry.sourceName === 'Step 20 Leyline'));
  assert.ok(e.getEventLogSnapshot().some(entry => entry.type === 'MOVE_ZONE' && entry.payload?.reason === 'pregame-action'));
});

test('Step 20: declining an optional pregame action leaves the card in hand and still starts turn one', () => {
  const customDb = clone(db);
  customDb['step20-leyline'] = { id: 'step20-leyline', name: 'Step 20 Leyline', typeLine: 'Enchantment', colorIdentity: [], oracleText: '', pregameActions: [{ type: 'put-from-opening-hand-onto-battlefield', optional: true }], abilities: [], spellEffects: [], supported: true };
  const e = new GameEngine(playable[0], playable[1], customDb, { rng: () => 0.42 });
  e.start();
  const card = e.state.players.player.hand[0]; card.cardId = 'step20-leyline';
  e.perform('player', { type: 'KEEP_HAND' }); e.perform('ai', { type: 'KEEP_HAND' });
  e.perform('player', { type: 'CHOOSE_PREGAME_ACTION', accept: false });
  assert.equal(e.state.players.player.hand.some(item => item.instanceId === card.instanceId), true);
  assert.equal(e.state.gameBegun, true);
});

test('Step 20: Gemstone-Caverns-style pregame action requires non-starting player, exiles another card, and enters with a luck counter', () => {
  const customDb = clone(db);
  customDb['step20-caverns'] = {
    id: 'step20-caverns', name: 'Step 20 Caverns', typeLine: 'Legendary Land', colorIdentity: [], oracleText: '',
    pregameActions: [{ type: 'gemstone-caverns', optional: true, condition: 'not-starting-player' }], abilities: [], spellEffects: [], supported: true
  };
  const e = new GameEngine(playable[0], playable[1], customDb, { seed: 'caverns', startingPlayer: 'player' });
  e.start();
  const cavern = e.state.players.ai.hand[0]; cavern.cardId = 'step20-caverns';
  const exile = e.state.players.ai.hand[1];
  e.perform('player', { type: 'KEEP_HAND' }); e.perform('ai', { type: 'KEEP_HAND' });
  assert.equal(e.state.pendingChoice?.playerId, 'ai');
  const accept = e.getLegalActions('ai').find(action => action.accept && action.exileCardInstanceId === exile.instanceId);
  assert.ok(accept);
  e.perform('ai', accept);
  const permanent = e.state.players.ai.battlefield.find(card => card.instanceId === cavern.instanceId);
  assert.ok(permanent);
  assert.equal(permanent.counters?.luck, 1);
  assert.equal(e.state.players.ai.exile.some(card => card.instanceId === exile.instanceId), true);
  assert.equal(e.state.gameBegun, true);
});

test('Step 20: manual starting-player selection rotates multiplayer turn order consistently', () => {
  const selected = playable.slice(0, 4);
  const e = new GameEngine(selected[0], selected.slice(1), db, { seed: 'manual-start', startingPlayer: 'ai2' });
  e.start();
  assert.deepEqual(e.state.playerOrder, ['ai2', 'ai3', 'player', 'ai']);
  assert.equal(e.state.activePlayer, 'ai2');
  assert.equal(e.state.pregame.startingPlayer, 'ai2');
  assert.equal(e.state.pregame.currentPlayer, 'ai2');
});
