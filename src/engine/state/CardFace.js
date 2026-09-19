import { deepFreeze } from '../public/immutable.js';

export const CARD_LAYOUT = Object.freeze({
  NORMAL: 'normal',
  TRANSFORM: 'transform',
  MODAL_DFC: 'modal_dfc',
  SPLIT: 'split',
  ADVENTURE: 'adventure',
  AFTERMATH: 'aftermath',
  MELD: 'meld',
  PROTOTYPE: 'prototype',
  BATTLE: 'battle',
  FLIP: 'flip'
});

function normalizeLayout(layout = 'normal') {
  const value = String(layout || 'normal').toLowerCase().replaceAll('-', '_').replaceAll(' ', '_');
  if (value === 'modal_dfc' || value === 'mdfc') return CARD_LAYOUT.MODAL_DFC;
  if (value === 'transform') return CARD_LAYOUT.TRANSFORM;
  if (value === 'split') return CARD_LAYOUT.SPLIT;
  if (value === 'adventure') return CARD_LAYOUT.ADVENTURE;
  if (value === 'aftermath') return CARD_LAYOUT.AFTERMATH;
  if (value === 'meld') return CARD_LAYOUT.MELD;
  if (value === 'prototype') return CARD_LAYOUT.PROTOTYPE;
  if (value === 'battle') return CARD_LAYOUT.BATTLE;
  if (value === 'flip') return CARD_LAYOUT.FLIP;
  return CARD_LAYOUT.NORMAL;
}

function rawFaces(definition = {}) {
  if (Array.isArray(definition.cardFaces)) return definition.cardFaces;
  if (Array.isArray(definition.card_faces)) return definition.card_faces;
  if (Array.isArray(definition.faces)) return definition.faces;
  return [];
}

export function hasMultiFaceDefinition(definition = {}) {
  return rawFaces(definition).length > 1;
}

function faceModelSummary(object, definition = {}) {
  if (hasMultiFaceDefinition(definition)) return createCardFaceModel(definition);
  const faceCount = Math.max(1, Number(object?.baseCharacteristics?.faceCount || 1));
  return { frontFaceIndex: 0, backFaceIndex: faceCount > 1 ? 1 : null, isMultiFace: faceCount > 1, faces: new Array(faceCount) };
}

function faceCharacteristics(face = {}, parent = {}, index = 0) {
  return {
    objectKind: 'card-face',
    faceId: face.faceId || `${parent.id || parent.oracleId || parent.name || 'card'}:face:${index}`,
    faceIndex: index,
    name: face.name || parent.name || '',
    manaCost: face.manaCost ?? face.mana_cost ?? parent.manaCost ?? '',
    manaValue: face.manaValue ?? face.cmc ?? parent.manaValue ?? parent.cmc ?? 0,
    typeLine: face.typeLine ?? face.type_line ?? parent.typeLine ?? '',
    oracleText: face.oracleText ?? face.oracle_text ?? parent.oracleText ?? '',
    colors: structuredClone(face.colors ?? parent.colors ?? []),
    colorIdentity: structuredClone(face.colorIdentity ?? face.color_identity ?? parent.colorIdentity ?? []),
    subtypes: structuredClone(face.subtypes ?? parent.subtypes ?? []),
    keywords: structuredClone(face.keywords ?? parent.keywords ?? []),
    power: face.power ?? parent.power ?? null,
    toughness: face.toughness ?? parent.toughness ?? null,
    loyalty: face.loyalty ?? parent.loyalty ?? null,
    defense: face.defense ?? parent.defense ?? null,
    abilities: structuredClone(face.abilities ?? parent.abilities ?? []),
    spellEffects: structuredClone(face.spellEffects ?? parent.spellEffects ?? []),
    image: face.image ?? face.image_uris?.normal ?? parent.image ?? null,
    artCrop: face.artCrop ?? face.image_uris?.art_crop ?? parent.artCrop ?? null
  };
}

export function createCardFaceModel(definition = {}) {
  const sourceFaces = rawFaces(definition);
  const faces = sourceFaces.length
    ? sourceFaces.map((face, index) => faceCharacteristics(face, definition, index))
    : [faceCharacteristics(definition, definition, 0)];
  const layout = normalizeLayout(definition.layout || (sourceFaces.length > 1 ? 'transform' : 'normal'));
  return deepFreeze({
    layout,
    isMultiFace: faces.length > 1,
    frontFaceIndex: 0,
    backFaceIndex: faces.length > 1 ? 1 : null,
    faces
  });
}

