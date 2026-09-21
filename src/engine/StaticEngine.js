import { hasSubtype, isType } from './utils.js';
import { getObjectCardDefinition } from './state/CardFace.js';

const COLOR_SYMBOLS = ['W', 'U', 'B', 'R', 'G'];

function manaSymbols(cost = '') {
  return [...String(cost).matchAll(/\{([^}]+)\}/g)].map(match => match[1].toUpperCase());
}

function colorsFromDefinition(definition = {}) {
  const explicit = Array.isArray(definition.colors) ? definition.colors : [];
  if (explicit.length) return new Set(explicit.filter(color => COLOR_SYMBOLS.includes(color)));
  const colors = new Set();
  for (const symbol of manaSymbols(definition.manaCost || '')) {
    for (const color of COLOR_SYMBOLS) if (symbol.split('/').includes(color) || symbol === color) colors.add(color);
  }
  return colors;
}

function counterCount(permanent, type) {
  return Number(permanent?.counters?.[type] || 0);
}

export class StaticEngine {
  constructor(engine) { this.engine = engine; }

  definitionFor(object) {
    if (!object) return {};
    return this.engine.copy?.definitionForObject(object) || getObjectCardDefinition(this.engine.db[object.cardId] || {}, object);
  }

  devotion(playerId, colors) { return this.engine.mechanics.devotion(playerId, colors); }

  isType(permanent, type) {
    if (!permanent || permanent.phasedOut) return false;
    const chars = this.engine.continuous?.characteristics(permanent);
    if (!chars) return false;
    const wanted = String(type).toLowerCase();
    return [...chars.supertypes, ...chars.types].some(value => String(value).toLowerCase() === wanted);
  }

  hasSubtype(permanent, subtype) {
    if (!permanent || permanent.phasedOut) return false;
    const chars = this.engine.continuous?.characteristics(permanent);
    if (!chars) return false;
    const wanted = String(subtype).toLowerCase();
    if (chars.subtypes.some(value => String(value).toLowerCase() === wanted)) return true;
    const nonCreatureSubtypes = new Set(['plains','island','swamp','mountain','forest','aura','equipment','fortification','vehicle','clue','food','treasure','map']);
    const isCreature = chars.types.some(value => String(value).toLowerCase() === 'creature');
    const changeling = chars.keywords.some(value => String(value).toLowerCase() === 'changeling');
    return isCreature && changeling && !nonCreatureSubtypes.has(wanted);
  }

  sharesSubtype(a, b) {
    if (!a || !b) return false;
    const aDef = this.definitionFor(a);
    const bDef = this.definitionFor(b);
    const aTypes = [...(aDef.subtypes || []), ...(a.chosenType ? [a.chosenType] : [])];
    const bTypes = [...(bDef.subtypes || []), ...(b.chosenType ? [b.chosenType] : [])];
    return aTypes.some(type => this.hasSubtype(b, type)) || bTypes.some(type => this.hasSubtype(a, type));
  }

  _abilityActive(ability = {}, source) {
    const when = ability.when || ability.conditionStatic || {};
    if (when.sourceCounterMin != null && counterCount(source, when.counterType || 'level') < Number(when.sourceCounterMin)) return false;
    if (when.sourceCounterMax != null && counterCount(source, when.counterType || 'level') > Number(when.sourceCounterMax)) return false;
    if (when.controllerSagaLoreMin != null) {
      const lore = (this.engine.state.players[source.controller]?.battlefield || [])
        .filter(permanent => this.hasSubtype(permanent, 'Saga'))
        .reduce((sum, permanent) => sum + counterCount(permanent, 'lore'), 0);
      if (lore < Number(when.controllerSagaLoreMin)) return false;
    }
    if (when.controllerPermanents) {
      const spec = when.controllerPermanents;
      const count = (this.engine.state.players[source.controller]?.battlefield || []).filter(target => {
        if (target.phasedOut) return false;
        if (spec.other && target.instanceId === source.instanceId) return false;
        if (spec.type && !this.isType(target, spec.type)) return false;
        if (spec.subtype && !this.hasSubtype(target, spec.subtype)) return false;
        if (spec.hasCounter && counterCount(target, spec.hasCounter) <= 0) return false;
        return true;
      }).length;
      if (count < Number(spec.min || 1)) return false;
    }
    return true;
  }

