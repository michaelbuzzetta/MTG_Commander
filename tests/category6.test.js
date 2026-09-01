import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCardInstance } from '../src/engine/GameState.js';
import { AIController } from '../src/ai/AIController.js';
import { engine, putBattlefield, setPhase } from './helpers.js';

function putHand(e, pid, cardId) {
  const card = makeCardInstance(cardId, pid, 'hand');
  e.state.players[pid].hand.push(card);
  return card;
}

function giveMana(e, pid, mana) {
  Object.assign(e.state.players[pid].manaPool, { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, ...mana });
}

function passToResolve(e) {
  const first = e.state.priorityPlayer;
  e.perform(first, { type: 'PASS_PRIORITY' });
  e.perform(e.state.priorityPlayer, { type: 'PASS_PRIORITY' });
}

test('Category 6 BUG-028: Murder requires an explicit legal creature target and stores it on the stack', () => {
  const e = engine();
  setPhase(e, 'PRECOMBAT_MAIN');
  const murder = putHand(e, 'player', 'murder');
  giveMana(e, 'player', { B: 3 });

  assert.equal(e.getLegalActions('player').some(action => action.cardInstanceId === murder.instanceId), false);
  assert.throws(() => e.perform('player', { type: 'CAST_SPELL', cardInstanceId: murder.instanceId }), /target/i);

  const own = putBattlefield(e, 'player', 'grizzly-bears');
  const enemy = putBattlefield(e, 'ai', 'grizzly-bears');
  const casts = e.getLegalActions('player').filter(action => action.cardInstanceId === murder.instanceId);
  assert.deepEqual(new Set(casts.map(action => action.targets[0])), new Set([own.instanceId, enemy.instanceId]));
  assert.ok(casts.every(action => action.targets.length === 1));

  e.perform('player', casts.find(action => action.targets[0] === enemy.instanceId));
  assert.deepEqual(e.state.stack.find(item => item.card?.instanceId === murder.instanceId)?.targets, [enemy.instanceId]);
  passToResolve(e);

  assert.equal(e.findPermanent(enemy.instanceId), null);
  assert.ok(e.findPermanent(own.instanceId), 'Murder did not auto-select a different creature');
});

test('Category 6 BUG-028: Lightning Bolt can target either player, a creature, or a planeswalker', () => {
  const e = engine();
  setPhase(e, 'PRECOMBAT_MAIN');
  const bolt = putHand(e, 'player', 'lightning-bolt');
  const own = putBattlefield(e, 'player', 'grizzly-bears');
  const enemy = putBattlefield(e, 'ai', 'grizzly-bears');
  e.db['test-walker'] = { id: 'test-walker', name: 'Test Walker', typeLine: 'Planeswalker', keywords: [], abilities: [], spellEffects: [] };
  const walker = putBattlefield(e, 'ai', 'test-walker');
  giveMana(e, 'player', { R: 1 });

  const targets = new Set(e.getLegalActions('player')
    .filter(action => action.cardInstanceId === bolt.instanceId)
    .map(action => action.targets[0]));
  assert.deepEqual(targets, new Set(['player', 'ai', own.instanceId, enemy.instanceId, walker.instanceId]));

  e.perform('player', { type: 'CAST_SPELL', cardInstanceId: bolt.instanceId, targets: ['player'] });
  passToResolve(e);
  assert.equal(e.state.players.player.life, 37);
});

test('Category 6 BUG-028: targeted activated abilities use the same validator and preserve chosen targets', () => {
  const e = engine();
  setPhase(e, 'PRECOMBAT_MAIN');
  const ability = {
    type: 'activated',
    targets: { kind: 'permanent', type: 'Creature' },
    effect: { type: 'pump', power: 1, toughness: 0 }
  };
  e.db['target-mage'] = { id: 'target-mage', name: 'Target Mage', typeLine: 'Creature — Wizard', power: 1, toughness: 1, keywords: [], abilities: [ability], spellEffects: [] };
  const mage = putBattlefield(e, 'player', 'target-mage');
  const target = putBattlefield(e, 'ai', 'grizzly-bears');

  const action = e.getLegalActions('player').find(a => a.type === 'ACTIVATE_ABILITY' && a.permanentId === mage.instanceId && a.targets?.[0] === target.instanceId);
  assert.ok(action);
  e.perform('player', action);
  const stackItem = e.state.stack.at(-1);
  assert.deepEqual(stackItem.targets, [target.instanceId]);
  assert.deepEqual(stackItem.ability.targets, ability.targets);

  passToResolve(e);
  assert.equal(target.modifiers.power, 1);
});

