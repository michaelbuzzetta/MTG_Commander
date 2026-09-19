import test from 'node:test';
import assert from 'node:assert/strict';
import { engine, putBattlefield, setPhase } from './helpers.js';
import { makeCardInstance } from '../src/engine/GameState.js';
import { AIController } from '../src/ai/AIController.js';
import { LEGALITY_OPERATION, RULE_KIND } from '../src/engine/legality/index.js';

function definition(id, extra = {}) {
  return {
    id,
    name: id,
    typeLine: 'Instant',
    manaCost: '{0}',
    manaValue: 0,
    colors: [],
    colorIdentity: [],
    subtypes: [],
    keywords: [],
    abilities: [],
    spellEffects: [],
    oracleText: '',
    supported: true,
    ...extra
  };
}

function addCard(e, pid, id, zone = 'hand', extraDefinition = {}, extraCard = {}) {
  e._registerRuntimeCardDefinition(id, definition(id, extraDefinition));
  const card = makeCardInstance(id, pid, zone, extraCard, e.db[id]);
  e.zones.place(card, zone, pid);
  return card;
}

function addPermanent(e, pid, id, extraDefinition = {}, extraCard = {}) {
  return addCard(e, pid, id, 'battlefield', extraDefinition, { summoningSick: false, ...extraCard });
}

function freeSpell(e, pid, id, zone = 'hand', extra = {}) {
  return addCard(e, pid, id, zone, { typeLine: 'Instant', manaCost: '{0}', manaValue: 0, ...extra });
}

test('Step 21: permission, restriction, and requirement rule objects share one registry and diagnostic surface', () => {
  const e = engine();
  e.registerLegalityRule({ id: 'permission', kind: RULE_KIND.PERMISSION, operation: LEGALITY_OPERATION.CAST, appliesTo: 'player', fromZone: 'graveyard' });
  e.registerLegalityRule({ id: 'restriction', kind: RULE_KIND.RESTRICTION, operation: LEGALITY_OPERATION.SEARCH, appliesTo: 'player' });
  e.registerLegalityRule({ id: 'requirement', kind: RULE_KIND.REQUIREMENT, operation: LEGALITY_OPERATION.ATTACK, appliesTo: 'player', genericCostPerObject: 2 });
  const snapshot = e.getLegalitySnapshot();
  assert.deepEqual(new Set(snapshot.activeRules.map(rule => rule.kind)), new Set(['permission', 'restriction', 'requirement']));
  assert.equal(snapshot.activeRules.find(rule => rule.id === 'requirement').genericCostPerObject, 2);
});

test('Step 21: Arcane-Laboratory-style universal restriction constrains its controller and blocks a second cast before mana is paid', () => {
  const e = engine();
  addPermanent(e, 'player', 'step21-arcane-lab', {
    typeLine: 'Enchantment',
    oracleText: "Each player can't cast more than one spell each turn."
  });
  const first = freeSpell(e, 'player', 'step21-first');
  const second = addCard(e, 'player', 'step21-second', 'hand', { typeLine: 'Instant', manaCost: '{1}', manaValue: 1 });
  setPhase(e, 'PRECOMBAT_MAIN', { activePlayer: 'player', priorityPlayer: 'player' });
  e.state.players.player.manaPool.C = 1;

  assert.equal(e.submitAction('player', { type: 'CAST_SPELL', cardInstanceId: first.instanceId }).ok, true);
  const manaBefore = e.state.players.player.manaPool.C;
  assert.equal(e.isActionLegal('player', { type: 'CAST_SPELL', cardInstanceId: second.instanceId }), false);
  assert.equal(e.getLegalActions('player').some(action => action.cardInstanceId === second.instanceId), false);
  const denied = e.submitAction('player', { type: 'CAST_SPELL', cardInstanceId: second.instanceId });
  assert.equal(denied.ok, false);
  assert.match(denied.error.message, /more than one spell/i);
  assert.equal(e.state.players.player.manaPool.C, manaBefore, 'restriction must fire before payment');
  assert.ok(e.getLegalityDiagnostics().some(row => row.kind === 'denied' && row.operation === 'CAST'));
});

test('Step 21: cast-from-graveyard and flash permissions surface in the authoritative legal-action list', () => {
  const e = engine();
  const spell = addCard(e, 'player', 'step21-grave-spell', 'graveyard', { typeLine: 'Sorcery', manaCost: '{0}', manaValue: 0 });
  setPhase(e, 'UPKEEP', { activePlayer: 'ai', priorityPlayer: 'player' });
  assert.equal(e.isActionLegal('player', { type: 'CAST_SPELL', cardInstanceId: spell.instanceId, castOption: 'rule-permission' }), false);

  e.registerLegalityRule({
    id: 'grave-flash', kind: RULE_KIND.PERMISSION, operation: LEGALITY_OPERATION.CAST,
    appliesTo: 'player', fromZone: 'graveyard', timing: 'any'
  });
  const action = e.getLegalActions('player').find(item => item.cardInstanceId === spell.instanceId && item.castOption === 'rule-permission');
  assert.ok(action, 'zone/timing permission must be exposed to clients');
  assert.equal(e.isActionLegal('player', action), true);
});

