import { ReplacementEffect } from './ReplacementEffect.js';
import { ENGINE_EVENT } from '../events/EventTypes.js';
import { hasSubtype, isType } from '../utils.js';

const LEGACY_REPLACEMENT_EVENT_MAP = Object.freeze({
  COUNTERS_ADDED: ENGINE_EVENT.ADD_COUNTER,
  TOKEN_CREATED: ENGINE_EVENT.CREATE_TOKEN,
  DRAW_CARD: ENGINE_EVENT.DRAW_CARD,
  LIFE_GAIN: ENGINE_EVENT.GAIN_LIFE,
  LIFE_LOSS: ENGINE_EVENT.LOSE_LIFE,
  MOVE_ZONE: ENGINE_EVENT.MOVE_ZONE,
  DAMAGE: ENGINE_EVENT.DEAL_DAMAGE
});

function replacementEventType(ability = {}) {
  return LEGACY_REPLACEMENT_EVENT_MAP[ability.event] || ability.event || null;
}

export class ReplacementRegistry {
  constructor(engine) {
    this.engine = engine;
    this.registered = new Map();
    this.registeredByEvent = new Map();
    this.cardAbilityIndex = new Map();
    this.cardAbilityIndexRevision = -1;
  }

  register(definition) {
    const effect = definition instanceof ReplacementEffect ? definition : new ReplacementEffect(definition);
    this.registered.set(effect.id, effect);
    for (const eventType of effect.eventTypes) {
      const bucket = this.registeredByEvent.get(eventType) || new Set();
      bucket.add(effect.id);
      this.registeredByEvent.set(eventType, bucket);
    }
    return () => {
      this.registered.delete(effect.id);
      for (const eventType of effect.eventTypes) {
        const bucket = this.registeredByEvent.get(eventType);
        bucket?.delete(effect.id);
        if (bucket && !bucket.size) this.registeredByEvent.delete(eventType);
      }
    };
  }

  _indexRevision() {
    const revision = Number(this.engine.performance?.topologyRevision ?? 0);
    const fingerprint = this.engine.performance?.sourceTopologyFingerprint?.({ battlefieldOnly: true }) || '';
    return `${revision}:${fingerprint}`;
  }

  _rebuildCardAbilityIndex() {
    const byEvent = new Map();
    for (const player of Object.values(this.engine.state.players)) {
      for (const source of player.battlefield || []) {
        if (source.phasedOut) continue;
        const definition = this.engine.copy?.definitionForObject(source) || this.engine.db[source.cardId];
        for (let abilityIndex = 0; abilityIndex < (definition?.abilities || []).length; abilityIndex++) {
          const ability = definition.abilities[abilityIndex];
          if (ability.type !== 'replacement') continue;
          const eventType = replacementEventType(ability);
          if (!eventType) continue;
          const bucket = byEvent.get(eventType) || [];
          bucket.push({ source, definition, ability, abilityIndex });
          byEvent.set(eventType, bucket);
        }
      }
    }
    this.cardAbilityIndex = byEvent;
    this.cardAbilityIndexRevision = this._indexRevision();
  }

  _cardRowsFor(eventType) {
    if (this.cardAbilityIndexRevision !== this._indexRevision()) {
      this.engine.performance?.profiler?.measure?.('replacement-index.rebuild', () => this._rebuildCardAbilityIndex());
    }
    return this.cardAbilityIndex.get(eventType) || [];
  }

  _matchesAbilityFilter(source, affectedPlayerId, target, ability = {}, eventPayload = {}) {
    const filter = ability.filter || {};
    const targetDefinition = target?.cardId ? (this.engine.copy?.definitionForObject(target) || this.engine.db[target.cardId]) : null;
    if (filter.controller && filter.controller !== 'any') {
      if (this.engine.multiplayer?.matches) {
        if (!this.engine.multiplayer.matches(filter.controller, affectedPlayerId, { actorPlayerId: source.controller, sourceObject: source })) return false;
      } else {
        if (filter.controller === 'you' && affectedPlayerId !== source.controller) return false;
        if (filter.controller === 'opponent' && affectedPlayerId === source.controller) return false;
        if (!['you', 'opponent'].includes(filter.controller) && affectedPlayerId !== filter.controller) return false;
      }
    }
    if (filter.self && target?.instanceId !== source.instanceId) return false;
    if ((filter.notSelf || filter.other) && target?.instanceId === source.instanceId) return false;
    if (filter.type && !isType(targetDefinition, filter.type)) return false;
    if (filter.subtype && !hasSubtype(targetDefinition, filter.subtype)) return false;
    if (Array.isArray(filter.subtypes) && filter.subtypes.length && !filter.subtypes.some(subtype => hasSubtype(targetDefinition, subtype))) return false;
    if (filter.zone && target?.zone !== filter.zone) return false;
    if (filter.fromZone && eventPayload?.fromZone !== filter.fromZone) return false;
    if (filter.toZone && eventPayload?.toZone !== filter.toZone) return false;
    if (filter.counterType && eventPayload?.counterType !== filter.counterType) return false;
    return true;
  }

  _cardEffectsFor(event) {
    const engine = this.engine;
    const affectedPlayerId = engine.replacements.inferAffectedPlayer(event);
    const target = engine.replacements.inferAffectedObject(event);
    const effects = [];
    const rows = [...this._cardRowsFor(event.type)];
    // A permanent's own replacement effect can modify how that object enters
    // the battlefield even though the source is not on the battlefield yet.
    // Pull self-scoped MOVE_ZONE replacements from the moving object's
    // definition and merge them with battlefield-sourced replacements.
    if (event.type === ENGINE_EVENT.MOVE_ZONE && target && event.payload?.toZone === 'battlefield') {
      const enteringDefinition = target?.cardId ? (engine.copy?.definitionForObject(target) || engine.db[target.cardId]) : null;
      for (let abilityIndex = 0; abilityIndex < (enteringDefinition?.abilities || []).length; abilityIndex++) {
        const ability = enteringDefinition.abilities[abilityIndex];
        if (ability?.type !== 'replacement' || !ability?.filter?.self || replacementEventType(ability) !== event.type) continue;
        if (!rows.some(row => row.source?.instanceId === target.instanceId && row.abilityIndex === abilityIndex)) rows.push({ source: target, definition: enteringDefinition, ability, abilityIndex });
      }
    }
    for (const { source, definition, ability, abilityIndex } of rows) {
      const predicate = (candidateEvent) => {
        if (ability.counterType && candidateEvent.payload?.counterType !== ability.counterType) return false;
        if (ability.event === 'TOKEN_CREATED' && ability.effect === 'manufactor') {
          const name = candidateEvent.payload?.tokenDefinition?.name || candidateEvent.payload?.tokenBatches?.[0]?.tokenDefinition?.name;
          if (!['Treasure', 'Food', 'Clue'].includes(name)) return false;
        }
        return this._matchesAbilityFilter(source, affectedPlayerId, target, ability, candidateEvent.payload || {});
      };
      const effect = ReplacementEffect.fromCardAbility({ source, definition, ability, abilityIndex, predicate });
      if (effect.applies(event, engine)) effects.push(effect);
    }
    return effects;
  }

  applicable(event) {
    const ids = this.registeredByEvent.get(event.type) || new Set();
    const programmatic = [...ids].map(id => this.registered.get(id)).filter(Boolean).filter(effect => effect.applies(event, this.engine));
    return [...programmatic, ...this._cardEffectsFor(event)];
  }

  list() {
    return [...this.registered.values()].map(effect => ({ id: effect.id, eventTypes: [...effect.eventTypes], sourceName: effect.sourceName }));
  }
}