export function createFaceState(definition = {}, options = {}) {
  const model = createCardFaceModel(definition);
  const requested = Number.isInteger(options.currentFaceIndex) ? options.currentFaceIndex : 0;
  const currentFaceIndex = Math.max(0, Math.min(requested, model.faces.length - 1));
  const castFaceIndex = Number.isInteger(options.castFaceIndex)
    ? Math.max(0, Math.min(options.castFaceIndex, model.faces.length - 1))
    : null;
  return {
    currentFaceIndex,
    castFaceIndex,
    transformed: Boolean(options.transformed || currentFaceIndex !== model.frontFaceIndex),
    faceUp: options.faceUp !== false
  };
}

export function resetFaceStateForZone(object, definition = {}, toZone, fromZone = object?.zone) {
  const model = faceModelSummary(object, definition);
  if (!object.faceState) object.faceState = createFaceState(definition);

  // A chosen spell face remains the active permanent face when that spell resolves.
  if (toZone === 'battlefield' && fromZone === 'stack' && Number.isInteger(object.faceState.castFaceIndex)) {
    object.faceState.currentFaceIndex = object.faceState.castFaceIndex;
    object.faceState.transformed = object.faceState.currentFaceIndex !== model.frontFaceIndex;
    object.faceState.castFaceIndex = null;
    object.faceState.faceUp = true;
    return object.faceState;
  }

  if (toZone === 'stack') {
    if (!Number.isInteger(object.faceState.castFaceIndex)) object.faceState.castFaceIndex = object.faceState.currentFaceIndex;
    object.faceState.faceUp = true;
    return object.faceState;
  }

  // In hidden/public non-battlefield zones, a multi-face card normally has its front-face characteristics.
  if (toZone !== 'battlefield') {
    object.faceState.currentFaceIndex = model.frontFaceIndex;
    object.faceState.castFaceIndex = null;
    object.faceState.transformed = false;
  }
  object.faceState.faceUp = !object.faceDown;
  return object.faceState;
}

export function setCurrentFace(object, definition = {}, faceIndex) {
  const model = faceModelSummary(object, definition);
  const index = Number(faceIndex);
  if (!Number.isInteger(index) || index < 0 || index >= model.faces.length) throw new Error('Invalid card face index');
  if (!object.faceState) object.faceState = createFaceState(definition);
  object.faceState.currentFaceIndex = index;
  object.faceState.transformed = index !== model.frontFaceIndex;
  object.faceState.faceUp = true;
  object.faceDown = false;
  return model.faces[index];
}

export function setCastFace(object, definition = {}, faceIndex) {
  const model = faceModelSummary(object, definition);
  const index = Number(faceIndex);
  if (!Number.isInteger(index) || index < 0 || index >= model.faces.length) throw new Error('Invalid cast face index');
  if (!object.faceState) object.faceState = createFaceState(definition);
  object.faceState.castFaceIndex = index;
  return model.faces[index];
}

export function activeFaceIndex(object, definition = {}, zone = object?.zone) {
  const model = faceModelSummary(object, definition);
  if (!model.isMultiFace) return 0;
  if (zone === 'stack' && Number.isInteger(object?.faceState?.castFaceIndex)) return object.faceState.castFaceIndex;
  if (zone === 'battlefield' && Number.isInteger(object?.faceState?.currentFaceIndex)) return object.faceState.currentFaceIndex;
  return model.frontFaceIndex;
}

export function getActiveCardFace(definition = {}, object = {}, zone = object?.zone) {
  const model = createCardFaceModel(definition);
  return model.faces[activeFaceIndex(object, definition, zone)] || model.faces[0];
}

export function getObjectCardDefinition(definition = {}, object = {}, zone = object?.zone) {
  if (!hasMultiFaceDefinition(definition)) return definition;
  const model = createCardFaceModel(definition);
  const face = getActiveCardFace(definition, object, zone);
  return {
    ...definition,
    ...face,
    id: definition.id,
    oracleId: definition.oracleId,
    scryfallId: definition.scryfallId,
    layout: model.layout,
    cardFaces: model.faces
  };
}
