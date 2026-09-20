import { getObjectCardDefinition } from '../state/CardFace.js';

const SUPERTYPES = new Set(['Basic', 'Legendary', 'Snow', 'World', 'Ongoing']);
const PRINTING_ONLY_FIELDS = new Set([
  'scryfallId','scryfall_id','set','setCode','setName','collectorNumber','collector_number',
  'image','imageUris','image_uris','artCrop','artist','rarity','prices','purchaseUris','purchase_uris'
]);

function unique(values = []) { return [...new Set(values.filter(value => value != null && value !== ''))]; }
function safeClone(value, fallback = null) {
  try { return structuredClone(value); }
  catch {
    if (Array.isArray(value)) return value.map(item => safeClone(item, null));
    if (value && typeof value === 'object') {
      const out = {};
      for (const [key, item] of Object.entries(value)) if (typeof item !== 'function') out[key] = safeClone(item, null);
      return out;
    }
    return typeof value === 'function' ? fallback : value;
  }
}

export function parseCopiableTypeLine(typeLine = '', fallbackSubtypes = []) {
  const raw = String(typeLine || '').replace(/—/g, '-');
  const [left = '', right = ''] = raw.split(/\s+-\s+/, 2);
  const words = left.trim().split(/\s+/).filter(Boolean);
  const supertypes = unique(words.filter(word => SUPERTYPES.has(word)));
  const types = unique(words.filter(word => !SUPERTYPES.has(word)));
  const subtypes = unique([...(fallbackSubtypes || []), ...right.trim().split(/\s+/).filter(Boolean)]);
  return { supertypes, types, subtypes };
}

export function buildCopiableTypeLine({ supertypes = [], types = [], subtypes = [] } = {}) {
  const left = unique([...supertypes, ...types]).join(' ').trim();
  const right = unique(subtypes).join(' ').trim();
  return right ? `${left} — ${right}` : left;
}

function stripPrintingMetadata(definition = {}) {
  const out = {};
  for (const [key, value] of Object.entries(definition || {})) {
    if (PRINTING_ONLY_FIELDS.has(key)) continue;
    if (typeof value === 'function') continue;
    out[key] = safeClone(value);
  }
  return out;
}

/**
 * Rules-copy snapshot. This is intentionally separate from the physical card's
 * immutable identity/baseCharacteristics and from later continuous effects.
 */
export function createCopiableValues(definition = {}, object = {}) {
  const effective = getObjectCardDefinition(definition, object, object?.zone);
  const parsed = parseCopiableTypeLine(effective.typeLine || effective.type || '', effective.subtypes || []);
  return {
    schemaVersion: 1,
    sourceCardId: effective.id || object?.cardId || definition.id || null,
    sourceGameObjectId: object?.gameObjectId || null,
    name: effective.name || object?.cardId || '',
    manaCost: effective.manaCost ?? effective.mana_cost ?? '',
    manaValue: Number(effective.manaValue ?? effective.cmc ?? 0),
    colorIndicator: safeClone(effective.colorIndicator ?? effective.color_indicator ?? [] , []),
    colors: unique(safeClone(effective.colors || [], [])),
    colorIdentity: unique(safeClone(effective.colorIdentity ?? effective.color_identity ?? [], [])),
    supertypes: parsed.supertypes,
    types: parsed.types,
    subtypes: parsed.subtypes,
    typeLine: buildCopiableTypeLine(parsed),
    oracleText: effective.oracleText ?? effective.oracle_text ?? effective.text ?? '',
    power: effective.power ?? null,
    toughness: effective.toughness ?? null,
    loyalty: effective.loyalty ?? null,
    defense: effective.defense ?? null,
    keywords: unique(safeClone(effective.keywords || [], [])),
    abilities: safeClone(effective.abilities || [], []),
    spellEffects: safeClone(effective.spellEffects || [], []),
    layout: effective.layout || definition.layout || 'normal',
    rulesData: stripPrintingMetadata(effective),
    copyModifications: []
  };
}

