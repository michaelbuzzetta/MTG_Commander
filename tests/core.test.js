import test from 'node:test';
import assert from 'node:assert/strict';
import { engine, rawEngine, db, decks, putBattlefield, setPhase } from './helpers.js';
import { ManaEngine } from '../src/engine/ManaEngine.js';

test('all configured decks are 100-card Commander decks with resolvable commanders', () => {
  assert.ok(decks.length >= 6);
  for (const d of decks) {
    assert.equal(d.format, 'Commander');
    assert.equal(d.cardCount, 100);
    assert.equal(d.cards.reduce((n, x) => n + x.quantity, 0), 100);
    assert.ok(db[d.commander]);
  }
});

test('game starts with 40 life, 7-card opening hands, commanders, and a pregame mulligan window', () => {
  const e = rawEngine();
  for (const p of Object.values(e.state.players)) {
    assert.equal(p.life, 40);
    assert.equal(p.hand.length, 7);
    assert.equal(p.command.length, 1);
    assert.equal(p.library.length, 92);
  }
  assert.equal(e.state.pregame.active, true);
  assert.deepEqual(e.getLegalActions('player').map(a => a.type), ['MULLIGAN', 'KEEP_HAND']);
});

test('Commander/London mulligan keeps seven until explicit bottom-card selection', () => {
  const e = rawEngine();
  e.perform('player', { type: 'MULLIGAN' });
  assert.equal(e.state.players.player.hand.length, 7);
  assert.equal(e.state.players.player.mulligans, 1);
  e.perform('player', { type: 'MULLIGAN' });
  assert.equal(e.state.players.player.hand.length, 7);
  assert.equal(e.state.players.player.mulligans, 2);
  e.perform('player', { type: 'KEEP_HAND' });
  assert.equal(e.state.pendingChoice.type, 'MULLIGAN_BOTTOM');
  assert.equal(e.state.pendingChoice.count, 1);
  const selected = e.state.players.player.hand[2].instanceId;
  e.perform('player', { type: 'BOTTOM_CARDS', cardInstanceIds: [selected] });
  assert.equal(e.state.players.player.hand.length, 6);
  assert.equal(e.state.players.player.library.at(-1).instanceId, selected);
});

test('mulligan is illegal after pregame ends', () => {
  const e = engine();
  assert.throws(() => e.perform('player', { type: 'MULLIGAN' }), /Mulligan window is closed/);
});

test('start is guarded against duplicate opening hands', () => {
  const e = rawEngine();
  assert.throws(() => e.start(), /already started/);
  assert.equal(e.state.players.player.hand.length, 7);
});

test('mana engine enforces colored and generic costs', () => {
  const p = { manaPool: { W: 0, U: 1, B: 0, R: 0, G: 2, C: 1 } };
  assert.ok(ManaEngine.canPay(p, '{2}{U}{G}'));
  assert.equal(ManaEngine.canPay(p, '{B}'), false);
  assert.ok(ManaEngine.pay(p, '{2}{U}{G}'));
  assert.equal(Object.values(p.manaPool).reduce((a, b) => a + b, 0), 0);
});

test('lands tap for mana and cannot tap twice', () => {
  const e = engine(), land = putBattlefield(e, 'player', 'island');
  const a = db.island.abilities[0];
  e.activateMana('player', land.instanceId, a);
  assert.equal(e.state.players.player.manaPool.U, 1);
  assert.throws(() => e.activateMana('player', land.instanceId, a));
});

test('commander tax increments by two per cast from command zone', () => {
  const e = engine(), p = e.state.players.player, c = p.command[0];
  setPhase(e, 'PRECOMBAT_MAIN');
  p.manaPool = { W: 0, U: 10, B: 0, R: 0, G: 10, C: 10 };
  e.cast('player', c.instanceId);
  assert.equal(p.commanderTax, 2);
});