test('Category 6 BUG-029: hexproof blocks opposing targets but not the permanent controller’s own targets', () => {
  const e = engine();
  setPhase(e, 'PRECOMBAT_MAIN');
  e.db['hex-bear'] = { id: 'hex-bear', name: 'Hex Bear', typeLine: 'Creature — Bear', power: 2, toughness: 2, keywords: ['hexproof'], abilities: [], spellEffects: [] };
  const hostileHex = putBattlefield(e, 'ai', 'hex-bear');
  const friendlyHex = putBattlefield(e, 'player', 'hex-bear');
  const murder = putHand(e, 'player', 'murder');
  giveMana(e, 'player', { B: 3 });

  const casts = e.getLegalActions('player').filter(action => action.cardInstanceId === murder.instanceId);
  const targetIds = casts.map(action => action.targets[0]);
  assert.equal(targetIds.includes(hostileHex.instanceId), false);
  assert.equal(targetIds.includes(friendlyHex.instanceId), true);
  assert.throws(() => e.perform('player', { type: 'CAST_SPELL', cardInstanceId: murder.instanceId, targets: [hostileHex.instanceId] }), /hexproof/i);
  assert.equal(e.state.players.player.manaPool.B, 3, 'illegal targeting is rejected before costs are paid');
});

test('Category 6 BUG-029: ward creates a payment decision and counters the targeting spell when declined', () => {
  const e = engine();
  setPhase(e, 'PRECOMBAT_MAIN');
  e.db['ward-bear'] = { id: 'ward-bear', name: 'Ward Bear', typeLine: 'Creature — Bear', power: 2, toughness: 2, keywords: ['ward {2}'], abilities: [], spellEffects: [] };
  const warded = putBattlefield(e, 'ai', 'ward-bear');
  const murder = putHand(e, 'player', 'murder');
  giveMana(e, 'player', { B: 5 });

  e.perform('player', { type: 'CAST_SPELL', cardInstanceId: murder.instanceId, targets: [warded.instanceId] });
  assert.deepEqual(e.state.stack.map(item => item.type), ['spell', 'ward']);
  passToResolve(e);

  assert.equal(e.state.pendingChoice?.type, 'WARD_PAYMENT');
  assert.equal(e.state.pendingChoice?.playerId, 'player');
  assert.deepEqual(e.state.pendingChoice?.cost, { mana: '{2}', life: 0 });
  assert.deepEqual(new Set(e.getLegalActions('player').map(action => action.type)), new Set(['PAY_WARD', 'DECLINE_WARD']));

  e.perform('player', { type: 'DECLINE_WARD' });
  assert.equal(e.state.stack.some(item => item.card?.instanceId === murder.instanceId), false);
  assert.ok(e.state.players.player.graveyard.some(card => card.instanceId === murder.instanceId));
  assert.ok(e.findPermanent(warded.instanceId));
});

test('Category 6 BUG-029: paying ward leaves the original spell on the stack to resolve normally', () => {
  const e = engine();
  setPhase(e, 'PRECOMBAT_MAIN');
  e.db['ward-bear'] = { id: 'ward-bear', name: 'Ward Bear', typeLine: 'Creature — Bear', power: 2, toughness: 2, keywords: ['ward {2}'], abilities: [], spellEffects: [] };
  const warded = putBattlefield(e, 'ai', 'ward-bear');
  const murder = putHand(e, 'player', 'murder');
  giveMana(e, 'player', { B: 5 });

  e.perform('player', { type: 'CAST_SPELL', cardInstanceId: murder.instanceId, targets: [warded.instanceId] });
  assert.equal(e.state.players.player.manaPool.B, 2);
  passToResolve(e);
  e.perform('player', { type: 'PAY_WARD' });

  assert.equal(e.state.players.player.manaPool.B, 0);
  assert.ok(e.state.stack.some(item => item.card?.instanceId === murder.instanceId));
  passToResolve(e);
  assert.equal(e.findPermanent(warded.instanceId), null);
});

