import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameState, makeCardInstance } from '../src/engine/GameState.js';
import { ZoneManager } from '../src/engine/ZoneManager.js';
import { db, decks } from './helpers.js';
import {
  GAME_OBJECT_KIND,
  createStackObject,
  createCardFaceModel,
  getObjectCardDefinition,
  setCurrentFace,
  setCastFace,
  validateCanonicalGameState,
  serializeGameState,
  deserializeGameState
} from '../src/engine/state/index.js';

function baseState() {
  const a = decks.find(deck => deck.id === 'explorers');
  const b = decks.find(deck => deck.id === 'blech');
  return createGameState(a, b, db, () => 0.42);
}

test('Step 2: canonical GameState has typed/runtime schema metadata and first-class players/cards', () => {
  const state = baseState();
  assert.equal(state.schemaVersion, 2);
  assert.equal(state.players.player.objectKind, GAME_OBJECT_KIND.PLAYER);
  assert.equal(state.players.player.gameObjectId, 'player:player');

  const card = state.players.player.library[0];
  assert.ok(card.instanceId, 'physical card identity must exist');
  assert.ok(card.gameObjectId, 'current game-object identity must exist');
  assert.equal(card.zoneChangeId, 0);
  assert.equal(card.objectKind, GAME_OBJECT_KIND.CARD);
  assert.ok(Object.isFrozen(card.cardIdentity), 'card identity metadata is immutable');
  assert.ok(Object.isFrozen(card.baseCharacteristics), 'base characteristics are immutable');
  assert.equal(card.cardIdentity.rulesCardId, card.cardId);
  assert.equal(card.baseCharacteristics.cardId, card.cardId);
  assert.deepEqual(validateCanonicalGameState(state), { ok: true, errors: [] });
});

test('Step 2: a zone change creates a new rules object incarnation without changing physical card identity', () => {
  const state = baseState();
  const original = state.players.player.library[0];
  const physicalId = original.instanceId;
  const originalGameObjectId = original.gameObjectId;
  const originalZoneChangeId = original.zoneChangeId;
  const originalOwner = original.owner;

  const moved = ZoneManager.move(state, physicalId, 'hand', 'player', db);
  assert.equal(moved.instanceId, physicalId, 'physical card identity persists');
  assert.notEqual(moved.gameObjectId, originalGameObjectId, 'rules object identity changes');
  assert.equal(moved.previousGameObjectId, originalGameObjectId);
  assert.equal(moved.zoneChangeId, originalZoneChangeId + 1);
  assert.equal(moved.owner, originalOwner);
  assert.equal(moved.controller, originalOwner, 'nonbattlefield controller resets to owner');
  assert.equal(moved.objectKind, GAME_OBJECT_KIND.CARD);
  assert.equal(moved.zone, 'hand');
});

test('Step 2: base characteristics remain separate from temporary derived state', () => {
  const definition = {
    id: 'fixture-bear', name: 'Fixture Bear', typeLine: 'Creature — Bear',
    manaCost: '{1}{G}', manaValue: 2, power: 2, toughness: 2,
    keywords: [], subtypes: ['Bear'], abilities: [], spellEffects: [], colorIdentity: ['G']
  };
  const card = makeCardInstance(definition.id, 'player', 'battlefield', {}, definition);
  const originalBase = structuredClone(card.baseCharacteristics);

  card.counters['+1/+1'] = 3;
  card.modifiers.power = 4;
  card.modifiers.toughness = -1;
  card.tapped = true;

  assert.deepEqual(card.baseCharacteristics, originalBase, 'temporary state must not overwrite printed/base data');
  assert.equal(card.baseCharacteristics.power, 2);
  assert.equal(card.baseCharacteristics.toughness, 2);
});

test('Step 2: transform/modal/split/adventure style face models load through one generic card-face abstraction', () => {
  const layouts = ['transform', 'modal_dfc', 'split', 'adventure', 'aftermath', 'meld', 'prototype', 'battle', 'flip'];
  for (const layout of layouts) {
    const definition = {
      id: `fixture-${layout}`,
      name: `Fixture ${layout}`,
      layout,
      cardFaces: [
        { name: 'Front Face', typeLine: 'Creature — Human', manaCost: '{1}{W}', power: 2, toughness: 2, abilities: [], spellEffects: [] },
        { name: 'Back Face', typeLine: 'Creature — Spirit', manaCost: '', power: 4, toughness: 4, abilities: [], spellEffects: [] }
      ]
    };
    const model = createCardFaceModel(definition);
    assert.equal(model.isMultiFace, true, layout);
    assert.equal(model.faces.length, 2, layout);
    assert.equal(model.faces[0].objectKind, GAME_OBJECT_KIND.CARD_FACE, layout);
    assert.equal(model.faces[1].objectKind, GAME_OBJECT_KIND.CARD_FACE, layout);
  }
});