test('creature commander obeys sorcery timing', () => {
  const e = engine(), p = e.state.players.player, c = p.command[0];
  p.manaPool = { W: 0, U: 20, B: 0, R: 0, G: 20, C: 20 };
  setPhase(e, 'UPKEEP', { activePlayer: 'ai', priorityPlayer: 'player' });
  assert.ok(!e.getLegalActions('player').some(a => a.type === 'CAST_COMMANDER'));
  assert.throws(() => e.cast('player', c.instanceId), /cannot be cast at this time/);
});

test('authoritative gateway rejects casting an opponent-owned card from opponent hand', () => {
  const e = engine();
  setPhase(e, 'PRECOMBAT_MAIN');
  const stolenId = e.state.players.ai.hand.find(c => !db[c.cardId].typeLine.toLowerCase().includes('land'))?.instanceId;
  assert.ok(stolenId);
  e.state.players.player.manaPool = { W: 20, U: 20, B: 20, R: 20, G: 20, C: 20 };
  assert.throws(() => e.perform('player', { type: 'CAST_SPELL', cardInstanceId: stolenId }), /owned by another player/);
});

test('caster retains priority after putting a spell on the stack', () => {
  const e = engine(), p = e.state.players.player;
  p.hand = [];
  const spell = { instanceId: 'spell-priority', cardId: 'merfolk-mistbinder', owner: 'player', controller: 'player', zone: 'hand', tapped: false, summoningSick: false, counters: {}, damageMarked: 0, modifiers: { power: 0, toughness: 0, keywords: [] } };
  p.hand.push(spell);
  putBattlefield(e, 'player', 'forest');
  putBattlefield(e, 'player', 'island');
  setPhase(e, 'PRECOMBAT_MAIN');
  e.cast('player', spell.instanceId);
  assert.equal(e.state.priorityPlayer, 'player');
  assert.equal(e.state.stack.at(-1).card.instanceId, spell.instanceId);
  assert.ok(e.getLegalActions('player').some(a => a.type === 'PASS_PRIORITY'));
});

test('replacement effects stack counters through the controller-selected order', () => {
  const e = engine();
  putBattlefield(e, 'player', 'hardened-scales');
  putBattlefield(e, 'player', 'branching-evolution');
  const t = putBattlefield(e, 'player', 'grizzly-bears');
  e.effects.addCounters('player', t, '+1/+1', 1);
  assert.equal(e.state.pendingChoice?.type, 'REPLACEMENT_ORDER');
  const ids = [...e.state.pendingChoice.replacements]
    .sort((a, b) => (a.effect === 'addOne' ? -1 : 1))
    .map(x => x.id);
  e.perform('player', { type: 'ORDER_REPLACEMENTS', replacementIds: ids });
  assert.equal(t.counters['+1/+1'], 4);
});

test('doubling season doubles token creation', () => {
  const e = engine();
  putBattlefield(e, 'player', 'doubling-season');
  const before = e.state.players.player.battlefield.length;
  e.effects.createToken('player', { name: 'Pest', typeLine: 'Creature — Pest', power: 1, toughness: 1, subtypes: ['Pest'] }, 2);
  assert.equal(e.state.players.player.battlefield.length - before, 4);
});

test('academy manufactor makes three utility tokens', () => {
  const e = engine();
  putBattlefield(e, 'player', 'academy-manufactor');
  e.effects.createToken('player', { name: 'Treasure', typeLine: 'Artifact — Treasure' }, 1);
  const names = e.state.players.player.battlefield.map(x => e.db[x.cardId]?.name);
  assert.ok(names.includes('Treasure') && names.includes('Food') && names.includes('Clue'));
});

test('state based actions kill lethal creature', () => {
  const e = engine(), c = putBattlefield(e, 'player', 'grizzly-bears');
  c.damageMarked = 2;
  e.stateBasedActions();
  assert.equal(e.findPermanent(c.instanceId), null);
  assert.ok(e.state.players.player.graveyard.some(x => x.instanceId === c.instanceId));
});

