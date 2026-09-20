import { getObjectCardDefinition } from '../state/CardFace.js';

export const LAYER = Object.freeze({
  COPY: 1,
  CONTROL: 2,
  TEXT: 3,
  TYPE: 4,
  COLOR: 5,
  ABILITY: 6,
  PT_CDA: 7.0,
  PT_SET: 7.1,
  PT_MODIFY: 7.2,
  PT_COUNTERS: 7.3,
  PT_SWITCH: 7.4
});

const SUPERTYPES = new Set(['Basic', 'Legendary', 'Snow', 'World', 'Ongoing']);
const COLOR_SYMBOLS = ['W', 'U', 'B', 'R', 'G'];

function counterCount(object, type) { return Number(object?.counters?.[type] || 0); }
function unique(values) { return [...new Set((values || []).filter(Boolean))]; }
function lower(value) { return String(value || '').toLowerCase(); }

function manaSymbols(cost = '') {
  return [...String(cost).matchAll(/\{([^}]+)\}/g)].map(match => match[1].toUpperCase());
}

function colorsFromDefinition(definition = {}) {
  const explicit = Array.isArray(definition.colors) ? definition.colors : [];
  if (explicit.length) return unique(explicit.filter(color => COLOR_SYMBOLS.includes(color)));
  const colors = new Set();
  for (const symbol of manaSymbols(definition.manaCost || '')) {
    for (const color of COLOR_SYMBOLS) if (symbol.split('/').includes(color) || symbol === color) colors.add(color);
  }
  return [...colors];
}

function parseTypeLine(definition = {}) {
  const raw = String(definition.typeLine || definition.type || '').replace(/—/g, '-');
  const [left = '', right = ''] = raw.split(/\s+-\s+/, 2);
  const leftWords = left.trim().split(/\s+/).filter(Boolean);
  const supertypes = unique(leftWords.filter(word => SUPERTYPES.has(word)));
  const types = unique(leftWords.filter(word => !SUPERTYPES.has(word)));
  const subtypes = unique([...(definition.subtypes || []), ...right.trim().split(/\s+/).filter(Boolean)]);
  return { supertypes, types, subtypes };
}

function definitionHasType(definition, type) {
  const parsed = parseTypeLine(definition);
  return [...parsed.supertypes, ...parsed.types].some(x => lower(x) === lower(type));
}

function definitionHasSubtype(definition, subtype) {
  return parseTypeLine(definition).subtypes.some(x => lower(x) === lower(subtype));
}

export class TimestampService {
  constructor(engine) { this.engine = engine; }
  next() {
    const state = this.engine.state;
    state.continuousTimestampSequence = Number(state.continuousTimestampSequence || 0) + 1;
    return state.continuousTimestampSequence;
  }
  forObject(object) {
    if (!object) return 0;
    if (!Number.isFinite(object.rulesTimestamp)) object.rulesTimestamp = this.next();
    return object.rulesTimestamp;
  }
}

export class DependencyResolver {
  order(effects = []) {
    const base = [...effects].sort((a, b) => Number(a.layer) - Number(b.layer) || Number(a.sublayer || 0) - Number(b.sublayer || 0) || Number(a.timestamp || 0) - Number(b.timestamp || 0) || String(a.id).localeCompare(String(b.id)));
    const result = [];
    for (const groupKey of unique(base.map(effect => `${effect.layer}:${effect.sublayer || 0}`))) {
      const group = base.filter(effect => `${effect.layer}:${effect.sublayer || 0}` === groupKey);
      const pending = new Map(group.map(effect => [effect.id, effect]));
      while (pending.size) {
        const ready = [...pending.values()].filter(effect => {
          const deps = Array.isArray(effect.dependsOn) ? effect.dependsOn : [];
          return deps.every(dep => !pending.has(dep));
        }).sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0) || String(a.id).localeCompare(String(b.id)));
        const chosen = ready[0] || [...pending.values()].sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0))[0];
        result.push(chosen);
        pending.delete(chosen.id);
      }
    }
    return result;
  }
}

export class ContinuousEffectEngine {
  constructor(engine) {
    this.engine = engine;
    this.timestamps = new TimestampService(engine);
    this.dependencies = new DependencyResolver();
    this.runtimeEffects = new Map();
    this.sequence = 0;
    if (!Array.isArray(engine.state.continuousEffects)) engine.state.continuousEffects = [];
  }

