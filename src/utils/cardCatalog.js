import { normalizeCardName, normalizeFetchedCard } from './deckImport.js';

const DEV_ENDPOINT = '/api/card-catalog';
const STATIC_ENDPOINT = '/data/scryfall-card-catalog.json';

export async function loadCardCatalog(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('Card catalog loading is unavailable in this browser.');
  let lastError = null;
  for (const url of [DEV_ENDPOINT, STATIC_ENDPOINT]) {
    try {
      const response = await fetchImpl(`${url}?v=${Date.now()}`, { cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload || !Array.isArray(payload.cards)) throw new Error('Invalid card catalog payload.');
      if (payload.cards.length < 10000 || payload.complete !== true) throw new Error(`Incomplete card catalog (${payload.cards.length} cards).`);
      return payload;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Could not load the card catalog. ${lastError?.message || ''}`.trim());
}

export function mergeBuilderDatabase(runtimeDb = {}, catalogCards = []) {
  const merged = {};
  const catalogNameToId = new Map();

  for (const def of catalogCards || []) {
    if (!def?.id || !def?.name) continue;
    merged[def.id] = def;
    for (const name of [def.name, ...(def.aliases || [])]) {
      const key = normalizeCardName(name);
      if (key && !catalogNameToId.has(key)) catalogNameToId.set(key, def.id);
    }
  }

  // Hand-authored and already-imported runtime definitions always win over the
  // generic catalog record for the same card name.
  for (const [id, def] of Object.entries(runtimeDb || {})) {
    if (!def?.name) continue;
    const duplicateCatalogIds = new Set();
    for (const name of [def.name, ...(def.aliases || [])]) {
      const duplicate = catalogNameToId.get(normalizeCardName(name));
      if (duplicate) duplicateCatalogIds.add(duplicate);
    }
    for (const duplicate of duplicateCatalogIds) delete merged[duplicate];
    merged[id] = def;
  }

  return merged;
}

function catalogToScryfallShape(def) {
  const faceData = Array.isArray(def.cardFaces) ? def.cardFaces : [];
  const cardFaces = faceData.length ? faceData.map(face => ({
    name: face.name,
    mana_cost: face.manaCost || '',
    type_line: face.typeLine || '',
    oracle_text: face.oracleText || '',
    power: face.power == null ? null : String(face.power),
    toughness: face.toughness == null ? null : String(face.toughness),
    loyalty: face.loyalty == null ? null : String(face.loyalty),
    defense: face.defense == null ? null : String(face.defense),
    colors: face.colors || [],
    image_uris: face.image ? { normal: face.image, small: face.imageSmall || face.image, art_crop: face.artCrop || '' } : undefined
  })) : undefined;

  return {
    id: def.scryfallId || String(def.id || '').replace(/^catalog-/, ''),
    oracle_id: def.oracleId || null,
    name: def.name,
    layout: def.layout || 'normal',
    type_line: def.typeLine || '',
    mana_cost: def.manaCost || '',
    cmc: Number(def.manaValue || 0),
    oracle_text: def.oracleText || '',
    power: def.power == null ? null : String(def.power),
    toughness: def.toughness == null ? null : String(def.toughness),
    loyalty: def.loyalty == null ? null : String(def.loyalty),
    defense: def.defense == null ? null : String(def.defense),
    colors: def.colors || [],
    color_identity: def.colorIdentity || [],
    keywords: def.keywords || [],
    legalities: def.legalities || {},
    image_uris: def.image ? { normal: def.image, small: def.imageSmall || def.image, art_crop: def.artCrop || '' } : undefined,
    card_faces: cardFaces
  };
}

export function promoteCatalogCard(def, { allowApproximation = false } = {}) {
  if (!def || def.supported !== false || !def.catalogCard) return def || null;

  // Production/strict paths must never convert descriptive catalog metadata into
  // executable rules. A catalog-only card stays unsupported until a certified
  // runtime implementation exists. Heuristic parsing is available only through
  // an explicit sandbox opt-in and is always marked ineligible for certification.
  if (!allowApproximation) {
    return {
      ...def,
      supported: false,
      certificationEligible: false,
      unsupportedReason: def.unsupportedReason || 'No certified runtime implementation exists for this Oracle identity.'
    };
  }

  const promoted = normalizeFetchedCard(catalogToScryfallShape(def), def.name, { allowApproximation: true });
  return {
    ...promoted,
    source: 'Scryfall full catalog → explicit sandbox heuristic approximation',
    catalogOriginId: def.id,
    catalogCard: true,
    supported: true,
    approximateRules: true,
    sandboxApproximation: true,
    certificationEligible: false
  };
}

export function promoteCatalogDefinitions(definitions = [], options = {}) {
  const promoted = {};
  for (const def of definitions) {
    if (!def?.catalogCard || def.supported !== false) continue;
    const runtime = promoteCatalogCard(def, options);
    if (runtime?.id) promoted[runtime.id] = runtime;
  }
  return promoted;
}

export function promoteCatalogNames(names = [], builderDb = {}, options = {}) {
  const wanted = new Set(names.map(normalizeCardName).filter(Boolean));
  const definitions = [];
  for (const def of Object.values(builderDb || {})) {
    if (!def?.catalogCard || def.supported !== false) continue;
    const aliases = [def.name, ...(def.aliases || [])].map(normalizeCardName);
    if (aliases.some(alias => wanted.has(alias))) definitions.push(def);
  }
  return promoteCatalogDefinitions(definitions, options);
}