  _matchesFilter(filter = {}, source, target) {
    if (!source || !target || target.phasedOut) return false;
    const targetDef = this.definitionFor(target);
    if (filter.zone && filter.zone !== 'battlefield') return false;
    if (filter.controller && filter.controller !== 'any') {
      if (this.engine.multiplayer?.matches) {
        if (!this.engine.multiplayer.matches(filter.controller, target.controller, { actorPlayerId: source.controller, sourceObject: source })) return false;
      } else {
        if (filter.controller === 'you' && target.controller !== source.controller) return false;
        if (filter.controller === 'opponent' && target.controller === source.controller) return false;
        if (!['you', 'opponent'].includes(filter.controller) && target.controller !== filter.controller) return false;
      }
    }
    if (filter.self && target.instanceId !== source.instanceId) return false;
    if ((filter.notSelf || filter.other) && target.instanceId === source.instanceId) return false;
    if (filter.attachedToSource && source.attachedTo !== target.instanceId) return false;
    if (filter.type && !this.isType(target, filter.type)) return false;
    if (Array.isArray(filter.typesAll) && filter.typesAll.some(type => !this.isType(target, type))) return false;
    if (filter.subtype && !this.hasSubtype(target, filter.subtype)) return false;
    if (Array.isArray(filter.subtypes) && filter.subtypes.length && !filter.subtypes.some(type => this.hasSubtype(target, type))) return false;
    if (filter.chosenTypeOfSource && (!source.chosenType || !this.hasSubtype(target, source.chosenType))) return false;
    if (filter.hasCounter && counterCount(target, filter.hasCounter) <= 0) return false;
    if (filter.withoutCounter && counterCount(target, filter.withoutCounter) > 0) return false;
    if (filter.cardId && target.cardId !== filter.cardId) return false;
    if (filter.nonland && isType(targetDef, 'Land')) return false;
    return true;
  }

  _legendaryColors(controller, excludeInstanceId = null) {
    const colors = new Set();
    for (const permanent of this.engine.state.players[controller]?.battlefield || []) {
      if (permanent.phasedOut || permanent.instanceId === excludeInstanceId) continue;
      const definition = this.definitionFor(permanent);
      if (!isType(definition, 'Legendary')) continue;
      for (const color of colorsFromDefinition(definition)) colors.add(color);
    }
    return colors;
  }

  derivedStats(permanent) {
    const chars = this.engine.continuous?.characteristics(permanent);
    if (!chars) return { power: 0, toughness: 0, keywords: [] };
    return { power: Number(chars.power || 0), toughness: Number(chars.toughness || 0), keywords: [...chars.keywords] };
  }

  effectiveAbilities(permanent) {
    const definition = this.definitionFor(permanent);
    if (permanent?.faceDown) {
      const cost = definition?.manaCost || '';
      return cost ? [{ type: 'activated', cost: { mana: cost }, sorcerySpeed: true, effect: { type: 'turnFaceUp' } }] : [];
    }
    const chars = this.engine.continuous?.characteristics(permanent);
    const abilities = structuredClone(chars?.abilities || []);
    // Step 23 models equip/fortify/reconfigure through the same authoritative
    // activated-ability stack/cost/targeting path as printed activated abilities.
    abilities.push(...structuredClone(this.engine.attachments?.syntheticAbilities(permanent) || []));
    return abilities;
  }

  maximumHandSize(playerId) {
    for (const source of this.engine.state.players[playerId]?.battlefield || []) {
      if (source.phasedOut) continue;
      const def = this.definitionFor(source);
      if (def.noMaximumHandSize) return Infinity;
      for (const ability of def.abilities || []) if (ability.type === 'static' && ability.effect?.noMaximumHandSize) return Infinity;
    }
    return this.engine.state.players[playerId]?.maxHandSize ?? 7;
  }