test('Step 2: active card face follows battlefield/stack/nonbattlefield zone semantics generically', () => {
  const definition = {
    id: 'fixture-dfc',
    name: 'Front // Back',
    layout: 'transform',
    cardFaces: [
      { name: 'Front', typeLine: 'Creature — Human', power: 2, toughness: 2, abilities: [], spellEffects: [] },
      { name: 'Back', typeLine: 'Creature — Werewolf', power: 5, toughness: 5, abilities: [], spellEffects: [] }
    ]
  };
  const card = makeCardInstance(definition.id, 'player', 'battlefield', {}, definition);
  assert.equal(getObjectCardDefinition(definition, card).name, 'Front');

  setCurrentFace(card, definition, 1);
  assert.equal(getObjectCardDefinition(definition, card).name, 'Back');
  assert.equal(card.faceState.transformed, true);

  // A zone change to a graveyard resets normal characteristics to the front face.
  const state = {
    players: {
      player: { id: 'player', battlefield: [card], library: [], hand: [], graveyard: [], exile: [], command: [] }
    },
    stack: []
  };
  ZoneManager.move(state, card.instanceId, 'graveyard', 'player', { [definition.id]: definition });
  assert.equal(getObjectCardDefinition(definition, card).name, 'Front');
  assert.equal(card.faceState.transformed, false);

  // A modal face chosen on the stack stays the active face when it becomes a permanent.
  const modal = makeCardInstance(definition.id, 'player', 'hand', {}, definition);
  setCastFace(modal, definition, 1);
  ZoneManager.prepareForZone(modal, 'stack', 'player', definition);
  assert.equal(getObjectCardDefinition(definition, modal).name, 'Back');
  ZoneManager.prepareForZone(modal, 'battlefield', 'player', definition);
  assert.equal(getObjectCardDefinition(definition, modal).name, 'Back');
});

test('Step 2: stack objects distinguish spells from abilities and carry their own identity', () => {
  const spell = createStackObject({ id: 'spell-1', type: 'spell', controller: 'player' });
  const ability = createStackObject({ id: 'ability-1', type: 'ability', controller: 'player' });
  assert.equal(spell.objectKind, GAME_OBJECT_KIND.SPELL);
  assert.equal(ability.objectKind, GAME_OBJECT_KIND.ABILITY_ON_STACK);
  assert.ok(spell.gameObjectId);
  assert.ok(ability.gameObjectId);
  assert.notEqual(spell.gameObjectId, ability.gameObjectId);
});

test('Step 2: serialized canonical state restores exact object identities and special numeric state', () => {
  const state = baseState();
  const card = state.players.player.library[0];
  ZoneManager.move(state, card.instanceId, 'hand', 'player', db);
  state.players.player.maxHandSize = Infinity;
  const expected = {
    instanceId: card.instanceId,
    gameObjectId: card.gameObjectId,
    previousGameObjectId: card.previousGameObjectId,
    zoneChangeId: card.zoneChangeId
  };

  const encoded = serializeGameState(state);
  const restored = deserializeGameState(encoded, { db });
  const restoredCard = restored.players.player.hand.find(item => item.instanceId === expected.instanceId);
  assert.ok(restoredCard);
  assert.equal(restoredCard.gameObjectId, expected.gameObjectId);
  assert.equal(restoredCard.previousGameObjectId, expected.previousGameObjectId);
  assert.equal(restoredCard.zoneChangeId, expected.zoneChangeId);
  assert.equal(restored.players.player.maxHandSize, Infinity);
  assert.ok(Object.isFrozen(restoredCard.cardIdentity));
  assert.ok(Object.isFrozen(restoredCard.baseCharacteristics));
  assert.deepEqual(validateCanonicalGameState(restored), { ok: true, errors: [] });
});

test('Step 2: GameEngine state save/restore round-trips the authoritative snapshot without losing identities', async () => {
  const { GameEngine } = await import('../src/engine/GameEngine.js');
  const a = decks.find(deck => deck.id === 'explorers');
  const b = decks.find(deck => deck.id === 'blech');
  const game = new GameEngine(a, b, db, { rng: () => 0.42 });
  game.start();
  const before = game.getStateSnapshot();
  const saved = game.serializeState();
  const firstHand = before.players.player.hand[0];

  game.state.players.player.life = 3;
  game.state.players.player.hand[0].gameObjectId = 'corrupted-for-test';
  const restored = game.restoreState(saved);

  assert.equal(restored.players.player.life, before.players.player.life);
  const restoredHand = restored.players.player.hand.find(card => card.instanceId === firstHand.instanceId);
  assert.equal(restoredHand.gameObjectId, firstHand.gameObjectId);
  assert.equal(restoredHand.zoneChangeId, firstHand.zoneChangeId);
  assert.deepEqual(validateCanonicalGameState(game.state), { ok: true, errors: [] });
});
