import { parseCopiableTypeLine } from '../copy/CopiableValues.js';

const clone = value => value == null ? value : structuredClone(value);
const unique = values => [...new Set((values || []).filter(value => value != null && value !== ''))];

export function tokenSlug(value = 'token') {
  return String(value || 'token')
    .trim().toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'token';
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().filter(key => typeof value[key] !== 'function').map(key => [key, stableObject(value[key])]));
}

export function tokenDefinitionFingerprint(definition = {}) {
  const text = JSON.stringify(stableObject({
    name: definition.name || '', typeLine: definition.typeLine || '', colors: definition.colors || [],
    subtypes: definition.subtypes || [], keywords: definition.keywords || [], power: definition.power ?? null,
    toughness: definition.toughness ?? null, loyalty: definition.loyalty ?? null, defense: definition.defense ?? null,
    oracleText: definition.oracleText || '', abilities: definition.abilities || [], layout: definition.layout || 'normal',
    cardFaces: definition.cardFaces || definition.faces || []
  }));
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function normalizeTokenDefinition(input = {}, { id = null, source = 'custom', aliases = [] } = {}) {
  if (typeof input === 'string') input = { name: input };
  if (!input || typeof input !== 'object') throw new Error('Token definition must be an object or token name');
  const name = String(input.name || input.type || '').trim();
  if (!name) throw new Error('Token definition requires a name');
  const typeLine = String(input.typeLine || input.type_line || 'Token Creature').trim();
  const parsed = parseCopiableTypeLine(typeLine, input.subtypes || []);
  const definitionId = id || input.id || input.tokenDefinitionId || `token:${tokenSlug(name)}:${tokenDefinitionFingerprint({ ...input, name, typeLine })}`;
  return Object.freeze({
    id: String(definitionId),
    tokenDefinitionId: String(definitionId),
    name,
    manaCost: input.manaCost ?? input.mana_cost ?? '',
    manaValue: Number(input.manaValue ?? input.cmc ?? 0),
    typeLine,
    supertypes: unique(input.supertypes || parsed.supertypes),
    types: unique(input.types || parsed.types),
    subtypes: unique(input.subtypes || parsed.subtypes),
    colors: unique(clone(input.colors || [])),
    colorIdentity: unique(clone(input.colorIdentity ?? input.color_identity ?? input.colors ?? [])),
    colorIndicator: unique(clone(input.colorIndicator ?? input.color_indicator ?? [])),
    keywords: unique(clone(input.keywords || [])),
    oracleText: String(input.oracleText ?? input.oracle_text ?? ''),
    power: input.power ?? null,
    toughness: input.toughness ?? null,
    loyalty: input.loyalty ?? null,
    defense: input.defense ?? null,
    abilities: clone(input.abilities || []),
    spellEffects: clone(input.spellEffects || []),
    layout: input.layout || ((input.cardFaces || input.card_faces || input.faces)?.length > 1 ? 'transform' : 'normal'),
    cardFaces: clone(input.cardFaces || input.card_faces || input.faces || []),
    attachment: clone(input.attachment || null),
    enchantFilter: clone(input.enchantFilter || null),
    tokenFamily: input.tokenFamily || null,
    roleType: input.roleType || null,
    source,
    aliases: unique([...(input.aliases || []), ...aliases]),
    metadata: clone(input.metadata || {}),
    isTokenDefinition: true
  });
}