  canPlayerGainLife(playerId) {
    if (Number(this.engine.state.opponentsCantGainLifeUntilTurn?.[playerId] ?? -1) === Number(this.engine.state.turnNumber)) return false;
    for (const [controller, player] of Object.entries(this.engine.state.players)) {
      for (const source of player.battlefield) {
        if (source.phasedOut) continue;
        const definition = this.definitionFor(source);
        for (const ability of definition?.abilities || []) {
          if (ability.type === 'static' && ability.effect?.playersCantGainLife) return false;
          if (ability.type === 'static' && ability.effect?.opponentsCantGainLife && controller !== playerId) return false;
        }
      }
    }
    return true;
  }

  spellGenericCostReduction(playerId, card, definitionOverride = null) {
    let reduction = 0;
    const def = definitionOverride || this.definitionFor(card) || this.engine.db[card?.cardId] || card || {};
    for (const source of this.engine.state.players[playerId]?.battlefield || []) {
      if (source.phasedOut) continue;
      const sourceDef = this.definitionFor(source);
      for (const ability of sourceDef.abilities || []) {
        if (ability.type !== 'static' || !ability.effect?.spellCostReduction) continue;
        const filter = ability.filter || {};
        if (filter.subtype && !hasSubtype(def, filter.subtype)) continue;
        if (Array.isArray(filter.subtypes) && filter.subtypes.length && !filter.subtypes.some(t => hasSubtype(def, t))) continue;
        if (filter.type && !isType(def, filter.type)) continue;
        if (filter.color && !(def.colors || def.colorIdentity || []).includes(filter.color)) continue;
        reduction += Number(ability.effect.spellCostReduction || 0);
      }
    }
    return reduction;
  }

  targetingTax(actorPid, targetIds = []) {
    let tax = 0;
    const uniqueTargets = targetIds.map(id => this.engine.findPermanent(id)).filter(Boolean);
    for (const [controller, player] of Object.entries(this.engine.state.players)) {
      if (controller === actorPid) continue;
      for (const source of player.battlefield) {
        if (source.phasedOut) continue;
        const def = this.definitionFor(source);
        for (const ability of def.abilities || []) {
          if (ability.type !== 'static' || !ability.effect?.targetingTax) continue;
          const filter = ability.filter || {};
          const matches = uniqueTargets.some(target => {
            if (target.controller !== controller) return false;
            if (filter.subtype && !this.hasSubtype(target, filter.subtype)) return false;
            return true;
          });
          if (matches) tax += Number(ability.effect.targetingTax || 0);
        }
      }
    }
    return tax;
  }

  canCastAsFlash(playerId, card) {
    const def = this.engine.db[card?.cardId] || card || {};
    for (const source of this.engine.state.players[playerId]?.battlefield || []) {
      if (source.phasedOut) continue;
      const sourceDef = this.definitionFor(source);
      for (const ability of sourceDef.abilities || []) {
        if (ability.type !== 'static' || !ability.effect?.castAsFlash) continue;
        const filter = ability.filter || {};
        if (filter.subtype && !hasSubtype(def, filter.subtype)) continue;
        if (filter.type && !isType(def, filter.type)) continue;
        return true;
      }
    }
    return false;
  }

  hasRetrace(playerId, card) {
    const def = this.engine.db[card?.cardId] || card || {};
    for (const source of this.engine.state.players[playerId]?.battlefield || []) {
      if (source.phasedOut) continue;
      const sourceDef = this.definitionFor(source);
      for (const ability of sourceDef.abilities || []) {
        if (ability.type !== 'static' || !ability.effect?.grantRetrace) continue;
        const filter = ability.filter || {};
        if (filter.subtype && !hasSubtype(def, filter.subtype)) continue;
        if (Array.isArray(filter.subtypes) && filter.subtypes.length && !filter.subtypes.some(t => hasSubtype(def, t))) continue;
        return true;
      }
    }
    return false;
  }
}
