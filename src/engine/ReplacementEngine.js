import { hasSubtype, isType } from './utils.js';

export class ReplacementEngine {
  static _matchesFilter(state, db, source, affectedPlayerId, permanent, filter = {}) {
    const def = db[permanent?.cardId];
    if (filter.controller === 'you' && affectedPlayerId !== source.controller) return false;
    if (filter.controller === 'opponent' && affectedPlayerId === source.controller) return false;
    if (filter.controller && !['you', 'opponent', 'any'].includes(filter.controller) && affectedPlayerId !== filter.controller) return false;
    if ((filter.notSelf || filter.other) && permanent?.instanceId === source.instanceId) return false;
    if (filter.type && !isType(def, filter.type)) return false;
    if (filter.subtype && !hasSubtype(def, filter.subtype)) return false;
    if (filter.zone && permanent?.zone !== filter.zone) return false;
    return true;
  }

  static counterReplacements(state, db, affectedPlayerId, permanent, counterType) {
    const out = [];
    for (const player of Object.values(state.players)) {
      for (const source of player.battlefield) {
        const definition = db[source.cardId];
        for (let index = 0; index < (definition?.abilities || []).length; index++) {
          const ability = definition.abilities[index];
          if (ability.type !== 'replacement' || ability.event !== 'COUNTERS_ADDED') continue;
          if (ability.counterType && ability.counterType !== counterType) continue;
          if (!this._matchesFilter(state, db, source, affectedPlayerId, permanent, ability.filter || {})) continue;
          out.push({
            id: `${source.instanceId}:replacement:${index}`,
            sourceInstanceId: source.instanceId,
            sourceCardId: source.cardId,
            controller: source.controller,
            effect: ability.effect,
            ability: structuredClone(ability),
            sourceName: definition?.name || source.cardId
          });
        }
      }
    }
    return out;
  }

  static applyCounterReplacements(amount, replacements, orderIds = null) {
    let ordered = [...replacements];
    if (orderIds) {
      const byId = new Map(replacements.map(replacement => [replacement.id, replacement]));
      ordered = orderIds.map(id => byId.get(id)).filter(Boolean);
    }
    let n = amount;
    for (const replacement of ordered) {
      if (replacement.effect === 'addOne') n += 1;
      if (replacement.effect === 'double') n *= 2;
    }
    return n;
  }

  static modifyCounterAmount(state, db, playerId, permanent, counterType, amount, orderIds = null) {
    const replacements = this.counterReplacements(state, db, playerId, permanent, counterType);
    return this.applyCounterReplacements(amount, replacements, orderIds);
  }

  static modifyTokenAmount(state, db, playerId, tokenType, amount) {
    let n = amount;
    let manufactor = false;
    for (const p of state.players[playerId].battlefield) {
      const d = db[p.cardId];
      for (const a of d?.abilities || []) {
        if (a.type !== 'replacement' || a.event !== 'TOKEN_CREATED') continue;
        if (a.effect === 'double') n *= 2;
        if (a.effect === 'manufactor' && ['Treasure', 'Food', 'Clue'].includes(tokenType)) manufactor = true;
      }
    }
    // Do not return early when Manufactor is encountered. Later token doublers
    // still modify the quantity that Manufactor produces for each utility type.
    return manufactor ? { manufactor: n } : n;
  }
}