test("Step 21: a 'can't' restriction takes precedence over a cast permission", () => {
  const e = engine();
  const spell = freeSpell(e, 'player', 'step21-permitted-but-forbidden', 'graveyard');
  setPhase(e, 'UPKEEP', { activePlayer: 'ai', priorityPlayer: 'player' });
  e.registerLegalityRule({ id: 'permission', kind: RULE_KIND.PERMISSION, operation: LEGALITY_OPERATION.CAST, appliesTo: 'player', fromZone: 'graveyard', timing: 'any' });
  e.registerLegalityRule({ id: 'restriction', kind: RULE_KIND.RESTRICTION, operation: LEGALITY_OPERATION.CAST, appliesTo: 'player', message: 'Casting is locked.' });
  const action = { type: 'CAST_SPELL', cardInstanceId: spell.instanceId, castOption: 'rule-permission' };
  assert.equal(e.isActionLegal('player', action), false);
  assert.equal(e.getLegalActions('player').some(item => item.cardInstanceId === spell.instanceId), false);
});

test('Step 21: additional-land permission grants exactly one extra land play and then exhausts naturally', () => {
  const e = engine();
  const landA = addCard(e, 'player', 'step21-land-a', 'hand', { typeLine: 'Land', manaCost: '', manaValue: 0 });
  const landB = addCard(e, 'player', 'step21-land-b', 'hand', { typeLine: 'Land', manaCost: '', manaValue: 0 });
  setPhase(e, 'PRECOMBAT_MAIN', { activePlayer: 'player', priorityPlayer: 'player' });
  e.state.players.player.landPlaysRemaining = 0;
  e.registerLegalityRule({ id: 'extra-land', kind: RULE_KIND.PERMISSION, operation: LEGALITY_OPERATION.PLAY_LAND, appliesTo: 'player', additionalLandPlays: 1 });
  assert.equal(e.submitAction('player', { type: 'PLAY_LAND', cardInstanceId: landA.instanceId }).ok, true);
  assert.equal(e.isActionLegal('player', { type: 'PLAY_LAND', cardInstanceId: landB.instanceId }), false);
});

test('Step 21: per-turn draw restriction prevents later draws without aborting the resolving effect', () => {
  const e = engine();
  e.registerLegalityRule({ id: 'one-draw', kind: RULE_KIND.RESTRICTION, operation: LEGALITY_OPERATION.DRAW, appliesTo: 'player', maxPerTurn: 1, message: 'Only one draw each turn.' });
  const hand = e.state.players.player.hand.length;
  assert.ok(e.draw('player'));
  assert.equal(e.state.players.player.hand.length, hand + 1);
  assert.equal(e.draw('player'), null);
  assert.equal(e.state.players.player.hand.length, hand + 1);
});

test("Step 21: players-can't-search restriction stops search effects before library selection", () => {
  const e = engine();
  addPermanent(e, 'player', 'step21-search-lock', { typeLine: 'Artifact', oracleText: "Players can't search libraries." });
  const beforeLibrary = e.state.players.player.library.length;
  const beforeHand = e.state.players.player.hand.length;
  const result = e.noteLibrarySearch('player', { reason: 'step21-test', filter: 'basic-land', max: 1 });
  assert.equal(result, false);
  e.effects.resolve({ type: 'searchBasic', destination: 'hand' }, { controller: 'player', source: null, targets: [] });
  assert.equal(e.state.players.player.library.length, beforeLibrary);
  assert.equal(e.state.players.player.hand.length, beforeHand);
});

test("Step 21: opponents-can't-gain-life rule applies through the same legality layer", () => {
  const e = engine();
  addPermanent(e, 'player', 'step21-life-lock', { typeLine: 'Enchantment', oracleText: "Your opponents can't gain life." });
  const aiLife = e.state.players.ai.life;
  assert.equal(e.changeLife('ai', 5), 0);
  assert.equal(e.state.players.ai.life, aiLife);
  const playerLife = e.state.players.player.life;
  assert.equal(e.changeLife('player', 3), 3);
  assert.equal(e.state.players.player.life, playerLife + 3);
});