test('indestructible ignores destroy', () => {
  const e = engine(), c = putBattlefield(e, 'player', 'indestructible-god');
  assert.equal(e.destroy(c), false);
  assert.ok(e.findPermanent(c.instanceId));
});

test('life <=0 loses game', () => { const e = engine(); e.changeLife('ai', -40); assert.equal(e.state.winner, 'player'); });
test('21 combat damage from one commander loses game', () => { const e = engine(), c = putBattlefield(e, 'player', 'hakbal', { isCommander: true }); e.dealDamageToPlayer('ai', 21, c, { combat: true }); assert.equal(e.state.winner, 'player'); });

test('commander owner may return a destroyed commander to the command zone', () => {
  const e = engine(), p = e.state.players.player, c = p.command.shift();
  c.zone = 'battlefield'; c.controller = 'player'; p.battlefield.push(c);
  e.destroy(c);
  e.stateBasedActions();
  assert.equal(e.state.pendingChoice?.type, 'COMMANDER_ZONE');
  e.perform('player', { type: 'CHOOSE_COMMANDER_ZONE', moveToCommand: true });
  assert.ok(p.command.some(x => x.instanceId === c.instanceId));
});

test('untapped lands count toward castability before mana is manually floated', () => {
  const e = engine(), p = e.state.players.player;
  p.hand = [];
  const spell = { instanceId: 'spell-test', cardId: 'merfolk-mistbinder', owner: 'player', controller: 'player', zone: 'hand', tapped: false, summoningSick: false, counters: {}, damageMarked: 0, modifiers: { power: 0, toughness: 0, keywords: [] } };
  p.hand.push(spell); putBattlefield(e, 'player', 'forest'); putBattlefield(e, 'player', 'island');
  setPhase(e, 'PRECOMBAT_MAIN');
  assert.ok(e.getLegalActions('player').some(a => a.type === 'CAST_SPELL' && a.cardInstanceId === spell.instanceId));
});

test('casting automatically taps appropriate lands and puts spell on stack', () => {
  const e = engine(), p = e.state.players.player;
  p.hand = [];
  const spell = { instanceId: 'spell-test-2', cardId: 'merfolk-mistbinder', owner: 'player', controller: 'player', zone: 'hand', tapped: false, summoningSick: false, counters: {}, damageMarked: 0, modifiers: { power: 0, toughness: 0, keywords: [] } };
  p.hand.push(spell); const f = putBattlefield(e, 'player', 'forest'); const i = putBattlefield(e, 'player', 'island');
  setPhase(e, 'PRECOMBAT_MAIN');
  e.cast('player', spell.instanceId);
  assert.equal(f.tapped, true); assert.equal(i.tapped, true); assert.equal(e.state.stack.at(-1).card.instanceId, spell.instanceId);
});

test('generic costs auto-tap enough sources without requiring manual mana activation', () => {
  const e = engine(), p = e.state.players.player;
  p.hand = [];
  const spell = { instanceId: 'spell-test-3', cardId: 'divination', owner: 'player', controller: 'player', zone: 'hand', tapped: false, summoningSick: false, counters: {}, damageMarked: 0, modifiers: { power: 0, toughness: 0, keywords: [] } };
  p.hand.push(spell); putBattlefield(e, 'player', 'island'); putBattlefield(e, 'player', 'forest'); putBattlefield(e, 'player', 'forest');
  setPhase(e, 'PRECOMBAT_MAIN');
  assert.ok(e.canCast('player', spell)); e.cast('player', spell.instanceId);
  assert.equal(p.battlefield.filter(x => x.tapped).length, 3);
});

