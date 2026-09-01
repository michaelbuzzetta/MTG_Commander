import test from 'node:test';
import assert from 'node:assert/strict';
import { engine, putBattlefield, setPhase } from './helpers.js';

test('summoning sick creature cannot attack unless haste', () => { const e = engine(), c = putBattlefield(e, 'player', 'grizzly-bears', { summoningSick: true }); assert.ok(!e.combat.legalAttackers('player').includes(c)); });
test('flying can only be blocked by flying or reach', () => { const e = engine(), a = putBattlefield(e, 'player', 'wind-drake'), b = putBattlefield(e, 'ai', 'grizzly-bears'), r = putBattlefield(e, 'ai', 'giant-spider'); assert.equal(e.combat.canBlock(b, a), false); assert.equal(e.combat.canBlock(r, a), true); });
test('vigilance attacker does not tap', () => { const e = engine(), a = putBattlefield(e, 'player', 'vigilant-knight'); setPhase(e, 'DECLARE_ATTACKERS', { turnActionPending: 'DECLARE_ATTACKERS' }); e.perform('player', { type: 'DECLARE_ATTACKERS', attackers: [a.instanceId] }); assert.equal(a.tapped, false); });
test('normal attacker taps', () => { const e = engine(), a = putBattlefield(e, 'player', 'grizzly-bears'); setPhase(e, 'DECLARE_ATTACKERS', { turnActionPending: 'DECLARE_ATTACKERS' }); e.perform('player', { type: 'DECLARE_ATTACKERS', attackers: [a.instanceId] }); assert.equal(a.tapped, true); });
test('trample spills excess damage', () => { const e = engine(), a = putBattlefield(e, 'player', 'trampling-rhino'), b = putBattlefield(e, 'ai', 'grizzly-bears'); setPhase(e, 'DECLARE_ATTACKERS', { turnActionPending: 'DECLARE_ATTACKERS' }); e.perform('player', { type: 'DECLARE_ATTACKERS', attackers: [a.instanceId] }); e.perform('player', { type: 'PASS_PRIORITY' }); e.perform('ai', { type: 'PASS_PRIORITY' }); e.perform('ai', { type: 'DECLARE_BLOCKERS', blockers: { [a.instanceId]: [b.instanceId] } }); e.perform('player', { type: 'PASS_PRIORITY' }); e.perform('ai', { type: 'PASS_PRIORITY' }); assert.equal(e.state.players.ai.life, 38); });
test('lifelink gains life equal to damage', () => { const e = engine(), a = putBattlefield(e, 'player', 'vampire-nighthawk'); e.state.players.player.life = 30; e.dealDamageToPlayer('ai', 2, a); assert.equal(e.state.players.player.life, 32); });
test('deathtouch kills after any positive damage', () => { const e = engine(), a = putBattlefield(e, 'player', 'vampire-nighthawk'), b = putBattlefield(e, 'ai', 'giant-spider'); e.dealDamageToPermanent(b, 1, a); e.stateBasedActions(); assert.equal(e.findPermanent(b.instanceId), null); });
test('menace rejects single blocker', () => { const e = engine(), a = putBattlefield(e, 'player', 'menace-ogre'), b = putBattlefield(e, 'ai', 'grizzly-bears'); setPhase(e, 'DECLARE_ATTACKERS', { turnActionPending: 'DECLARE_ATTACKERS' }); e.perform('player', { type: 'DECLARE_ATTACKERS', attackers: [a.instanceId] }); e.perform('player', { type: 'PASS_PRIORITY' }); e.perform('ai', { type: 'PASS_PRIORITY' }); assert.throws(() => e.perform('ai', { type: 'DECLARE_BLOCKERS', blockers: { [a.instanceId]: [b.instanceId] } })); });

test('declaring attackers opens priority in the same step before blockers', () => {
  const e = engine(), a = putBattlefield(e, 'player', 'grizzly-bears');
  setPhase(e, 'DECLARE_ATTACKERS', { turnActionPending: 'DECLARE_ATTACKERS' });
  e.perform('player', { type: 'DECLARE_ATTACKERS', attackers: [a.instanceId] });
  assert.equal(e.state.phase, 'DECLARE_ATTACKERS');
  assert.equal(e.state.turnActionPending, null);
  assert.equal(e.state.priorityPlayer, 'player');
  assert.deepEqual(e.state.combat.attackers, [a.instanceId]);
  e.perform('player', { type: 'PASS_PRIORITY' });
  assert.equal(e.state.phase, 'DECLARE_ATTACKERS');
  assert.equal(e.state.priorityPlayer, 'ai');
  e.perform('ai', { type: 'PASS_PRIORITY' });
  assert.equal(e.state.phase, 'DECLARE_BLOCKERS');
  assert.equal(e.state.turnActionPending, 'DECLARE_BLOCKERS');
  assert.equal(e.state.priorityPlayer, 'ai');
});