test('Step 21: target restrictions are authoritative for candidate generation and direct validation', () => {
  const e = engine();
  const own = addPermanent(e, 'player', 'step21-own-target', { typeLine: 'Creature — Human', power: 1, toughness: 1 });
  const enemy = addPermanent(e, 'ai', 'step21-enemy-target', { typeLine: 'Creature — Human', power: 1, toughness: 1 });
  e.registerLegalityRule({
    id: 'no-opponent-targets', kind: RULE_KIND.RESTRICTION, operation: LEGALITY_OPERATION.TARGET,
    appliesTo: 'player', filter: { controller: 'opponent' }, message: 'Opponent permanents cannot be targeted.'
  });
  const spec = { kind: 'permanent', type: 'Creature' };
  assert.equal(e.targeting.isLegalTarget('player', own.instanceId, spec), true);
  assert.equal(e.targeting.isLegalTarget('player', enemy.instanceId, spec), false);
  const ids = e.getTargetCandidates('player', { targets: spec }).map(candidate => candidate.id);
  assert.ok(ids.includes(own.instanceId));
  assert.ok(!ids.includes(enemy.instanceId));
});

test('Step 21: once-per-turn activation usage resets on the next turn boundary', () => {
  const e = engine();
  const ability = { type: 'mana', tap: false, mana: { C: 0 } };
  const source = addPermanent(e, 'player', 'step21-ability-source', { typeLine: 'Artifact', abilities: [ability] });
  setPhase(e, 'PRECOMBAT_MAIN', { activePlayer: 'player', priorityPlayer: 'player' });
  e.registerLegalityRule({ id: 'one-activation', kind: RULE_KIND.RESTRICTION, operation: LEGALITY_OPERATION.ACTIVATE_ABILITY, appliesTo: 'player', maxPerTurn: 1, message: 'Only once each turn.' });
  const action = { type: 'ACTIVATE_MANA', permanentId: source.instanceId, ability };
  assert.equal(e.submitAction('player', action).ok, true);
  assert.equal(e.isActionLegal('player', action), false);
  assert.equal(e.legality.usageCount('player', LEGALITY_OPERATION.ACTIVATE_ABILITY), 1);
  e.state.turn += 1;
  e.legality.beginTurn();
  assert.equal(e.legality.usageCount('player', LEGALITY_OPERATION.ACTIVATE_ABILITY), 0);
  assert.equal(e.isActionLegal('player', action), true);
});

test('Step 21: attack-count restrictions reject an illegal declaration before combat state mutates', () => {
  const e = engine();
  const a = addPermanent(e, 'player', 'step21-attacker-a', { typeLine: 'Creature — Soldier', power: 2, toughness: 2 });
  const b = addPermanent(e, 'player', 'step21-attacker-b', { typeLine: 'Creature — Soldier', power: 2, toughness: 2 });
  setPhase(e, 'DECLARE_ATTACKERS', { activePlayer: 'player', priorityPlayer: 'player', turnActionPending: 'DECLARE_ATTACKERS' });
  e.registerLegalityRule({ id: 'one-attacker', kind: RULE_KIND.RESTRICTION, operation: LEGALITY_OPERATION.ATTACK, appliesTo: 'player', maxObjects: 1, message: 'Only one creature may attack.' });
  const result = e.submitAction('player', { type: 'DECLARE_ATTACKERS', attackers: [a.instanceId, b.instanceId], attackTargets: { [a.instanceId]: 'ai', [b.instanceId]: 'ai' } });
  assert.equal(result.ok, false);
  assert.match(result.error.message, /only one creature/i);
  assert.deepEqual(e.state.combat.attackers, []);
  assert.equal(a.tapped, false);
  assert.equal(b.tapped, false);
});

test('Step 21: Ghostly-Prison-style attack requirement verifies and pays the attack cost before declaration', () => {
  const e = engine();
  addPermanent(e, 'ai', 'step21-prison', {
    typeLine: 'Enchantment',
    oracleText: "Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you."
  });
  const attacker = addPermanent(e, 'player', 'step21-taxed-attacker', { typeLine: 'Creature — Soldier', power: 2, toughness: 2 });
  setPhase(e, 'DECLARE_ATTACKERS', { activePlayer: 'player', priorityPlayer: 'player', turnActionPending: 'DECLARE_ATTACKERS' });
  const action = { type: 'DECLARE_ATTACKERS', attackers: [attacker.instanceId], attackTargets: { [attacker.instanceId]: 'ai' } };
  e.state.players.player.manaPool.C = 0;
  const denied = e.submitAction('player', action);
  assert.equal(denied.ok, false);
  assert.match(denied.error.message, /additional attack cost/i);
  assert.equal(attacker.tapped, false);
  assert.deepEqual(e.state.combat.attackers, []);

  e.state.players.player.manaPool.C = 2;
  const allowed = e.submitAction('player', action);
  assert.equal(allowed.ok, true);
  assert.equal(e.state.players.player.manaPool.C, 0);
  assert.deepEqual(e.state.combat.attackers, [attacker.instanceId]);
});