function removeValues(values, removals = []) {
  const denied = new Set(removals.map(value => String(value).toLowerCase()));
  return values.filter(value => !denied.has(String(value).toLowerCase()));
}

/** Apply Clone-style "except" modifications to the copy snapshot itself. */
export function applyCopyModifications(input, modifications = {}) {
  const values = safeClone(input, {});
  const mod = safeClone(modifications || {}, {});
  if (!values.copyModifications) values.copyModifications = [];
  values.copyModifications.push(mod);

  if (mod.name != null || mod.setName != null) values.name = String(mod.setName ?? mod.name);
  if (mod.manaCost != null || mod.setManaCost != null) values.manaCost = String(mod.setManaCost ?? mod.manaCost);
  if (mod.manaValue != null || mod.setManaValue != null) values.manaValue = Number(mod.setManaValue ?? mod.manaValue);
  if (mod.colorIndicator != null || mod.setColorIndicator != null) values.colorIndicator = unique([].concat(mod.setColorIndicator ?? mod.colorIndicator ?? []));
  if (mod.setColors) values.colors = unique([].concat(mod.setColors));
  if (mod.addColors) values.colors = unique([...values.colors, ...[].concat(mod.addColors)]);
  if (mod.removeColors) values.colors = removeValues(values.colors, [].concat(mod.removeColors));

  if (mod.setSupertypes) values.supertypes = unique([].concat(mod.setSupertypes));
  if (mod.addSupertypes) values.supertypes = unique([...values.supertypes, ...[].concat(mod.addSupertypes)]);
  if (mod.removeSupertypes) values.supertypes = removeValues(values.supertypes, [].concat(mod.removeSupertypes));
  if (mod.notLegendary || mod.removeLegendary) values.supertypes = removeValues(values.supertypes, ['Legendary']);
  if (mod.legendary === true && !values.supertypes.some(type => String(type).toLowerCase() === 'legendary')) values.supertypes = ['Legendary', ...values.supertypes];

  if (mod.setTypes) values.types = unique([].concat(mod.setTypes));
  if (mod.addTypes) values.types = unique([...values.types, ...[].concat(mod.addTypes)]);
  if (mod.addType) values.types = unique([...values.types, mod.addType]);
  if (mod.removeTypes) values.types = removeValues(values.types, [].concat(mod.removeTypes));
  if (mod.removeType) values.types = removeValues(values.types, [mod.removeType]);

  if (mod.setSubtypes) values.subtypes = unique([].concat(mod.setSubtypes));
  if (mod.addSubtypes) values.subtypes = unique([...values.subtypes, ...[].concat(mod.addSubtypes)]);
  if (mod.addSubtype) values.subtypes = unique([...values.subtypes, mod.addSubtype]);
  if (mod.removeSubtypes) values.subtypes = removeValues(values.subtypes, [].concat(mod.removeSubtypes));
  if (mod.removeSubtype) values.subtypes = removeValues(values.subtypes, [mod.removeSubtype]);
  values.typeLine = buildCopiableTypeLine(values);

  if (mod.oracleText != null || mod.setOracleText != null) values.oracleText = String(mod.setOracleText ?? mod.oracleText);
  if (mod.appendOracleText) values.oracleText = `${values.oracleText}${values.oracleText ? '\n' : ''}${String(mod.appendOracleText)}`;
  if (mod.setPower != null || mod.power != null) values.power = mod.setPower ?? mod.power;
  if (mod.setToughness != null || mod.toughness != null) values.toughness = mod.setToughness ?? mod.toughness;
  if (mod.setLoyalty != null || mod.loyalty != null) values.loyalty = mod.setLoyalty ?? mod.loyalty;
  if (mod.setDefense != null || mod.defense != null) values.defense = mod.setDefense ?? mod.defense;

  if (mod.setKeywords) values.keywords = unique([].concat(mod.setKeywords));
  if (mod.addKeywords) values.keywords = unique([...values.keywords, ...[].concat(mod.addKeywords)]);
  if (mod.addKeyword) values.keywords = unique([...values.keywords, mod.addKeyword]);
  if (mod.removeKeywords) values.keywords = removeValues(values.keywords, [].concat(mod.removeKeywords));
  if (mod.removeKeyword) values.keywords = removeValues(values.keywords, [mod.removeKeyword]);

  if (mod.setAbilities) values.abilities = safeClone([].concat(mod.setAbilities), []);
  if (mod.addAbilities) values.abilities = [...values.abilities, ...safeClone([].concat(mod.addAbilities), [])];
  if (mod.addAbility) values.abilities = [...values.abilities, safeClone(mod.addAbility)];
  if (mod.removeAbilities === true) values.abilities = [];
  else if (Array.isArray(mod.removeAbilities)) {
    const denied = new Set(mod.removeAbilities.map(value => String(value).toLowerCase()));
    values.abilities = values.abilities.filter(ability => !denied.has(String(ability?.type || '').toLowerCase()));
  }

  // Convenience flags used by several real Clone variants.
  if (mod.artifact === true && !values.types.some(type => String(type).toLowerCase() === 'artifact')) values.types.push('Artifact');
  if (mod.creature === true && !values.types.some(type => String(type).toLowerCase() === 'creature')) values.types.push('Creature');
  values.typeLine = buildCopiableTypeLine(values);

  values.rulesData = {
    ...(values.rulesData || {}),
    name: values.name,
    manaCost: values.manaCost,
    manaValue: values.manaValue,
    colorIndicator: safeClone(values.colorIndicator, []),
    colors: safeClone(values.colors, []),
    colorIdentity: safeClone(values.colorIdentity, []),
    typeLine: values.typeLine,
    subtypes: safeClone(values.subtypes, []),
    oracleText: values.oracleText,
    power: values.power,
    toughness: values.toughness,
    loyalty: values.loyalty,
    defense: values.defense,
    keywords: safeClone(values.keywords, []),
    abilities: safeClone(values.abilities, []),
    spellEffects: safeClone(values.spellEffects, [])
  };
  return values;
}