test('declaring blockers opens priority before combat damage', () => {
  const e = engine(), a = putBattlefield(e, 'player', 'grizzly-bears'), b = putBattlefield(e, 'ai', 'grizzly-bears');
  setPhase(e, 'DECLARE_ATTACKERS', { turnActionPending: 'DECLARE_ATTACKERS' });
  e.perform('player', { type: 'DECLARE_ATTACKERS', attackers: [a.instanceId] });
  e.perform('player', { type: 'PASS_PRIORITY' }); e.perform('ai', { type: 'PASS_PRIORITY' });
  e.perform('ai', { type: 'DECLARE_BLOCKERS', blockers: { [a.instanceId]: [b.instanceId] } });
  assert.equal(e.state.phase, 'DECLARE_BLOCKERS');
  assert.equal(e.state.priorityPlayer, 'player');
  assert.ok(e.findPermanent(a.instanceId));
  assert.ok(e.findPermanent(b.instanceId));
  e.perform('player', { type: 'PASS_PRIORITY' }); e.perform('ai', { type: 'PASS_PRIORITY' });
  assert.equal(e.state.phase, 'COMBAT_DAMAGE');
  assert.equal(e.state.priorityPlayer, 'player');
  assert.equal(e.findPermanent(a.instanceId), null);
  assert.equal(e.findPermanent(b.instanceId), null);
});

test('first-strike damage gets its own priority window before regular combat damage', () => {
  const e = engine(), a = putBattlefield(e, 'player', 'grizzly-bears', { modifiers: { power: 0, toughness: 0, keywords: ['first strike'] } });
  setPhase(e, 'DECLARE_ATTACKERS', { turnActionPending: 'DECLARE_ATTACKERS' });
  e.perform('player', { type: 'DECLARE_ATTACKERS', attackers: [a.instanceId] });
  e.perform('player', { type: 'PASS_PRIORITY' }); e.perform('ai', { type: 'PASS_PRIORITY' });
  e.perform('ai', { type: 'DECLARE_BLOCKERS', blockers: {} });
  e.perform('player', { type: 'PASS_PRIORITY' }); e.perform('ai', { type: 'PASS_PRIORITY' });
  assert.equal(e.state.phase, 'FIRST_STRIKE_DAMAGE');
  assert.equal(e.state.players.ai.life, 38);
  assert.equal(e.state.priorityPlayer, 'player');
  e.perform('player', { type: 'PASS_PRIORITY' }); e.perform('ai', { type: 'PASS_PRIORITY' });
  assert.equal(e.state.phase, 'COMBAT_DAMAGE');
  assert.equal(e.state.players.ai.life, 38, 'first-strike-only creature does not deal normal damage');
  assert.equal(e.state.priorityPlayer, 'player');
});

test('empty attacker declaration still opens priority before blocker step', () => {
  const e = engine();
  setPhase(e, 'DECLARE_ATTACKERS', { turnActionPending: 'DECLARE_ATTACKERS' });
  e.perform('player', { type: 'DECLARE_ATTACKERS', attackers: [] });
  assert.equal(e.state.phase, 'DECLARE_ATTACKERS');
  assert.equal(e.state.priorityPlayer, 'player');
});


test('combat mutators cannot bypass the GameEngine action gateway', () => { const e = engine(), a = putBattlefield(e, 'player', 'grizzly-bears'); assert.throws(() => e.combat.declareAttackers('player', [a.instanceId]), /internal/); });

test('Category 4: noncreature permanents cannot block', () => {
  const e = engine();
  const attacker = putBattlefield(e, 'player', 'grizzly-bears');
  const land = putBattlefield(e, 'ai', 'forest');
  assert.equal(e.combat.canBlock(land, attacker), false);
});

test('Category 4: a blocker cannot be reused across attackers and duplicate combat ids are rejected', () => {
  const e = engine();
  const a1 = putBattlefield(e, 'player', 'grizzly-bears');
  const a2 = putBattlefield(e, 'player', 'grizzly-bears');
  const blocker = putBattlefield(e, 'ai', 'giant-spider');
  setPhase(e, 'DECLARE_ATTACKERS', { turnActionPending: 'DECLARE_ATTACKERS' });

  assert.throws(() => e.perform('player', { type: 'DECLARE_ATTACKERS', attackers: [a1.instanceId, a1.instanceId] }), /attacker/i);
  e.perform('player', { type: 'DECLARE_ATTACKERS', attackers: [a1.instanceId, a2.instanceId] });
  e.perform('player', { type: 'PASS_PRIORITY' });
  e.perform('ai', { type: 'PASS_PRIORITY' });

  assert.throws(() => e.perform('ai', {
    type: 'DECLARE_BLOCKERS',
    blockers: {
      [a1.instanceId]: [blocker.instanceId],
      [a2.instanceId]: [blocker.instanceId]
    }
  }), /blocker/i);

  assert.throws(() => e.perform('ai', {
    type: 'DECLARE_BLOCKERS',
    blockers: { [a1.instanceId]: [blocker.instanceId, blocker.instanceId] }
  }), /blocker/i);
});

