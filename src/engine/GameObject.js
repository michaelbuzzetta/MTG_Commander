import { uid } from './utils.js';
import { deepFreeze } from '../public/immutable.js';
import { createCardFaceModel, createFaceState, resetFaceStateForZone } from './CardFace.js';
import { createStackObject as createCanonicalStackObject } from '../stack/StackObject.js';

export const GAME_OBJECT_KIND = Object.freeze({
  CARD: 'card',
  SPELL: 'spell',
  PERMANENT: 'permanent',
  ABILITY_ON_STACK: 'ability-on-stack',
  TOKEN: 'token',
  EMBLEM: 'emblem',
  CARD_FACE: 'card-face',
  PLAYER: 'player'
});

export function objectKindForZone(card = {}, zone = card.zone) {
  if (zone === 'stack') return GAME_OBJECT_KIND.SPELL;
  if (zone === 'battlefield') return card.isToken ? GAME_OBJECT_KIND.TOKEN : GAME_OBJECT_KIND.PERMANENT;
  return card.isToken ? GAME_OBJECT_KIND.TOKEN : GAME_OBJECT_KIND.CARD;
}

export function createCardIdentity(cardId, definition = {}) {
  return deepFreeze({
    rulesCardId: cardId,
    oracleId: definition.oracleId || definition.oracle_id || null,
    printingId: definition.scryfallId || definition.scryfall_id || null
  });
}

export function createBaseCharacteristics(definition = {}, cardId = definition.id || null) {
  const faceModel = createCardFaceModel(definition);
  const front = faceModel.faces[0];
  return deepFreeze({
    cardId,
    name: front.name || definition.name || cardId || '',
    manaCost: front.manaCost ?? definition.manaCost ?? '',
    manaValue: front.manaValue ?? definition.manaValue ?? 0,
    typeLine: front.typeLine ?? definition.typeLine ?? '',
    oracleText: front.oracleText ?? definition.oracleText ?? '',
    colors: structuredClone(front.colors ?? definition.colors ?? []),
    colorIdentity: structuredClone(front.colorIdentity ?? definition.colorIdentity ?? []),
    subtypes: structuredClone(front.subtypes ?? definition.subtypes ?? []),
    keywords: structuredClone(front.keywords ?? definition.keywords ?? []),
    power: front.power ?? definition.power ?? null,
    toughness: front.toughness ?? definition.toughness ?? null,
    loyalty: front.loyalty ?? definition.loyalty ?? null,
    defense: front.defense ?? definition.defense ?? null,
    layout: faceModel.layout,
    faceCount: faceModel.faces.length
  });
}

export function ensureCanonicalCardObject(card, definition = {}) {
  if (!card || typeof card !== 'object') throw new Error('Card game object must be an object');
  if (!card.instanceId) card.instanceId = uid('card');
  if (!card.gameObjectId) card.gameObjectId = uid('obj');
  if (!Number.isInteger(card.zoneChangeId) || card.zoneChangeId < 0) card.zoneChangeId = 0;
  if (!card.cardIdentity) card.cardIdentity = createCardIdentity(card.cardId, definition);
  else if (!Object.isFrozen(card.cardIdentity)) card.cardIdentity = deepFreeze(structuredClone(card.cardIdentity));
  if (!card.baseCharacteristics) card.baseCharacteristics = createBaseCharacteristics(definition, card.cardId);
  else if (!Object.isFrozen(card.baseCharacteristics)) card.baseCharacteristics = deepFreeze(structuredClone(card.baseCharacteristics));
  if (!card.faceState) card.faceState = createFaceState(definition, { faceUp: !card.faceDown });
  card.objectKind = objectKindForZone(card, card.zone);
  return card;
}

export function beginNewObjectIncarnation(card, toZone, destinationController, definition = {}) {
  ensureCanonicalCardObject(card, definition);
  const fromZone = card.zone;
  card.previousGameObjectId = card.gameObjectId;
  card.gameObjectId = uid('obj');
  card.zoneChangeId += 1;
  card.zone = toZone;
  if (toZone === 'battlefield' || toZone === 'stack') card.controller = destinationController ?? card.controller ?? card.owner;
  else card.controller = card.owner;
  card.objectKind = objectKindForZone(card, toZone);
  resetFaceStateForZone(card, definition, toZone, fromZone);
  // Step 22: a permanent copy effect belongs to that battlefield object. A
  // zone change away from the battlefield creates a new object and ends it.
  // A copied permanent spell may carry its copied values from stack to the
  // battlefield so the resulting token has the correct copiable values.
  if (fromZone === 'battlefield' && toZone !== 'battlefield') delete card.copyState;
  return card;
}

export function createStackObject(fields = {}) {
  return createCanonicalStackObject(fields);
}

export function createPlayerObject(id, fields = {}) {
  return {
    objectKind: GAME_OBJECT_KIND.PLAYER,
    gameObjectId: `player:${id}`,
    ...fields,
    id
  };
}
