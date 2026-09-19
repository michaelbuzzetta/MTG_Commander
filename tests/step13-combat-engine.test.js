import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../src/engine/GameEngine.js';
import { engine, putBattlefield, setPhase, db, decks } from './helpers.js';

function threePlayerEngine() {
  const a = decks.find(d => d.id === 'explorers');
  const b = decks.find(d => d.id === 'blech');
  const c = decks.find(d => d.id !== a.id && d.id !== b.id) || a;
  const e = new GameEngine(a, [b, c], db, { rng: () => 0.42 });
  e.start();
  for (const id of e.playerIds()) e.perform(id, { type: 'KEEP_HAND' });
  return e;
}

test('Step 13: planeswalkers are legal defending entities and combat damage removes loyalty', () => {
  const e = engine();
  e._registerRuntimeCardDefinition('test-walker', { id: 'test-walker', name: 'Test Walker', typeLine: 'Legendary Planeswalker — Test', loyalty: 5, keywords: [], abilities: [] });
  const attacker = putBattlefield(e, 'player', 'grizzly-bears');
  const walker = putBattlefield(e, 'ai', 'test-walker', { counters: { loyalty: 5 } });
  assert.ok(e.getLegalDefendingEntities('player').some(entity => entity.id === walker.instanceId && entity.type === 'planeswalker'));
  setPhase(e, 'DECLARE_ATTACKERS', { turnActionPending: 'DECLARE_ATTACKERS' });
  e.perform('player', { type: 'DECLARE_ATTACKERS', attackers: [attacker.instanceId], attackTargets: { [attacker.instanceId]: walker.instanceId } });
  e.perform('player', { type: 'PASS_PRIORITY' }); e.perform('ai', { type: 'PASS_PRIORITY' });
  e.perform('ai', { type: 'DECLARE_BLOCKERS', blockers: {} });
  e.perform('player', { type: 'PASS_PRIORITY' }); e.perform('ai', { type: 'PASS_PRIORITY' });
  assert.equal(walker.counters.loyalty, 3);
  assert.equal(e.state.players.ai.life, 40);
});

test('Step 13: goad requires an attack and maximizes attacking a player other than the goader', () => {
  const e = threePlayerEngine();
  const attacker = putBattlefield(e, 'player', 'grizzly-bears', { goadedBy: ['ai'] });
  setPhase(e, 'DECLARE_ATTACKERS', { turnActionPending: 'DECLARE_ATTACKERS' });
  assert.throws(() => e.perform('player', { type: 'DECLARE_ATTACKERS', attackers: [] }), /must attack/i);
  assert.throws(() => e.perform('player', { type: 'DECLARE_ATTACKERS', attackers: [attacker.instanceId], attackTargets: { [attacker.instanceId]: 'ai' } }), /maximum number/i);
  assert.doesNotThrow(() => e.perform('player', { type: 'DECLARE_ATTACKERS', attackers: [attacker.instanceId], attackTargets: { [attacker.instanceId]: 'ai2' } }));
});

test('Step 13: cannot-attack-alone restriction is enforced', () => {
  const e = engine();
  const attacker = putBattlefield(e, 'player', 'grizzly-bears', { cantAttackAlone: true });
  setPhase(e, 'DECLARE_ATTACKERS', { turnActionPending: 'DECLARE_ATTACKERS' });
  assert.throws(() => e.perform('player', { type: 'DECLARE_ATTACKERS', attackers: [attacker.instanceId] }), /cannot attack alone/i);
});

test('Step 13: fear, intimidate, shadow, and horsemanship blocking restrictions are enforced', () => {
  const e = engine();
  const green = putBattlefield(e, 'ai', 'grizzly-bears');
  const black = putBattlefield(e, 'ai', 'menace-ogre');
  const fear = putBattlefield(e, 'player', 'grizzly-bears', { modifiers: { power: 0, toughness: 0, keywords: ['fear'] } });
  assert.equal(e.combat.canBlock(green, fear), false);
  assert.equal(e.combat.canBlock(black, fear), true);

  const intimidate = putBattlefield(e, 'player', 'grizzly-bears', { modifiers: { power: 0, toughness: 0, keywords: ['intimidate'] } });
  assert.equal(e.combat.canBlock(green, intimidate), true);
  assert.equal(e.combat.canBlock(black, intimidate), false);

  const shadow = putBattlefield(e, 'player', 'grizzly-bears', { modifiers: { power: 0, toughness: 0, keywords: ['shadow'] } });
  assert.equal(e.combat.canBlock(green, shadow), false);
  green.modifiers.keywords.push('shadow');
  assert.equal(e.combat.canBlock(green, shadow), true);

  const horse = putBattlefield(e, 'player', 'grizzly-bears', { modifiers: { power: 0, toughness: 0, keywords: ['horsemanship'] } });
  assert.equal(e.combat.canBlock(black, horse), false);
  black.modifiers.keywords.push('horsemanship');
  assert.equal(e.combat.canBlock(black, horse), true);
});

