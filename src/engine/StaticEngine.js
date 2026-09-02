import { hasSubtype, isType } from './utils.js';

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

  devotion(playerId, colors) {
    const wanted = new Set(Array.isArray(colors) ? colors : [colors]);
    let total = 0;
    for (const permanent of this.engine.state.players[playerId]?.battlefield || []) {
      if (permanent.phasedOut) continue;
      const definition = this.engine.db[permanent.cardId] || {};
      for (const symbol of manaSymbols(definition.manaCost || '')) {
        const parts = symbol.split('/');
        if (parts.some(part => wanted.has(part))) total += 1;
      }
    }
    return total;
  }

  isType(permanent, type) {
    if (!permanent || permanent.phasedOut) return false;
    const definition = this.engine.db[permanent.cardId];
    const requestedCreature = String(type).toLowerCase() === 'creature';
    if (permanent.faceDown) return requestedCreature;
    const stationRule = definition?.creatureAtCounter;
    const stationed = requestedCreature && stationRule
      && counterCount(permanent, stationRule.counter || 'charge') >= Number(stationRule.amount || 1);
    if (!isType(definition, type) && !stationed) return false;
    if (!requestedCreature) return true;
    if (stationRule && !stationed) return false;
    const devotionRule = definition?.creatureUnlessDevotion;
    if (!devotionRule || permanent.zone !== 'battlefield') return true;
    return this.devotion(permanent.controller, devotionRule.colors || []) >= Number(devotionRule.threshold || 0);
  }

  hasSubtype(permanent, subtype) {
    if (!permanent || permanent.phasedOut) return false;
    const definition = this.engine.db[permanent.cardId] || {};
    if (hasSubtype(definition, subtype)) return true;
    if (definition.chosenTypeAddsSubtype && permanent.chosenType && permanent.chosenType.toLowerCase() === String(subtype).toLowerCase()) return true;
    if (String(subtype).toLowerCase() === 'island' && counterCount(permanent, 'flood') > 0 && isType(definition, 'Land')) return true;
    return false;
  }

  sharesSubtype(a, b) {
    if (!a || !b) return false;
    const aDef = this.engine.db[a.cardId] || a;
    const bDef = this.engine.db[b.cardId] || b;
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
    const targetDef = this.engine.db[target.cardId];
    if (filter.zone && filter.zone !== 'battlefield') return false;
    if (filter.controller === 'you' && target.controller !== source.controller) return false;
    if (filter.controller === 'opponent' && target.controller === source.controller) return false;
    if (filter.controller && !['you', 'opponent', 'any'].includes(filter.controller) && target.controller !== filter.controller) return false;
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
      const definition = this.engine.db[permanent.cardId] || {};
      if (!isType(definition, 'Legendary')) continue;
      for (const color of colorsFromDefinition(definition)) colors.add(color);
    }
    return colors;
  }

  derivedStats(permanent) {
    const definition = this.engine.db[permanent.cardId] || {};
    let basePower = permanent.faceDown ? 2 : Number(definition?.power || 0);
    let baseToughness = permanent.faceDown ? 2 : Number(definition?.toughness || 0);
    if (definition.dynamicPowerToughness === 'handSize') {
      const count = this.engine.state.players[permanent.controller]?.hand?.length || 0;
      basePower = count;
      baseToughness = count;
    }
    let power = basePower + counterCount(permanent, '+1/+1') - counterCount(permanent, '-1/-1') + Number(permanent.modifiers?.power || 0);
    let toughness = baseToughness + counterCount(permanent, '+1/+1') - counterCount(permanent, '-1/-1') + Number(permanent.modifiers?.toughness || 0);
    const keywords = new Set([...(permanent.faceDown ? [] : (definition?.keywords || [])), ...(permanent.modifiers?.keywords || [])]);

    for (const player of Object.values(this.engine.state.players)) {
      for (const source of player.battlefield) {
        if (source.phasedOut) continue;
        const sourceDef = this.engine.db[source.cardId];
        for (const ability of sourceDef?.abilities || []) {
          if (ability.type !== 'static' || !this._abilityActive(ability, source)) continue;
          if (!this._matchesFilter(ability.filter || {}, source, permanent)) continue;
          if (ability.effect?.power) power += Number(ability.effect.power);
          if (ability.effect?.toughness) toughness += Number(ability.effect.toughness);
          if (ability.effect?.keyword) keywords.add(ability.effect.keyword);
          for (const keyword of ability.effect?.keywords || []) keywords.add(keyword);
          if (ability.effect?.powerToughnessPerLegendaryColor) {
            const count = this._legendaryColors(source.controller, source.instanceId).size;
            power += count;
            toughness += count;
          }
        }
      }
    }
    return { power, toughness, keywords: [...keywords] };
  }

  effectiveAbilities(permanent) {
    const definition = this.engine.db[permanent?.cardId];
    if (permanent?.faceDown) {
      const cost = definition?.manaCost || '';
      return cost ? [{ type: 'activated', cost: { mana: cost }, sorcerySpeed: true, effect: { type: 'turnFaceUp' } }] : [];
    }
    const abilities = structuredClone(definition?.abilities || []).filter(ability => ability.type !== 'static' && ability.type !== 'replacement');
    if (!permanent || permanent.zone !== 'battlefield' || permanent.phasedOut) return abilities;

    for (const player of Object.values(this.engine.state.players)) {
      for (const source of player.battlefield) {
        if (source.phasedOut) continue;
        const sourceDef = this.engine.db[source.cardId];
        for (const ability of sourceDef?.abilities || []) {
          if (ability.type !== 'static' || !ability.effect?.grantAbility || !this._abilityActive(ability, source)) continue;
          if (!this._matchesFilter(ability.filter || {}, source, permanent)) continue;
          abilities.push(structuredClone(ability.effect.grantAbility));
        }
      }
    }

    const seen = new Set();
    return abilities.filter(ability => {
      const key = JSON.stringify(ability);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  maximumHandSize(playerId) {
    for (const source of this.engine.state.players[playerId]?.battlefield || []) {
      if (source.phasedOut) continue;
      const def = this.engine.db[source.cardId] || {};
      if (def.noMaximumHandSize) return Infinity;
      for (const ability of def.abilities || []) if (ability.type === 'static' && ability.effect?.noMaximumHandSize) return Infinity;
    }
    return this.engine.state.players[playerId]?.maxHandSize ?? 7;
  }

  canPlayerGainLife(playerId) {
    for (const [controller, player] of Object.entries(this.engine.state.players)) {
      if (controller === playerId) continue;
      for (const source of player.battlefield) {
        if (source.phasedOut) continue;
        const definition = this.engine.db[source.cardId];
        for (const ability of definition?.abilities || []) {
          if (ability.type === 'static' && ability.effect?.opponentsCantGainLife) return false;
        }
      }
    }
    return true;
  }

  spellGenericCostReduction(playerId, card) {
    let reduction = 0;
    const def = this.engine.db[card?.cardId] || card || {};
    for (const source of this.engine.state.players[playerId]?.battlefield || []) {
      if (source.phasedOut) continue;
      const sourceDef = this.engine.db[source.cardId] || {};
      for (const ability of sourceDef.abilities || []) {
        if (ability.type !== 'static' || !ability.effect?.spellCostReduction) continue;
        const filter = ability.filter || {};
        if (filter.subtype && !hasSubtype(def, filter.subtype)) continue;
        if (Array.isArray(filter.subtypes) && filter.subtypes.length && !filter.subtypes.some(t => hasSubtype(def, t))) continue;
        if (filter.type && !isType(def, filter.type)) continue;
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
        const def = this.engine.db[source.cardId] || {};
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
      const sourceDef = this.engine.db[source.cardId] || {};
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
      const sourceDef = this.engine.db[source.cardId] || {};
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