test('cleanup only makes active player discard and requires exact card selection', () => {
  const e = engine(), player = e.state.players.player, ai = e.state.players.ai;
  while (player.hand.length < 9) e.draw('player');
  while (ai.hand.length < 9) e.draw('ai');
  setPhase(e, 'END_STEP', { activePlayer: 'ai', priorityPlayer: 'ai' });
  e.perform('ai', { type: 'PASS_PRIORITY' });
  e.perform('player', { type: 'PASS_PRIORITY' });
  assert.equal(e.state.phase, 'CLEANUP');
  assert.equal(e.state.pendingChoice.playerId, 'ai');
  assert.equal(e.state.pendingChoice.count, 2);
  assert.equal(player.hand.length, 9);
  const chosen = ai.hand.slice(0, 2).map(c => c.instanceId);
  e.perform('ai', { type: 'DISCARD_CARDS', cardInstanceIds: chosen });
  assert.equal(ai.hand.length, 7);
  assert.equal(player.hand.length, 9);
  assert.ok(chosen.every(id => ai.graveyard.some(c => c.instanceId === id)));
});

test('draw step performs the draw before opening its priority window', () => {
  const e = engine();
  setPhase(e, 'UPKEEP', { activePlayer: 'player', priorityPlayer: 'player' });
  const before = e.state.players.player.hand.length;
  e.perform('player', { type: 'PASS_PRIORITY' });
  e.perform('ai', { type: 'PASS_PRIORITY' });
  assert.equal(e.state.phase, 'DRAW');
  assert.equal(e.state.players.player.hand.length, before + 1);
  assert.equal(e.state.priorityPlayer, 'player');
});

test('activator retains priority after putting a nonmana activated ability on the stack', () => {
  const e = engine();
  e.db['grizzly-bears'].abilities = [{ type: 'activated', effect: { type: 'gainLife', amount: 1 } }];
  const source = putBattlefield(e, 'player', 'grizzly-bears');
  setPhase(e, 'UPKEEP', { activePlayer: 'player', priorityPlayer: 'player' });
  const ability = e.db['grizzly-bears'].abilities[0];
  e.perform('player', { type: 'ACTIVATE_ABILITY', permanentId: source.instanceId, ability });
  assert.equal(e.state.stack.at(-1).type, 'ability');
  assert.equal(e.state.priorityPlayer, 'player');
});

test('cleanup repeats after a cleanup trigger creates a priority window', () => {
  const e = engine();
  e.db['cleanup-watcher'] = {
    id: 'cleanup-watcher', name: 'Cleanup Watcher', typeLine: 'Enchantment', manaCost: '', manaValue: 0,
    keywords: [], subtypes: [], spellEffects: [], abilities: [{ type: 'triggered', event: 'CARD_DISCARDED', effect: { type: 'gainLife', amount: 1 } }]
  };
  putBattlefield(e, 'player', 'cleanup-watcher');
  const ai = e.state.players.ai;
  while (ai.hand.length < 8) e.draw('ai');
  setPhase(e, 'END_STEP', { activePlayer: 'ai', priorityPlayer: 'ai' });
  e.perform('ai', { type: 'PASS_PRIORITY' });
  e.perform('player', { type: 'PASS_PRIORITY' });
  const discarded = ai.hand[0].instanceId;
  e.perform('ai', { type: 'DISCARD_CARDS', cardInstanceIds: [discarded] });
  assert.equal(e.state.phase, 'CLEANUP');
  assert.equal(e.state.cleanupPriority, true);
  assert.equal(e.state.stack.length, 1);
  assert.equal(e.state.priorityPlayer, 'ai');
  e.perform('ai', { type: 'PASS_PRIORITY' });
  e.perform('player', { type: 'PASS_PRIORITY' });
  assert.equal(e.state.stack.length, 0);
  assert.equal(e.state.priorityPlayer, 'ai');
  e.perform('ai', { type: 'PASS_PRIORITY' });
  e.perform('player', { type: 'PASS_PRIORITY' });
  assert.equal(e.state.turn, 2);
  assert.equal(e.state.activePlayer, 'player');
  assert.equal(e.state.phase, 'UPKEEP');
});