  register(effect = {}) {
    const id = effect.id || `continuous-${++this.sequence}`;
    const normalized = {
      id,
      sourceId: effect.sourceId || effect.source?.instanceId || null,
      layer: Number(effect.layer ?? LAYER.PT_MODIFY),
      sublayer: Number(effect.sublayer || 0),
      timestamp: Number(effect.timestamp || this.timestamps.next()),
      dependsOn: [...(effect.dependsOn || [])],
      duration: effect.duration || 'while-source-present',
      filter: effect.filter || {},
      transform: effect.transform || effect.transformation || {},
      active: effect.active,
      metadata: structuredClone(effect.metadata || {})
    };
    this.runtimeEffects.set(id, normalized);
    // Keep a serializable support/status record in state. Runtime functions stay
    // in the service and are reconstructed by card scripts after hydration.
    const serializable = {
      id, sourceId: normalized.sourceId, layer: normalized.layer, sublayer: normalized.sublayer,
      timestamp: normalized.timestamp, dependsOn: normalized.dependsOn, duration: normalized.duration,
      filter: typeof normalized.filter === 'function' ? { runtimePredicate: true } : structuredClone(normalized.filter),
      transform: typeof normalized.transform === 'function' ? { runtimeTransformation: true } : structuredClone(normalized.transform),
      metadata: normalized.metadata
    };
    const index = this.engine.state.continuousEffects.findIndex(item => item.id === id);
    if (index >= 0) this.engine.state.continuousEffects[index] = serializable;
    else this.engine.state.continuousEffects.push(serializable);
    this.engine.performance?.markMutation?.('continuous:register');
    return id;
  }

  unregister(id) {
    this.runtimeEffects.delete(id);
    this.engine.state.continuousEffects = (this.engine.state.continuousEffects || []).filter(effect => effect.id !== id);
    this.engine.performance?.markMutation?.('continuous:unregister');
  }

  clearExpired() {
    for (const [id, effect] of this.runtimeEffects) {
      if (effect.duration === 'until-end-of-turn' && effect.metadata?.createdTurn != null && effect.metadata.createdTurn < this.engine.state.turn) this.unregister(id);
      else if (effect.duration === 'while-source-present' && effect.sourceId && !this.engine.findPermanent(effect.sourceId)) this.unregister(id);
    }
  }

  baseCharacteristics(object) {
    const definition = getObjectCardDefinition(this.engine.db[object?.cardId] || {}, object || {});
    const parsed = parseTypeLine(definition);
    const faceDown = !!object?.faceDown;
    const types = faceDown ? ['Creature'] : parsed.types;
    const supertypes = faceDown ? [] : parsed.supertypes;
    const subtypes = faceDown ? [] : parsed.subtypes;
    const abilities = faceDown ? [] : structuredClone(definition.abilities || []).filter(a => a.type !== 'static' && a.type !== 'replacement');
    const keywords = faceDown ? [] : unique(definition.keywords || []);
    const chars = {
      name: faceDown ? '' : (definition.name || object?.cardId || ''),
      manaCost: faceDown ? '' : (definition.manaCost || ''),
      manaValue: faceDown ? 0 : Number(definition.manaValue || 0),
      colorIndicator: faceDown ? [] : structuredClone(definition.colorIndicator || []),
      oracleText: faceDown ? '' : (definition.oracleText || definition.text || ''),
      controller: object?.controller || object?.owner || null,
      owner: object?.owner || null,
      supertypes, types, subtypes,
      colors: faceDown ? [] : colorsFromDefinition(definition),
      abilities,
      keywords,
      power: faceDown ? 2 : Number(definition.power || 0),
      toughness: faceDown ? 2 : Number(definition.toughness || 0),
      loyalty: definition.loyalty == null ? null : Number(definition.loyalty),
      defense: definition.defense == null ? null : Number(definition.defense),
      definition
    };
    return chars;
  }

  #sourceDefinition(source) { return source?.cardId ? (this.engine.copy?.definitionForObject(source) || getObjectCardDefinition(this.engine.db[source.cardId] || {}, source || {})) : {}; }