test('Step 13: all five basic landwalk variants use defending-player land subtypes', () => {
  const e = engine();
  const blocker = putBattlefield(e, 'ai', 'grizzly-bears');
  for (const [keyword, landId] of [['plainswalk','plains'], ['islandwalk','island'], ['swampwalk','swamp'], ['mountainwalk','mountain'], ['forestwalk','forest']]) {
    const attacker = putBattlefield(e, 'player', 'grizzly-bears', { modifiers: { power: 0, toughness: 0, keywords: [keyword] } });
    const land = putBattlefield(e, 'ai', landId);
    e.state.combat.attackDefendingPlayers[attacker.instanceId] = 'ai';
    assert.equal(e.combat.canBlock(blocker, attacker), false, `${keyword} should be unblockable when defender controls matching basic type`);
    e._moveZoneNow(land, 'graveyard', land.owner);
    assert.equal(e.combat.canBlock(blocker, attacker), true, `${keyword} should stop applying when matching land type is gone`);
    e._moveZoneNow(attacker, 'graveyard', attacker.owner);
  }
});

test('Step 13: a creature may block additional attackers when its rule permits it', () => {
  const e = engine();
  const a1 = putBattlefield(e, 'player', 'grizzly-bears');
  const a2 = putBattlefield(e, 'player', 'grizzly-bears');
  const blocker = putBattlefield(e, 'ai', 'giant-spider', { canBlockAdditional: 1 });
  setPhase(e, 'DECLARE_ATTACKERS', { turnActionPending: 'DECLARE_ATTACKERS' });
  e.perform('player', { type: 'DECLARE_ATTACKERS', attackers: [a1.instanceId, a2.instanceId] });
  e.perform('player', { type: 'PASS_PRIORITY' }); e.perform('ai', { type: 'PASS_PRIORITY' });
  assert.doesNotThrow(() => e.perform('ai', { type: 'DECLARE_BLOCKERS', blockers: { [a1.instanceId]: [blocker.instanceId], [a2.instanceId]: [blocker.instanceId] } }));
});

test('Step 13: must-block requirements reject a declaration that ignores an able blocker', () => {
  const e = engine();
  const attacker = putBattlefield(e, 'player', 'grizzly-bears');
  putBattlefield(e, 'ai', 'giant-spider', { mustBlock: true });
  setPhase(e, 'DECLARE_ATTACKERS', { turnActionPending: 'DECLARE_ATTACKERS' });
  e.perform('player', { type: 'DECLARE_ATTACKERS', attackers: [attacker.instanceId] });
  e.perform('player', { type: 'PASS_PRIORITY' }); e.perform('ai', { type: 'PASS_PRIORITY' });
  assert.throws(() => e.perform('ai', { type: 'DECLARE_BLOCKERS', blockers: {} }), /must block/i);
});

test('Step 13: commander combat damage is recorded against the source commander identity', () => {
  const e = engine();
  const commanderCard = putBattlefield(e, 'player', 'grizzly-bears', { isCommander: true });
  setPhase(e, 'DECLARE_ATTACKERS', { turnActionPending: 'DECLARE_ATTACKERS' });
  e.perform('player', { type: 'DECLARE_ATTACKERS', attackers: [commanderCard.instanceId] });
  e.perform('player', { type: 'PASS_PRIORITY' }); e.perform('ai', { type: 'PASS_PRIORITY' });
  e.perform('ai', { type: 'DECLARE_BLOCKERS', blockers: {} });
  e.perform('player', { type: 'PASS_PRIORITY' }); e.perform('ai', { type: 'PASS_PRIORITY' });
  assert.ok(Number(e.state.players.ai.commanderDamage[commanderCard.instanceId] || 0) > 0);
});
