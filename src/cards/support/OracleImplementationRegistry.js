import { baseOracleIdentity, printingMetadata, stableTextFingerprint } from './OracleIdentity.js';

const RULE_FIELDS = Object.freeze([
  'name', 'layout', 'typeLine', 'manaCost', 'manaValue', 'power', 'toughness', 'loyalty', 'defense',
  'colors', 'colorIdentity', 'subtypes', 'keywords', 'producedMana', 'oracleText', 'cardFaces',
  'abilities', 'spellEffects', 'modes', 'targets', 'minTargets', 'maxTargets', 'optionalTarget', 'wardCost',
  'script', 'cardScript'
]);

const PRINTING_FIELDS = new Set([
  'id', 'scryfallId', 'scryfall_id', 'set', 'setName', 'collectorNumber', 'image', 'imageSmall', 'artCrop',
  'rarity', 'artist', 'legalities', 'games', 'reserved', 'edhrecRank', 'pennyRank', 'source', 'catalogCard'
]);

function scoreCanonical(card = {}) {
  let score = 0;
  if (card.script || card.cardScript) score += 100;
  if ((card.abilities || []).length) score += 30;
  if ((card.spellEffects || []).length) score += 30;
  if ((card.keywords || []).length) score += 10;
  if (card.supported !== false) score += 10;
  if (card.oracleId || card.oracle_id) score += 5;
  return score;
}

function cloneRules(card = {}) {
  const out = {};
  for (const field of RULE_FIELDS) if (card[field] !== undefined) out[field] = structuredClone(card[field]);
  return out;
}

function mergeRulesIntoPrinting(printing, canonical, identity) {
  const merged = structuredClone(printing);
  const rules = cloneRules(canonical);
  for (const [field, value] of Object.entries(rules)) {
    if (!PRINTING_FIELDS.has(field)) merged[field] = value;
  }
  merged.oracleId = identity.oracleId || printing.oracleId || null;
  merged.oracleIdentity = identity.key;
  merged.rulesImplementationId = identity.implementationId;
  merged.printingMetadata = printingMetadata(printing);
  return merged;
}

export class OracleImplementationRegistry {
  constructor(db = {}, { supportRecords = {} } = {}) {
    this.supportRecords = supportRecords || {};
    this.implementations = new Map();
    this.printingToImplementation = new Map();
    this._build(db);
  }

  _identitySeed(card) {
    const support = this.supportRecords?.[card.id] || null;
    return baseOracleIdentity(card, support);
  }

  _build(db) {
    const baseGroups = new Map();
    for (const [id, raw] of Object.entries(db || {})) {
      const card = { ...raw, id: raw?.id || id };
      const base = this._identitySeed(card);
      if (!baseGroups.has(base.key)) baseGroups.set(base.key, { base, cards: [] });
      baseGroups.get(base.key).cards.push(card);
    }

    for (const { base, cards } of baseGroups.values()) {
      const textGroups = new Map();
      for (const card of cards) {
        const text = String(card.oracleText || '').trim();
        const fingerprint = stableTextFingerprint(text);
        if (!textGroups.has(fingerprint)) textGroups.set(fingerprint, []);
        textGroups.get(fingerprint).push(card);
      }
      const divergentOracleText = base.oracleId && textGroups.size > 1;
      for (const [fingerprint, variants] of textGroups) {
        const implementationId = divergentOracleText ? `${base.key}@${fingerprint}` : base.key;
        const canonical = [...variants].sort((a, b) => scoreCanonical(b) - scoreCanonical(a) || String(a.id).localeCompare(String(b.id)))[0];
        const identity = { ...base, key: implementationId, implementationId, oracleTextFingerprint: fingerprint };
        const implementation = {
          implementationId,
          oracleId: base.oracleId,
          identitySource: base.source,
          oracleTextFingerprint: fingerprint,
          canonicalCardId: canonical.id,
          name: canonical.name,
          cardIds: variants.map(card => card.id).sort(),
          printings: variants.map(printingMetadata),
          rules: cloneRules(canonical)
        };
        this.implementations.set(implementationId, implementation);
        for (const card of variants) this.printingToImplementation.set(card.id, identity);
      }
    }
  }

  resolveImplementation(cardOrId) {
    const cardId = typeof cardOrId === 'string' ? cardOrId : cardOrId?.id;
    const identity = this.printingToImplementation.get(cardId);
    return identity ? this.implementations.get(identity.implementationId) || null : null;
  }

  getImplementation(implementationId) { return this.implementations.get(implementationId) || null; }

  applyToDatabase(db = {}) {
    const out = {};
    for (const [id, raw] of Object.entries(db)) {
      const card = { ...raw, id: raw?.id || id };
      const identity = this.printingToImplementation.get(card.id);
      const implementation = identity ? this.implementations.get(identity.implementationId) : null;
      out[id] = implementation ? mergeRulesIntoPrinting(card, implementation.rules, identity) : structuredClone(card);
    }
    return out;
  }

  snapshot() {
    return {
      implementations: [...this.implementations.values()].map(row => structuredClone(row)),
      printingToImplementation: Object.fromEntries([...this.printingToImplementation.entries()].map(([cardId, identity]) => [cardId, identity.implementationId]))
    };
  }
}