  #abilityActiveRaw(ability = {}, source) {
    const when = ability.when || ability.conditionStatic || {};
    if (when.sourceCounterMin != null && counterCount(source, when.counterType || 'level') < Number(when.sourceCounterMin)) return false;
    if (when.sourceCounterMax != null && counterCount(source, when.counterType || 'level') > Number(when.sourceCounterMax)) return false;
    if (when.controllerSagaLoreMin != null) {
      const lore = (this.engine.state.players[source.controller]?.battlefield || []).filter(p => definitionHasSubtype(this.#sourceDefinition(p), 'Saga')).reduce((sum, p) => sum + counterCount(p, 'lore'), 0);
      if (lore < Number(when.controllerSagaLoreMin)) return false;
    }
    if (when.controllerPermanents) {
      const spec = when.controllerPermanents;
      const count = (this.engine.state.players[source.controller]?.battlefield || []).filter(target => {
        if (target.phasedOut) return false;
        if (spec.other && target.instanceId === source.instanceId) return false;
        const def = this.#sourceDefinition(target);
        if (spec.type && !definitionHasType(def, spec.type)) return false;
        if (spec.subtype && !definitionHasSubtype(def, spec.subtype)) return false;
        if (spec.hasCounter && counterCount(target, spec.hasCounter) <= 0) return false;
        return true;
      }).length;
      if (count < Number(spec.min || 1)) return false;
    }
    return true;
  }

  #matchesFilter(filter = {}, source, target, chars) {
    if (typeof filter === 'function') return !!filter({ engine: this.engine, source, target, characteristics: chars });
    if (!target || target.phasedOut) return false;
    if (filter.zone && target.zone !== filter.zone) return false;
    if (filter.instanceId && target.instanceId !== filter.instanceId) return false;
    if (filter.controller && filter.controller !== 'any') {
      if (this.engine.multiplayer?.matches) {
        if (!this.engine.multiplayer.matches(filter.controller, target.controller, { actorPlayerId: source?.controller, sourceObject: source })) return false;
      } else {
        if (filter.controller === 'you' && target.controller !== source?.controller) return false;
        if (filter.controller === 'opponent' && target.controller === source?.controller) return false;
        if (!['you', 'opponent'].includes(filter.controller) && target.controller !== filter.controller) return false;
      }
    }
    if (filter.self && target.instanceId !== source?.instanceId) return false;
    if ((filter.notSelf || filter.other) && target.instanceId === source?.instanceId) return false;
    if (filter.attachedToSource && source?.attachedTo !== target.instanceId) return false;
    if (filter.type && !chars.types.some(type => lower(type) === lower(filter.type)) && !chars.supertypes.some(type => lower(type) === lower(filter.type))) return false;
    if (Array.isArray(filter.typesAll) && filter.typesAll.some(type => ![...chars.types, ...chars.supertypes].some(x => lower(x) === lower(type)))) return false;
    if (filter.subtype && !chars.subtypes.some(type => lower(type) === lower(filter.subtype))) return false;
    if (Array.isArray(filter.subtypes) && filter.subtypes.length && !filter.subtypes.some(type => chars.subtypes.some(x => lower(x) === lower(type)))) return false;
    if (filter.chosenTypeOfSource && (!source?.chosenType || !chars.subtypes.some(type => lower(type) === lower(source.chosenType)))) return false;
    if (filter.hasCounter && counterCount(target, filter.hasCounter) <= 0) return false;
    if (filter.withoutCounter && counterCount(target, filter.withoutCounter) > 0) return false;
    if (filter.cardId && target.cardId !== filter.cardId) return false;
    if (filter.nonland && chars.types.some(type => lower(type) === 'land')) return false;
    return true;
  }

