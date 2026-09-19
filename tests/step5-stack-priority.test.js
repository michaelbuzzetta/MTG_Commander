import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../src/engine/GameEngine.js';
import { makeCardInstance } from '../src/engine/GameState.js';
import { createStackObject, validateStackObject, buildStackPriorityView } from '../src/engine/stack/index.js';
import { humanAutomationDecision } from '../src/utils/turnAutomation.js';
import db from '../src/data/generated/cards.json' with { type: 'json' };
import decks from '../src/data/generated/decks.json' with { type: 'json' };
import { engine, putBattlefield, setPhase } from './helpers.js';

function multiplayerEngine(count = 4) {
  const playable = decks.filter(deck => deck.playable !== false).slice(0, count);
  const e = new GameEngine(playable[0], playable.slice(1), db, { rng: () => 0.42 });
  e.start();
  for (const id of e.state.playerOrder) e.perform(id, { type: 'KEEP_HAND' });
  return e;
}

function registerInstant(e, pid, id, {
  spellEffects = [{ type: 'gainLife', amount: 1 }],
  targets = null,
  modes = null
} = {}) {
  const definition = {
    id,
    name: id,
    typeLine: 'Instant',
    manaCost: '',
    manaValue: 0,
    colorIdentity: [],
    subtypes: [],
    keywords: [],
    abilities: [],
    spellEffects,
    ...(targets ? { targets } : {}),
    ...(modes ? { modes } : {}),
    oracleText: 'Step 5 test card.',
    supported: true
  };
  e._registerRuntimeCardDefinition(id, definition);
  const card = makeCardInstance(id, pid, 'hand', {}, definition);
  e.state.players[pid].hand.push(card);
  return card;
}

function passAllTwoPlayer(e, first = e.state.priorityPlayer) {
  const second = e.nextPriorityPlayer(first);
  e.perform(first, { type: 'PASS_PRIORITY' });
  e.perform(second, { type: 'PASS_PRIORITY' });
}

test('Step 5: StackObject schema records modes, targets, X, divisions, costs, and copy metadata', () => {
  const item = createStackObject({
    type: 'spell',
    controller: 'player',
    card: { instanceId: 'card-a', cardId: 'test', owner: 'player', controller: 'player', zone: 'stack' },
    selectedModes: ['first', 'second'],
    targets: ['ai', 'perm-1'],
    xValue: 5,
    divided: { ai: 3, 'perm-1': 2 },
    additionalCosts: [{ type: 'discard', count: 1 }],
    alternativeCost: { mana: '{2}{U}' },
    isCopy: true,
    copyMetadata: { copiedFromStackObjectId: 'spell-original', retargetAllowed: true }
  });
  assert.equal(validateStackObject(item).ok, true);
  assert.deepEqual(item.selectedModes, ['first', 'second']);
  assert.equal(item.xValue, 5);
  assert.deepEqual(item.divided, { ai: 3, 'perm-1': 2 });
  assert.equal(item.copyMetadata.copiedFromStackObjectId, 'spell-original');
  assert.equal(item.copyMetadata.retargetAllowed, true);
  assert.equal(item.objectKind, 'spell');
});

test('Step 5: stack and priority snapshots expose a deterministic visual harness without mutating state', () => {
  const e = engine();
  setPhase(e, 'UPKEEP', { activePlayer: 'player', priorityPlayer: 'player' });
  const source = putBattlefield(e, 'player', 'grizzly-bears');
  e.stack.push({ type: 'ability', controller: 'player', source, effect: { type: 'gainLife', amount: 1 }, targets: [] });
  const view = buildStackPriorityView(e);
  assert.equal(view.stackDepth, 1);
  assert.equal(view.priorityPlayer, 'player');
  assert.equal(view.topStackObjectId, e.state.stack[0].id);
  const publicStack = e.getStackSnapshot();
  assert.throws(() => publicStack[0].targets.push('tamper'), /extensible|read only|frozen/i);
  assert.deepEqual(e.state.stack[0].targets, []);
  assert.equal(e.getPrioritySnapshot().consecutivePasses, 0);
});