test('Category 6 stack rules: a target that becomes illegal before resolution is not replaced by another target', () => {
  const e = engine();
  setPhase(e, 'PRECOMBAT_MAIN');
  const first = putBattlefield(e, 'ai', 'grizzly-bears');
  const second = putBattlefield(e, 'ai', 'grizzly-bears');
  const murder = putHand(e, 'player', 'murder');
  giveMana(e, 'player', { B: 3 });

  e.perform('player', { type: 'CAST_SPELL', cardInstanceId: murder.instanceId, targets: [first.instanceId] });
  first.modifiers.keywords.push('hexproof');
  passToResolve(e);

  assert.ok(e.findPermanent(first.instanceId));
  assert.ok(e.findPermanent(second.instanceId));
  assert.ok(e.state.players.player.graveyard.some(card => card.instanceId === murder.instanceId));
  assert.ok(e.state.history.some(entry => entry.type === 'COUNTERED_ON_RESOLUTION' && entry.stackItemId === `spell-${murder.instanceId}`));
});

test('Category 6 stack rules: multi-target objects affect only targets that remain legal', () => {
  const e = engine();
  setPhase(e, 'PRECOMBAT_MAIN');
  e.db['twin-ping'] = {
    id: 'twin-ping', name: 'Twin Ping', typeLine: 'Instant', manaCost: '', keywords: [], abilities: [],
    targets: { kind: 'permanent', type: 'Creature' }, minTargets: 2, maxTargets: 2,
    spellEffects: [{ type: 'damage', amount: 1 }]
  };
  const spell = putHand(e, 'player', 'twin-ping');
  const first = putBattlefield(e, 'ai', 'grizzly-bears');
  const second = putBattlefield(e, 'ai', 'grizzly-bears');

  e.perform('player', { type: 'CAST_SPELL', cardInstanceId: spell.instanceId, targets: [first.instanceId, second.instanceId] });
  first.modifiers.keywords.push('hexproof');
  passToResolve(e);

  assert.equal(first.damageMarked, 0);
  assert.equal(second.damageMarked, 1);
  assert.ok(e.state.players.player.graveyard.some(card => card.instanceId === spell.instanceId));
});


test('Category 6 AI: generated targeted actions already contain legal chosen targets', () => {
  const e = engine();
  setPhase(e, 'PRECOMBAT_MAIN', { activePlayer: 'ai', priorityPlayer: 'ai' });
  e.state.players.ai.hand = [];
  const murder = putHand(e, 'ai', 'murder');
  const target = putBattlefield(e, 'player', 'grizzly-bears');
  giveMana(e, 'ai', { B: 3 });

  const action = new AIController(e, 'ai').choose();
  assert.equal(action?.type, 'CAST_SPELL');
  assert.equal(action?.cardInstanceId, murder.instanceId);
  assert.deepEqual(action?.targets, [target.instanceId]);
  assert.equal(e.isActionLegal('ai', action), true);
});

test('Category 6 targeting engine: shared predicates cover card-in-zone targets and shroud', () => {
  const e = engine();
  setPhase(e, 'PRECOMBAT_MAIN');

  const graveCreature = makeCardInstance('grizzly-bears', 'ai', 'graveyard');
  e.state.players.ai.graveyard.push(graveCreature);
  const graveSource = { targets: { kind: 'card', zone: 'graveyard', type: 'Creature', owner: 'opponent' } };
  const graveCandidates = e.targeting.getCandidates('player', graveSource);
  assert.deepEqual(graveCandidates.map(candidate => candidate.id), [graveCreature.instanceId]);
  assert.equal(e.targeting.validateTargets('player', graveSource, [graveCreature.instanceId]), true);

  e.db['shroud-bear'] = { id: 'shroud-bear', name: 'Shroud Bear', typeLine: 'Creature — Bear', power: 2, toughness: 2, keywords: ['shroud'], abilities: [], spellEffects: [] };
  const shrouded = putBattlefield(e, 'player', 'shroud-bear');
  const creatureSource = { targets: { kind: 'permanent', type: 'Creature' } };
  assert.equal(e.targeting.getCandidates('player', creatureSource).some(candidate => candidate.id === shrouded.instanceId), false);
  assert.throws(() => e.targeting.validateTargets('player', creatureSource, [shrouded.instanceId]), /shroud/i);
});