  #legendaryColors(controller, excludeInstanceId = null) {
    const colors = new Set();
    for (const permanent of this.engine.state.players[controller]?.battlefield || []) {
      if (permanent.phasedOut || permanent.instanceId === excludeInstanceId) continue;
      const def = this.#sourceDefinition(permanent);
      if (!definitionHasType(def, 'Legendary')) continue;
      for (const color of colorsFromDefinition(def)) colors.add(color);
    }
    return colors.size;
  }

  #builtinEffects(object, base) {
    const effects = [];
    const definition = this.engine.copy?.definitionForObject(object) || base.definition;
    const push = (spec) => effects.push({ id: `builtin:${object.instanceId}:${effects.length}`, timestamp: this.timestamps.forObject(object), dependsOn: [], sublayer: 0, filter: {}, ...spec });

    if (definition.creatureAtCounter) {
      const rule = definition.creatureAtCounter;
      push({ layer: LAYER.TYPE, transform: chars => {
        const active = counterCount(object, rule.counter || 'charge') >= Number(rule.amount || 1);
        chars.types = active ? unique([...chars.types, 'Creature']) : chars.types.filter(type => lower(type) !== 'creature');
      }});
    }
    if (definition.creatureUnlessDevotion) {
      const rule = definition.creatureUnlessDevotion;
      push({ layer: LAYER.TYPE, transform: chars => {
        const wanted = new Set(rule.colors || []); let devotion = 0;
        for (const permanent of this.engine.state.players[object.controller]?.battlefield || []) {
          for (const symbol of manaSymbols(this.#sourceDefinition(permanent).manaCost || '')) if (symbol.split('/').some(part => wanted.has(part))) devotion++;
        }
        if (devotion < Number(rule.threshold || 0)) chars.types = chars.types.filter(type => lower(type) !== 'creature');
      }});
    }
    if (definition.chosenTypeAddsSubtype && object.chosenType) push({ layer: LAYER.TYPE, transform: { addSubtypes: [object.chosenType] } });
    if (definition.livingMetal && this.engine.state.activePlayer === object.controller) push({ layer: LAYER.TYPE, transform: { addType: 'Creature' } });
    if (Array.isArray(definition.ownTurnKeywords) && this.engine.state.activePlayer === object.controller) push({ layer: LAYER.ABILITY, transform: { addKeywords: definition.ownTurnKeywords } });
    // Step 23 Reconfigure: an attached reconfigured Equipment creature is not a
    // creature. This is derived in layer 4 rather than mutating its base type.
    if (this.engine.attachments?.isReconfigured(object)) push({ layer: LAYER.TYPE, transform: { removeType: 'Creature' } });
    if (counterCount(object, 'flood') > 0 && definitionHasType(definition, 'Land')) push({ layer: LAYER.TYPE, transform: { addSubtypes: ['Island'] } });
    if (definition.dynamicPowerToughness === 'handSize') push({ layer: LAYER.PT_CDA, transform: chars => {
      const amount = this.engine.state.players[object.controller]?.hand?.length || 0; chars.power = amount; chars.toughness = amount;
    }});

    if (Number(object.modifiers?.power || 0) || Number(object.modifiers?.toughness || 0)) push({ layer: LAYER.PT_MODIFY, transform: { powerDelta: Number(object.modifiers?.power || 0), toughnessDelta: Number(object.modifiers?.toughness || 0) } });
    if ((object.modifiers?.keywords || []).length) push({ layer: LAYER.ABILITY, transform: { addKeywords: object.modifiers.keywords } });
    const plus = counterCount(object, '+1/+1'), minus = counterCount(object, '-1/-1');
    if (plus || minus) push({ layer: LAYER.PT_COUNTERS, transform: { powerDelta: plus - minus, toughnessDelta: plus - minus } });

    return effects;
  }

  #staticCardEffects(target) {
    const effects = [];
    for (const player of Object.values(this.engine.state.players)) {
      for (const source of player.battlefield || []) {
        if (source.phasedOut) continue;
        const sourceDef = this.#sourceDefinition(source);
        for (const [index, ability] of (sourceDef.abilities || []).entries()) {
          if (ability.type !== 'static' || !this.#abilityActiveRaw(ability, source)) continue;
          const effect = ability.effect || {};
          const timestamp = this.timestamps.forObject(source);
          const baseSpec = { id: `card:${source.instanceId}:${index}`, sourceId: source.instanceId, source, timestamp, dependsOn: ability.dependsOn || [], filter: ability.filter || {} };
          if (effect.setController || effect.controller) effects.push({ ...baseSpec, layer: LAYER.CONTROL, transform: { controller: effect.setController || effect.controller } });
          if (effect.addType || effect.addTypes || effect.removeType || effect.removeTypes || effect.setTypes || effect.addSubtype || effect.addSubtypes || effect.removeSubtype || effect.removeSubtypes || effect.setSubtypes) {
            effects.push({ ...baseSpec, layer: LAYER.TYPE, transform: effect });
          }
          if (effect.addColor || effect.addColors || effect.removeColor || effect.removeColors || effect.setColors) effects.push({ ...baseSpec, layer: LAYER.COLOR, transform: effect });
          if (effect.keyword || effect.keywords || effect.grantAbility || effect.removeAbilities || effect.removeKeywords) effects.push({ ...baseSpec, layer: LAYER.ABILITY, transform: {
            addKeywords: unique([...(effect.keywords || []), ...(effect.keyword ? [effect.keyword] : [])]), removeKeywords: effect.removeKeywords || [], addAbilities: effect.grantAbility ? [effect.grantAbility] : [], removeAbilities: effect.removeAbilities
          }});
          if (effect.setPower != null || effect.setToughness != null || effect.setPowerFrom || effect.setToughnessFrom) effects.push({ ...baseSpec, layer: ability.cda ? LAYER.PT_CDA : LAYER.PT_SET, transform: chars => {
            const dynamic = key => {
              if (key === 'controller-hand-size') return this.engine.state.players[source.controller]?.hand?.length || 0;
              if (key === 'creatures-you-control') return (this.engine.state.players[source.controller]?.battlefield || []).filter(p => this.baseCharacteristics(p).types.includes('Creature')).length;
              if (key === 'cards-in-your-graveyard') return this.engine.state.players[source.controller]?.graveyard?.length || 0;
              return null;
            };
            if (effect.setPower != null) chars.power = Number(effect.setPower);
            else if (effect.setPowerFrom) chars.power = dynamic(effect.setPowerFrom);
            if (effect.setToughness != null) chars.toughness = Number(effect.setToughness);
            else if (effect.setToughnessFrom) chars.toughness = dynamic(effect.setToughnessFrom);
          } });
          if (effect.power || effect.toughness || effect.powerToughnessPerLegendaryColor) effects.push({ ...baseSpec, layer: LAYER.PT_MODIFY, transform: chars => {
            if (effect.power) chars.power += Number(effect.power);
            if (effect.toughness) chars.toughness += Number(effect.toughness);
            if (effect.powerToughnessPerLegendaryColor) {
              const amount = this.#legendaryColors(source.controller, source.instanceId); chars.power += amount; chars.toughness += amount;
            }
          }});
        }
      }
    }
    return effects;
  }

  #active(effect) {
    if (typeof effect.active === 'function' && !effect.active({ engine: this.engine, effect })) return false;
    if (effect.duration === 'while-source-present' && effect.sourceId && !this.engine.findPermanent(effect.sourceId)) return false;
    if (effect.duration === 'until-end-of-turn' && effect.metadata?.createdTurn != null && effect.metadata.createdTurn !== this.engine.state.turn) return false;
    return true;
  }

  #applyTransform(chars, transform, context) {
    if (typeof transform === 'function') { transform(chars, context); return; }
    const add = (key, values) => { chars[key] = unique([...chars[key], ...(values || [])]); };
    const remove = (key, values) => { const set = new Set((values || []).map(lower)); chars[key] = chars[key].filter(value => !set.has(lower(value))); };
    if (transform.controller) chars.controller = transform.controller === 'source-controller' ? context.source?.controller : transform.controller;
    if (transform.setName != null) chars.name = String(transform.setName);
    if (transform.setManaCost != null) chars.manaCost = String(transform.setManaCost);
    if (transform.setManaValue != null) chars.manaValue = Number(transform.setManaValue);
    if (transform.setColorIndicator != null) chars.colorIndicator = unique([].concat(transform.setColorIndicator || []));
    if (transform.setOracleText != null) chars.oracleText = String(transform.setOracleText);
    if (transform.replaceText?.from != null) chars.oracleText = chars.oracleText.replaceAll(String(transform.replaceText.from), String(transform.replaceText.to || ''));
    if (transform.setTypes) chars.types = unique(transform.setTypes); add('types', unique([...(transform.addTypes || []), ...(transform.addType ? [transform.addType] : [])])); remove('types', unique([...(transform.removeTypes || []), ...(transform.removeType ? [transform.removeType] : [])]));
    if (transform.setSubtypes) chars.subtypes = unique(transform.setSubtypes); add('subtypes', unique([...(transform.addSubtypes || []), ...(transform.addSubtype ? [transform.addSubtype] : [])])); remove('subtypes', unique([...(transform.removeSubtypes || []), ...(transform.removeSubtype ? [transform.removeSubtype] : [])]));
    if (transform.setSupertypes) chars.supertypes = unique(transform.setSupertypes); add('supertypes', transform.addSupertypes); remove('supertypes', transform.removeSupertypes);
    if (transform.setColors) chars.colors = unique(transform.setColors); add('colors', unique([...(transform.addColors || []), ...(transform.addColor ? [transform.addColor] : [])])); remove('colors', unique([...(transform.removeColors || []), ...(transform.removeColor ? [transform.removeColor] : [])]));
    if (transform.setKeywords) chars.keywords = unique([].concat(transform.setKeywords));
    if (transform.setAbilities) chars.abilities = structuredClone([].concat(transform.setAbilities));
    if (transform.removeAbilities === true) { chars.abilities = []; chars.keywords = []; }
    if (Array.isArray(transform.addAbilities)) chars.abilities.push(...structuredClone(transform.addAbilities));
    if (Array.isArray(transform.removeAbilities)) {
      const removeTypes = new Set(transform.removeAbilities.map(lower)); chars.abilities = chars.abilities.filter(ability => !removeTypes.has(lower(ability.type)));
    }
    add('keywords', transform.addKeywords); remove('keywords', transform.removeKeywords);
    if (Object.prototype.hasOwnProperty.call(transform, 'setPower')) chars.power = transform.setPower == null ? null : Number(transform.setPower);
    if (Object.prototype.hasOwnProperty.call(transform, 'setToughness')) chars.toughness = transform.setToughness == null ? null : Number(transform.setToughness);
    if (Object.prototype.hasOwnProperty.call(transform, 'setLoyalty')) chars.loyalty = transform.setLoyalty == null ? null : Number(transform.setLoyalty);
    if (Object.prototype.hasOwnProperty.call(transform, 'setDefense')) chars.defense = transform.setDefense == null ? null : Number(transform.setDefense);
    if (transform.powerDelta) chars.power = Number(chars.power || 0) + Number(transform.powerDelta);
    if (transform.toughnessDelta) chars.toughness = Number(chars.toughness || 0) + Number(transform.toughnessDelta);
    if (transform.switchPowerToughness) [chars.power, chars.toughness] = [chars.toughness, chars.power];
  }

  characteristics(object, { trace = false } = {}) {
    if (!object) return null;
    if (!trace) {
      const cached = this.engine.performance?.getDerived?.(object);
      if (cached) return cached;
    }
    this.clearExpired();
    const chars = this.baseCharacteristics(object);
    if (object.phasedOut) return { ...chars, phasedOut: true, appliedEffects: [] };
    const copyEffect = this.engine.copy?.copyLayerEffectFor(object) || null;
    const effects = [
      ...(copyEffect ? [copyEffect] : []),
      ...this.#builtinEffects(object, chars),
      ...[...this.runtimeEffects.values()],
      ...this.#staticCardEffects(object)
    ].filter(effect => this.#active(effect));
    const ordered = this.dependencies.order(effects);
    const appliedEffects = [];
    for (const effect of ordered) {
      const source = effect.source || (effect.sourceId ? this.engine.findPermanent(effect.sourceId) : null);
      if (!this.#matchesFilter(effect.filter || {}, source, object, chars)) continue;
      this.#applyTransform(chars, effect.transform || {}, { engine: this.engine, source, target: object, effect });
      appliedEffects.push(effect.id);
    }
    chars.types = unique(chars.types); chars.supertypes = unique(chars.supertypes); chars.subtypes = unique(chars.subtypes);
    chars.colors = unique(chars.colors); chars.keywords = unique(chars.keywords);
    const seen = new Set(); chars.abilities = chars.abilities.filter(ability => { const key = JSON.stringify(ability); if (seen.has(key)) return false; seen.add(key); return true; });
    if (trace) chars.appliedEffects = appliedEffects;
    if (!trace) this.engine.performance?.setDerived?.(object, chars);
    return chars;
  }
}