test('Step 5: four-player pass cycle resolves the top object only after every living player passes', () => {
  const e = multiplayerEngine(4);
  setPhase(e, 'UPKEEP', { activePlayer: 'player', priorityPlayer: 'player' });
  const source = putBattlefield(e, 'player', 'grizzly-bears');
  e.stack.push({ type: 'ability', controller: 'player', source, effect: { type: 'gainLife', amount: 1 }, targets: [] });
  const life = e.state.players.player.life;

  for (const id of ['player', 'ai', 'ai2']) {
    e.perform(id, { type: 'PASS_PRIORITY' });
    assert.equal(e.state.stack.length, 1);
    assert.equal(e.state.players.player.life, life);
  }
  e.perform('ai3', { type: 'PASS_PRIORITY' });
  assert.equal(e.state.stack.length, 0);
  assert.equal(e.state.players.player.life, life + 1);
  assert.equal(e.state.priorityPlayer, 'player');
});

test('Step 5: any legal action resets consecutive-pass tracking', () => {
  const e = multiplayerEngine(4);
  setPhase(e, 'UPKEEP', { activePlayer: 'player', priorityPlayer: 'player' });
  e.perform('player', { type: 'PASS_PRIORITY' });
  e.perform('ai', { type: 'PASS_PRIORITY' });
  assert.equal(e.state.passes, 2);
  assert.equal(e.state.priorityPlayer, 'ai2');

  const forest = putBattlefield(e, 'ai2', 'forest');
  const ability = e.db.forest.abilities[0];
  e.perform('ai2', { type: 'ACTIVATE_MANA', permanentId: forest.instanceId, ability });
  assert.equal(e.state.passes, 0);
  assert.equal(e.state.priorityPlayer, 'ai2');
});

test('Step 5: mana abilities bypass the stack while nonmana activated abilities use it', () => {
  const e = engine();
  setPhase(e, 'UPKEEP', { activePlayer: 'player', priorityPlayer: 'player' });
  const forest = putBattlefield(e, 'player', 'forest');
  e.perform('player', { type: 'ACTIVATE_MANA', permanentId: forest.instanceId, ability: e.db.forest.abilities[0] });
  assert.equal(e.state.stack.length, 0);
  assert.equal(e.state.players.player.manaPool.G, 1);

  e._registerRuntimeCardDefinition('step5-ability-source', {
    id: 'step5-ability-source', name: 'Ability Source', typeLine: 'Creature', manaCost: '', manaValue: 0,
    power: 1, toughness: 1, colorIdentity: [], subtypes: [], keywords: [], spellEffects: [],
    abilities: [{ type: 'activated', effect: { type: 'gainLife', amount: 1 } }]
  });
  const source = putBattlefield(e, 'player', 'step5-ability-source');
  const ability = e.db['step5-ability-source'].abilities[0];
  e.perform('player', { type: 'ACTIVATE_ABILITY', permanentId: source.instanceId, ability });
  assert.equal(e.state.stack.length, 1);
  assert.equal(e.state.stack[0].type, 'ability');
});

test('Step 5: a player can retain priority and put multiple instant spells on the stack before passing', () => {
  const e = engine();
  const one = registerInstant(e, 'player', 'step5-retain-one');
  const two = registerInstant(e, 'player', 'step5-retain-two');
  setPhase(e, 'UPKEEP', { activePlayer: 'ai', priorityPlayer: 'player' });

  e.perform('player', { type: 'CAST_SPELL', cardInstanceId: one.instanceId, targets: [] });
  assert.equal(e.state.priorityPlayer, 'player');
  e.perform('player', { type: 'CAST_SPELL', cardInstanceId: two.instanceId, targets: [] });
  assert.equal(e.state.priorityPlayer, 'player');
  assert.equal(e.state.stack.length, 2);
  assert.equal(e.state.stack.at(-1).card.instanceId, two.instanceId);
});

