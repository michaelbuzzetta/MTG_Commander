function normalizedName(value = '') {
  return String(value).trim().toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ');
}

function freezeDefinition(input) {
  const id = normalizedName(input.id || input.name);
  if (!id) throw new Error('Mechanic definition requires an id');
  return Object.freeze({
    id,
    name: input.name || input.id,
    category: input.category || 'other',
    dependencies: Object.freeze([...(input.dependencies || [])]),
    aliases: Object.freeze([...(input.aliases || [])].map(normalizedName)),
    keywordPatterns: Object.freeze([...(input.keywordPatterns || [])]),
    oraclePatterns: Object.freeze([...(input.oraclePatterns || [])]),
    hooks: Object.freeze([...(input.hooks || [])]),
    conformance: Object.freeze([...(input.conformance || [])]),
    metadata: Object.freeze({ ...(input.metadata || {}) })
  });
}

export class MechanicRegistry {
  constructor() {
    this.definitions = new Map();
    this.aliases = new Map();
  }

  register(input) {
    const definition = freezeDefinition(input);
    if (this.definitions.has(definition.id)) throw new Error(`Mechanic ${definition.id} is already registered`);
    this.definitions.set(definition.id, definition);
    this.aliases.set(definition.id, definition.id);
    this.aliases.set(normalizedName(definition.name), definition.id);
    for (const alias of definition.aliases) this.aliases.set(alias, definition.id);
    return definition;
  }

  registerMany(definitions = []) {
    for (const definition of definitions) this.register(definition);
    return this;
  }

  resolve(name) {
    const id = this.aliases.get(normalizedName(name)) || normalizedName(name);
    return this.definitions.get(id) || null;
  }

  has(name) { return !!this.resolve(name); }
  list({ category = null } = {}) {
    return [...this.definitions.values()].filter(definition => !category || definition.category === category);
  }

  recognize(cardDefinition = {}) {
    const keywords = (cardDefinition.keywords || []).map(normalizedName);
    const text = normalizedName(cardDefinition.oracleText || cardDefinition.rulesText || '');
    const explicit = [
      ...(cardDefinition.mechanics || []),
      ...(cardDefinition.mechanicTags || [])
    ].map(normalizedName);
    const found = new Set();

    for (const definition of this.definitions.values()) {
      const names = new Set([definition.id, normalizedName(definition.name), ...definition.aliases]);
      if (explicit.some(value => names.has(value))) { found.add(definition.id); continue; }
      if (keywords.some(keyword => names.has(keyword))) { found.add(definition.id); continue; }
      if (definition.keywordPatterns.some(pattern => pattern instanceof RegExp ? keywords.some(keyword => pattern.test(keyword)) : keywords.includes(normalizedName(pattern)))) {
        found.add(definition.id); continue;
      }
      if (definition.oraclePatterns.some(pattern => pattern instanceof RegExp ? pattern.test(text) : text.includes(normalizedName(pattern)))) found.add(definition.id);
    }
    return [...found].map(id => this.definitions.get(id));
  }

  validateDependencies(availableSubsystems = []) {
    const available = new Set(availableSubsystems.map(normalizedName));
    const missing = [];
    for (const definition of this.definitions.values()) {
      const absent = definition.dependencies.filter(dep => !available.has(normalizedName(dep)));
      if (absent.length) missing.push({ mechanic: definition.id, missing: absent });
    }
    return missing;
  }

  snapshot() {
    return this.list().map(definition => ({
      id: definition.id,
      name: definition.name,
      category: definition.category,
      dependencies: [...definition.dependencies],
      hooks: [...definition.hooks],
      conformance: [...definition.conformance]
    }));
  }
}

export function mechanicDefinition(fields) { return fields; }