export function definitionFromCopiableValues(values = {}) {
  const base = safeClone(values.rulesData || {}, {});
  return {
    ...base,
    id: values.sourceCardId || base.id || null,
    name: values.name || base.name || '',
    manaCost: values.manaCost ?? base.manaCost ?? '',
    manaValue: Number(values.manaValue ?? base.manaValue ?? 0),
    colorIndicator: safeClone(values.colorIndicator || [], []),
    colors: safeClone(values.colors || [], []),
    colorIdentity: safeClone(values.colorIdentity || base.colorIdentity || [], []),
    typeLine: values.typeLine || buildCopiableTypeLine(values),
    subtypes: safeClone(values.subtypes || [], []),
    oracleText: values.oracleText ?? base.oracleText ?? '',
    power: values.power ?? null,
    toughness: values.toughness ?? null,
    loyalty: values.loyalty ?? null,
    defense: values.defense ?? null,
    keywords: safeClone(values.keywords || [], []),
    abilities: safeClone(values.abilities || [], []),
    spellEffects: safeClone(values.spellEffects || [], []),
    layout: values.layout || base.layout || 'normal'
  };
}

export function copyLayerTransform(values = {}) {
  return {
    setName: values.name,
    setManaCost: values.manaCost,
    setManaValue: values.manaValue,
    setColorIndicator: safeClone(values.colorIndicator || [], []),
    setOracleText: values.oracleText,
    setSupertypes: safeClone(values.supertypes || [], []),
    setTypes: safeClone(values.types || [], []),
    setSubtypes: safeClone(values.subtypes || [], []),
    setColors: safeClone(values.colors || [], []),
    setKeywords: safeClone(values.keywords || [], []),
    setAbilities: safeClone(values.abilities || [], []),
    setPower: values.power,
    setToughness: values.toughness,
    setLoyalty: values.loyalty,
    setDefense: values.defense
  };
}