test('Step 5: nested responses resolve in strict LIFO order', () => {
  const e = engine();
  const a = registerInstant(e, 'player', 'step5-response-a', {
    spellEffects: [{ type: 'damage', amount: 1 }],
    targets: { kind: 'player', controller: 'opponent' }
  });
  const b = registerInstant(e, 'ai', 'step5-response-b', {
    spellEffects: [{ type: 'damage', amount: 1 }],
    targets: { kind: 'player', controller: 'opponent' }
  });
  setPhase(e, 'PRECOMBAT_MAIN', { activePlayer: 'player', priorityPlayer: 'player' });

  e.perform('player', { type: 'CAST_SPELL', cardInstanceId: a.instanceId, targets: ['ai'] });
  e.perform('player', { type: 'PASS_PRIORITY' });
  e.perform('ai', { type: 'CAST_SPELL', cardInstanceId: b.instanceId, targets: ['player'] });
  assert.equal(e.state.stack.length, 2);

  e.perform('ai', { type: 'PASS_PRIORITY' });
  e.perform('player', { type: 'PASS_PRIORITY' });
  assert.equal(e.state.players.player.life, 39, 'response on top resolves first');
  assert.equal(e.state.players.ai.life, 40);
  assert.equal(e.state.stack.length, 1);

  e.perform('player', { type: 'PASS_PRIORITY' });
  e.perform('ai', { type: 'PASS_PRIORITY' });
  assert.equal(e.state.players.ai.life, 39, 'original spell resolves second');
  assert.equal(e.state.stack.length, 0);
});

test('Step 5: a spell with all targets illegal is countered by the rules on resolution and moves to graveyard', () => {
  const e = engine();
  const removal = registerInstant(e, 'player', 'step5-all-illegal', {
    spellEffects: [{ type: 'destroy' }],
    targets: { kind: 'permanent', type: 'Creature', controller: 'opponent' }
  });
  const target = putBattlefield(e, 'ai', 'grizzly-bears');
  setPhase(e, 'PRECOMBAT_MAIN', { activePlayer: 'player', priorityPlayer: 'player' });
  e.perform('player', { type: 'CAST_SPELL', cardInstanceId: removal.instanceId, targets: [target.instanceId] });
  e.moveToZone(target, 'graveyard', target.owner);
  passAllTwoPlayer(e, 'player');

  assert.equal(e.state.stack.length, 0);
  assert.ok(e.state.players.player.graveyard.some(card => card.instanceId === removal.instanceId));
  assert.ok(e.state.history.some(entry => entry.type === 'COUNTERED_ON_RESOLUTION' && entry.stackItemId));
});

test('Step 5: partial resolution ignores only illegal targets and continues with the remaining legal targets', () => {
  const e = engine();
  const removal = registerInstant(e, 'player', 'step5-partial-targets', {
    spellEffects: [{ type: 'destroy' }],
    targets: [
      { kind: 'permanent', type: 'Creature', controller: 'opponent' },
      { kind: 'permanent', type: 'Creature', controller: 'opponent' }
    ]
  });
  const first = putBattlefield(e, 'ai', 'grizzly-bears');
  const second = putBattlefield(e, 'ai', 'grizzly-bears');
  setPhase(e, 'PRECOMBAT_MAIN', { activePlayer: 'player', priorityPlayer: 'player' });
  e.perform('player', { type: 'CAST_SPELL', cardInstanceId: removal.instanceId, targets: [first.instanceId, second.instanceId] });
  e.moveToZone(first, 'graveyard', first.owner);
  passAllTwoPlayer(e, 'player');

  assert.equal(e.findPermanent(second.instanceId), null);
  assert.ok(e.state.players.ai.graveyard.some(card => card.instanceId === second.instanceId));
  assert.ok(e.state.history.some(entry => entry.type === 'PARTIAL_TARGET_RESOLUTION'));
});