test('Category 4: a first-strike blocker deals first-strike damage even when the attacker lacks first strike', () => {
  const e = engine();
  const attacker = putBattlefield(e, 'player', 'grizzly-bears');
  const blocker = putBattlefield(e, 'ai', 'firstblade');
  setPhase(e, 'DECLARE_ATTACKERS', { turnActionPending: 'DECLARE_ATTACKERS' });

  e.perform('player', { type: 'DECLARE_ATTACKERS', attackers: [attacker.instanceId] });
  e.perform('player', { type: 'PASS_PRIORITY' });
  e.perform('ai', { type: 'PASS_PRIORITY' });
  e.perform('ai', { type: 'DECLARE_BLOCKERS', blockers: { [attacker.instanceId]: [blocker.instanceId] } });
  e.perform('player', { type: 'PASS_PRIORITY' });
  e.perform('ai', { type: 'PASS_PRIORITY' });

  assert.equal(e.state.phase, 'FIRST_STRIKE_DAMAGE');
  assert.equal(e.findPermanent(attacker.instanceId), null, 'normal attacker dies to first-strike blocker before normal damage');
  assert.ok(e.findPermanent(blocker.instanceId));
});

test('Category 4: a blocked double-strike attacker stays blocked after its blocker dies', () => {
  const e = engine();
  const attacker = putBattlefield(e, 'player', 'doubleblade');
  const blocker = putBattlefield(e, 'ai', 'grizzly-bears');
  setPhase(e, 'DECLARE_ATTACKERS', { turnActionPending: 'DECLARE_ATTACKERS' });

  e.perform('player', { type: 'DECLARE_ATTACKERS', attackers: [attacker.instanceId] });
  e.perform('player', { type: 'PASS_PRIORITY' });
  e.perform('ai', { type: 'PASS_PRIORITY' });
  e.perform('ai', { type: 'DECLARE_BLOCKERS', blockers: { [attacker.instanceId]: [blocker.instanceId] } });
  e.perform('player', { type: 'PASS_PRIORITY' });
  e.perform('ai', { type: 'PASS_PRIORITY' });

  assert.equal(e.state.phase, 'FIRST_STRIKE_DAMAGE');
  assert.equal(e.findPermanent(blocker.instanceId), null);
  assert.equal(e.state.players.ai.life, 40);
  assert.equal(e.state.combat.blocked[attacker.instanceId], true);

  e.perform('player', { type: 'PASS_PRIORITY' });
  e.perform('ai', { type: 'PASS_PRIORITY' });
  assert.equal(e.state.phase, 'COMBAT_DAMAGE');
  assert.equal(e.state.players.ai.life, 40, 'blocked attacker without trample cannot hit the player in the second damage step');
});

test('Category 4: attacking player chooses and persists blocker damage-assignment order', () => {
  const e = engine();
  const attacker = putBattlefield(e, 'player', 'grizzly-bears', { modifiers: { power: 2, toughness: 2, keywords: [] } }); // 4/4
  const small = putBattlefield(e, 'ai', 'grizzly-bears');
  const large = putBattlefield(e, 'ai', 'giant-spider');
  setPhase(e, 'DECLARE_ATTACKERS', { turnActionPending: 'DECLARE_ATTACKERS' });

  e.perform('player', { type: 'DECLARE_ATTACKERS', attackers: [attacker.instanceId] });
  e.perform('player', { type: 'PASS_PRIORITY' });
  e.perform('ai', { type: 'PASS_PRIORITY' });
  e.perform('ai', { type: 'DECLARE_BLOCKERS', blockers: { [attacker.instanceId]: [small.instanceId, large.instanceId] } });

  assert.equal(e.state.pendingChoice?.type, 'COMBAT_DAMAGE_ORDER');
  assert.equal(e.state.pendingChoice?.playerId, 'player');
  assert.throws(() => e.perform('player', { type: 'PASS_PRIORITY' }), /order/i);
  assert.throws(() => e.perform('player', {
    type: 'ORDER_BLOCKERS',
    orders: { [attacker.instanceId]: [small.instanceId, small.instanceId] }
  }), /order/i);

  e.perform('player', {
    type: 'ORDER_BLOCKERS',
    orders: { [attacker.instanceId]: [large.instanceId, small.instanceId] }
  });
  assert.deepEqual(e.state.combat.damageAssignments[attacker.instanceId], [large.instanceId, small.instanceId]);
  assert.equal(e.state.pendingChoice, null);

  e.perform('player', { type: 'PASS_PRIORITY' });
  e.perform('ai', { type: 'PASS_PRIORITY' });
  assert.equal(e.state.phase, 'COMBAT_DAMAGE');
  assert.equal(e.findPermanent(large.instanceId), null, 'chosen first blocker receives lethal damage first');
  assert.ok(e.findPermanent(small.instanceId), 'later blocker survives because attacker had no damage left');
});

test('Category 4: indestructible survives lethal and deathtouch destruction but not zero toughness', () => {
  const e = engine();
  const god = putBattlefield(e, 'player', 'indestructible-god');
  god.damageMarked = 4;
  god.deathtouchMarked = true;
  e.stateBasedActions();
  assert.ok(e.findPermanent(god.instanceId), 'indestructible survives lethal marked/deathtouch damage');

  god.modifiers.toughness = -4;
  e.stateBasedActions();
  assert.equal(e.findPermanent(god.instanceId), null, 'indestructible still dies when toughness is zero or less');
});