test('Step 21: Back-to-Basics-style untap restriction is enforced by the turn-based untap action', () => {
  const e = engine();
  addPermanent(e, 'ai', 'step21-back-to-basics', { typeLine: 'Enchantment', oracleText: "Nonbasic lands don't untap during their controllers' untap steps." });
  const basic = addPermanent(e, 'player', 'step21-basic-land', { typeLine: 'Basic Land — Island', subtypes: ['Island'] }, { tapped: true });
  const nonbasic = addPermanent(e, 'player', 'step21-nonbasic-land', { typeLine: 'Land', subtypes: [] }, { tapped: true });
  // ZoneService normalizes a newly placed permanent's battlefield state, so
  // establish the pre-untap-step tapped state after placement.
  basic.tapped = true;
  nonbasic.tapped = true;
  e.state.activePlayer = 'player';
  e.state.phase = 'UNTAP';
  e.turn.turnBasedActions.run('UNTAP', e._internalToken());
  assert.equal(basic.tapped, false);
  assert.equal(nonbasic.tapped, true);
});

test('Step 21: AI chooses only from the exact engine legal-action list under restrictions', () => {
  const e = engine();
  const spell = freeSpell(e, 'ai', 'step21-ai-spell');
  setPhase(e, 'PRECOMBAT_MAIN', { activePlayer: 'ai', priorityPlayer: 'ai' });
  e.registerLegalityRule({ id: 'ai-cast-lock', kind: RULE_KIND.RESTRICTION, operation: LEGALITY_OPERATION.CAST, appliesTo: 'ai', message: 'AI cannot cast.' });
  const legal = e.getLegalActions('ai');
  assert.equal(legal.some(action => action.cardInstanceId === spell.instanceId), false);
  const choice = new AIController(e, 'ai').choose();
  assert.ok(choice);
  assert.ok(legal.some(action => JSON.stringify(action) === JSON.stringify(choice)), 'AI must return an engine-advertised legal action');
});

test('Step 21: combat requirements obligate an attacker only when the requirement can legally be satisfied', () => {
  const e = engine();
  const attacker = addPermanent(e, 'player', 'step21-required-attacker', { typeLine: 'Creature — Soldier', power: 2, toughness: 2 });
  setPhase(e, 'DECLARE_ATTACKERS', { activePlayer: 'player', priorityPlayer: 'player', turnActionPending: 'DECLARE_ATTACKERS' });
  e.registerLegalityRule({
    id: 'attack-if-able', kind: RULE_KIND.REQUIREMENT, operation: LEGALITY_OPERATION.ATTACK,
    appliesTo: 'player', minObjects: 1, message: 'At least one creature must attack if able.'
  });

  const denied = e.submitAction('player', { type: 'DECLARE_ATTACKERS', attackers: [], attackTargets: {} });
  assert.equal(denied.ok, false);
  assert.match(denied.error.message, /must attack if able/i);
  assert.deepEqual(e.state.combat.attackers, []);

  attacker.tapped = true;
  const allowed = e.submitAction('player', { type: 'DECLARE_ATTACKERS', attackers: [], attackTargets: {} });
  assert.equal(allowed.ok, true, 'an impossible requirement must not prevent a legal empty declaration');
});

test('Step 21: one-blocker stax restriction is enforced before the blocker declaration mutates combat state', () => {
  const e = engine();
  const attacker = addPermanent(e, 'player', 'step21-block-test-attacker', { typeLine: 'Creature — Soldier', power: 3, toughness: 3 });
  const blockerA = addPermanent(e, 'ai', 'step21-blocker-a', { typeLine: 'Creature — Soldier', power: 1, toughness: 1 });
  const blockerB = addPermanent(e, 'ai', 'step21-blocker-b', { typeLine: 'Creature — Soldier', power: 1, toughness: 1 });
  addPermanent(e, 'player', 'step21-one-blocker-lock', {
    typeLine: 'Enchantment',
    oracleText: 'No more than one creature can block each combat.'
  });

  setPhase(e, 'DECLARE_ATTACKERS', { activePlayer: 'player', priorityPlayer: 'player', turnActionPending: 'DECLARE_ATTACKERS' });
  assert.equal(e.submitAction('player', {
    type: 'DECLARE_ATTACKERS', attackers: [attacker.instanceId], attackTargets: { [attacker.instanceId]: 'ai' }
  }).ok, true);
  e.perform('player', { type: 'PASS_PRIORITY' });
  e.perform('ai', { type: 'PASS_PRIORITY' });
  assert.equal(e.state.turnActionPending, 'DECLARE_BLOCKERS');

  const result = e.submitAction('ai', {
    type: 'DECLARE_BLOCKERS', blockers: { [attacker.instanceId]: [blockerA.instanceId, blockerB.instanceId] }
  });
  assert.equal(result.ok, false);
  assert.match(result.error.message, /one creature can block/i);
  assert.deepEqual(e.state.combat.blockers, {});
});