test('Step 5: resolution is transactional and restores the stack/state if effect execution throws', () => {
  const e = engine();
  setPhase(e, 'UPKEEP', { activePlayer: 'player', priorityPlayer: 'player' });
  const source = putBattlefield(e, 'player', 'grizzly-bears');
  const item = e.stack.push({ type: 'ability', controller: 'player', source, effect: { type: 'gainLife', amount: 1 }, targets: [] });
  const beforeLife = e.state.players.player.life;
  const originalResolve = e.effects.resolve.bind(e.effects);
  e.effects.resolve = () => {
    e.state.players.player.life += 99;
    throw new Error('synthetic resolution failure');
  };

  e.perform('player', { type: 'PASS_PRIORITY' });
  assert.throws(() => e.perform('ai', { type: 'PASS_PRIORITY' }), /synthetic resolution failure/);
  e.effects.resolve = originalResolve;

  assert.equal(e.state.players.player.life, beforeLife);
  assert.equal(e.state.stack.length, 1);
  assert.equal(e.state.stack[0].id, item.id);
  assert.equal(e.state.priorityPlayer, 'ai');
  assert.equal(e.state.passes, 1, 'the successful earlier pass is preserved for a retry');
});

test('Step 5: AI-turn automation preserves real priority and pauses only for a meaningful human stack response', () => {
  const e = engine();
  setPhase(e, 'UPKEEP', { activePlayer: 'ai', priorityPlayer: 'player' });
  const source = putBattlefield(e, 'ai', 'grizzly-bears');
  e.stack.push({ type: 'ability', controller: 'ai', source, effect: { type: 'gainLife', amount: 1 }, targets: [] });
  let decision = humanAutomationDecision(e, { playerId: 'player', autoPass: true });
  assert.equal(decision.mode, 'AUTO_PASS');
  assert.equal(e.state.priorityPlayer, 'player', 'automation decision itself does not skip authoritative priority');

  const response = registerInstant(e, 'player', 'step5-human-response', {
    spellEffects: [{ type: 'damage', amount: 1 }],
    targets: { kind: 'player', controller: 'opponent' }
  });
  assert.ok(response);
  decision = humanAutomationDecision(e, { playerId: 'player', autoPass: true });
  assert.equal(decision.mode, 'PAUSE');
  assert.equal(decision.kind, 'stack-response');
  assert.ok(decision.actions.some(action => action.cardInstanceId === response.instanceId));
});

test('Step 5: countering a spell copy removes only the copy and never moves it to a physical zone', () => {
  const e = engine();
  const original = registerInstant(e, 'player', 'step5-counter-copy');
  setPhase(e, 'UPKEEP', { activePlayer: 'player', priorityPlayer: 'player' });

  e.perform('player', { type: 'CAST_SPELL', cardInstanceId: original.instanceId, targets: [] });
  const originalItem = e.state.stack.at(-1);
  e.effects.queueSpellCopies(originalItem, 1, 'player');
  const copyItem = e.state.stack.at(-1);
  assert.equal(copyItem.isCopy, true);
  assert.equal(e.state.stack.length, 2);

  e.effects.resolve({ type: 'counterSpell' }, {
    controller: 'ai',
    source: null,
    targets: [copyItem.gameObjectId],
    targeted: true
  });

  assert.equal(e.state.stack.length, 1);
  assert.equal(e.state.stack[0].id, originalItem.id, 'the original spell remains on the stack');
  assert.equal(
    e.state.players.player.graveyard.some(card => card.instanceId === copyItem.card.instanceId),
    false,
    'a spell copy never becomes a physical graveyard card'
  );
});

test('Step 5: priority skips an active player eliminated during stack resolution', () => {
  const e = multiplayerEngine(4);
  setPhase(e, 'UPKEEP', { activePlayer: 'player', priorityPlayer: 'player' });
  const source = putBattlefield(e, 'ai', 'grizzly-bears');
  e.stack.push({
    type: 'ability',
    controller: 'ai',
    source,
    effect: { type: 'damagePlayer', amount: 50, targetPlayer: 'player' },
    targets: []
  });

  for (const id of ['player', 'ai', 'ai2', 'ai3']) e.perform(id, { type: 'PASS_PRIORITY' });

  assert.equal(e.state.players.player.lost, true);
  assert.equal(e.state.priorityPlayer, 'ai', 'the next living player receives priority when the active player has left the game');
});
