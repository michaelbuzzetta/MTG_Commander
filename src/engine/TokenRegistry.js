import { definitionFromCopiableValues } from '../copy/CopiableValues.js';
import { COMMON_TOKEN_DEFINITIONS } from './CommonTokens.js';
import { normalizeTokenDefinition, tokenDefinitionFingerprint, tokenSlug } from './TokenDefinition.js';

function sameDefinition(a, b) {
  const pick = value => JSON.stringify({ name:value.name, typeLine:value.typeLine, colors:value.colors, subtypes:value.subtypes, keywords:value.keywords, power:value.power, toughness:value.toughness, oracleText:value.oracleText, abilities:value.abilities, cardFaces:value.cardFaces });
  return pick(a) === pick(b);
}

export class TokenRegistry {
  constructor(definitions = COMMON_TOKEN_DEFINITIONS) {
    this.definitions = new Map();
    this.aliases = new Map();
    for (const definition of definitions) this.register(definition, { source: 'common', replace: true });
  }

  register(definition, { id = null, aliases = [], source = 'custom', replace = false } = {}) {
    const normalized = normalizeTokenDefinition(definition, { id, aliases, source });
    const existing = this.definitions.get(normalized.id);
    if (existing && !replace && !sameDefinition(existing, normalized)) throw new Error(`Token definition id collision: ${normalized.id}`);
    this.definitions.set(normalized.id, normalized);
    for (const alias of [normalized.id, normalized.name, ...(normalized.aliases || [])]) this.aliases.set(String(alias).toLowerCase(), normalized.id);
    return structuredClone(normalized);
  }

  registerLocal(namespace, definition, options = {}) {
    const name = definition?.name || definition?.type || 'Token';
    const id = definition?.id || `token:local:${tokenSlug(namespace || 'card')}:${tokenSlug(name)}:${tokenDefinitionFingerprint(definition)}`;
    return this.register(definition, { ...options, id, source: `card-local:${namespace || 'unknown'}` });
  }

  has(ref) { return !!this._idFor(ref); }

  _idFor(ref) {
    if (!ref) return null;
    if (typeof ref === 'object') ref = ref.tokenDefinitionId || ref.id || ref.name;
    const value = String(ref || '');
    if (this.definitions.has(value)) return value;
    return this.aliases.get(value.toLowerCase()) || null;
  }

  get(ref) {
    const id = this._idFor(ref);
    return id ? structuredClone(this.definitions.get(id)) : null;
  }

  resolve(ref, { namespace = null } = {}) {
    if (typeof ref === 'string') {
      const known = this.get(ref);
      if (!known) throw new Error(`Unknown token definition: ${ref}`);
      return known;
    }
    if (!ref || typeof ref !== 'object') throw new Error('Token definition is required');
    const known = this.get(ref.tokenDefinitionId || ref.id || ref.name);
    // CREATE_TOKEN replacements are allowed to change token characteristics.
    // A fully normalized registry definition carries isTokenDefinition; if a
    // replacement changed it, derive a new deterministic rules identity instead
    // of snapping it back to the original common definition.
    if (known && ref.isTokenDefinition === true && !sameDefinition(known, ref)) {
      const derived = { ...structuredClone(ref) };
      delete derived.id; delete derived.tokenDefinitionId;
      const id = `token:derived:${tokenSlug(derived.name || known.name)}:${tokenDefinitionFingerprint(derived)}`;
      return this.register(derived, { id, source: 'replacement-derived', replace: true });
    }
    // Bare/common references use the official reusable definition.
    if (known) return known;
    if (namespace) return this.registerLocal(namespace, ref);
    // Preserve the long-standing runtime id `token:<Name>` for the first inline
    // custom definition so existing decks/tests/replays remain compatible. If
    // another different token shares that name, derive a fingerprinted id.
    const legacyId = ref.id || `token:${ref.name || ref.type || 'Token'}`;
    const candidate = normalizeTokenDefinition(ref, { id: legacyId, source: 'inline-custom' });
    const existing = this.definitions.get(legacyId);
    if (!existing) return this.register(candidate, { id: legacyId, source: 'inline-custom' });
    if (sameDefinition(existing, candidate)) return this.get(legacyId);
    const derivedId = `token:${tokenSlug(ref.name || ref.type || 'token')}:${tokenDefinitionFingerprint(ref)}`;
    const derived = normalizeTokenDefinition(ref, { id: derivedId, source: 'inline-custom-collision' });
    if (!this.definitions.has(derivedId)) this.register(derived, { id: derivedId, source: 'inline-custom-collision' });
    return this.get(derivedId);
  }

  fromCopiableValues(values, { namespace = 'copy', modifications = null } = {}) {
    const base = definitionFromCopiableValues(values);
    const fingerprint = tokenDefinitionFingerprint(base);
    const id = `token:copy:${tokenSlug(base.name || 'copy')}:${fingerprint}`;
    const definition = { ...base, id, tokenDefinitionId: id, metadata: { generatedFromCopiableValues: true, modifications: modifications || values.copyModifications || [] } };
    return this.register(definition, { id, source: `copiable:${namespace}`, replace: true });
  }

  list() { return [...this.definitions.values()].map(value => structuredClone(value)); }
  snapshot() { return this.list().sort((a,b) => a.id.localeCompare(b.id)); }
}
