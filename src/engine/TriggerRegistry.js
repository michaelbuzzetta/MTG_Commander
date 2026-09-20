import { createTriggerDefinition, definitionFromCardAbility, TRIGGER_KIND } from './TriggerDefinition.js';

export class TriggerRegistry {
  constructor(engine) {
    this.engine = engine;
    this._eventSourceIndex = new Map();
    this._eventSourceIndexRevision = -1;
    this.ensureState();
  }

  ensureState() {
    this.engine.state.triggerRegistrations ||= [];
    return this.engine.state.triggerRegistrations;
  }

  cardDefinitionsFor(source) {
    if (!source?.cardId) return [];
    const definition = this.engine.copy?.definitionForObject(source) || this.engine.db[source.cardId] || {};
    const effectiveCardId = definition.id || source.cardId;
    const printed = (definition.abilities || [])
      .map((ability, index) => definitionFromCardAbility(effectiveCardId, ability, index))
      .filter(Boolean);
    const mechanicGenerated = (this.engine.mechanics?.triggerDefinitionsFor(source) || [])
      .map(fields => createTriggerDefinition(fields));
    return [...printed, ...mechanicGenerated];
  }


  _indexRevision() {
    const revision = Number(this.engine.performance?.topologyRevision ?? 0);
    const fingerprint = this.engine.performance?.sourceTopologyFingerprint?.() || '';
    return `${revision}:${fingerprint}`;
  }

  _sourceZoneAllowed(definition, zone) {
    const zones = definition?.sourceZones || ['battlefield'];
    return zones.includes('any') || zones.includes(zone);
  }

  _buildEventSourceIndex() {
    const byEvent = new Map();
    const push = (source, controller, zone) => {
      if (!source?.cardId) return;
      for (const definition of this.cardDefinitionsFor(source)) {
        if (!this._sourceZoneAllowed(definition, zone)) continue;
        for (const eventType of definition.eventPattern || []) {
          const bucket = byEvent.get(eventType) || [];
          bucket.push({ source, controller, viaLki: false, definition });
          byEvent.set(eventType, bucket);
        }
      }
    };

    const seen = new Set();
    for (const [fallbackController, player] of Object.entries(this.engine.state.players)) {
      for (const source of player.battlefield || []) {
        const key = source.gameObjectId || source.instanceId;
        if (seen.has(key)) continue;
        seen.add(key);
        push(source, source.controller || source.owner || fallbackController, 'battlefield');
      }
      for (const zone of ['graveyard', 'exile', 'command', 'hand', 'library']) {
        for (const source of player[zone] || []) {
          const definition = this.engine.copy?.definitionForObject(source) || this.engine.db[source.cardId] || {};
          const hasZoneTrigger = (definition.abilities || []).some(ability => {
            if (ability?.type !== 'triggered') return false;
            const declared = ability.sourceZones ?? ability.sourceZone;
            if (declared == null) return false;
            const zones = Array.isArray(declared) ? declared : [declared];
            return zones.includes(zone) || zones.includes('any');
          });
          if (!hasZoneTrigger) continue;
          const key = source.gameObjectId || source.instanceId;
          if (seen.has(key)) continue;
          seen.add(key);
          push(source, source.controller || source.owner || fallbackController, zone);
        }
      }
    }
    for (const item of this.engine.state.stack || []) {
      const source = item?.card;
      if (!source?.cardId) continue;
      const definition = this.engine.copy?.definitionForObject(source) || this.engine.db[source.cardId] || {};
      const hasStackTrigger = (definition.abilities || []).some(ability => {
        if (ability?.type !== 'triggered') return false;
        const declared = ability.sourceZones ?? ability.sourceZone;
        if (declared == null) return false;
        const zones = Array.isArray(declared) ? declared : [declared];
        return zones.includes('stack') || zones.includes('any');
      });
      if (!hasStackTrigger) continue;
      const key = source.gameObjectId || source.instanceId;
      if (seen.has(key)) continue;
      seen.add(key);
      push(source, item.controller || source.controller || source.owner, 'stack');
    }
    this._eventSourceIndex = byEvent;
    this._eventSourceIndexRevision = this._indexRevision();
  }

  indexedSourcesForEvent(eventType) {
    const revision = this._indexRevision();
    if (this._eventSourceIndexRevision !== revision) {
      this.engine.performance?.profiler?.measure?.('trigger-index.rebuild', () => this._buildEventSourceIndex());
    }
    return this._eventSourceIndex.get(eventType) || [];
  }

  temporaryDefinitions() {
    return this.ensureState().map(record => createTriggerDefinition(record));
  }

  registerTemporary(fields) {
    const definition = createTriggerDefinition({
      ...fields,
      createdTurn: fields.createdTurn ?? this.engine.state.turn,
      createdPhase: fields.createdPhase ?? this.engine.state.phase
    });
    this.ensureState().push(structuredClone(definition));
    return structuredClone(definition);
  }

  registerDelayed(fields) {
    return this.registerTemporary({ ...fields, kind: TRIGGER_KIND.DELAYED });
  }

  registerReflexive(fields) {
    return this.registerTemporary({ ...fields, kind: TRIGGER_KIND.REFLEXIVE });
  }

  remove(definitionId) {
    const list = this.ensureState();
    const index = list.findIndex(def => def.definitionId === definitionId);
    if (index < 0) return false;
    list.splice(index, 1);
    return true;
  }

  markFired(definition) {
    if (definition?.kind === TRIGGER_KIND.NORMAL) return;
    if (definition?.expiresAfterFire !== false) this.remove(definition.definitionId);
  }

  expireForEvent(eventType) {
    const state = this.engine.state;
    const list = this.ensureState();
    for (let index = list.length - 1; index >= 0; index--) {
      const definition = list[index];
      const eventExpired = definition.expiresAtEvent && definition.expiresAtEvent === eventType;
      const turnExpired = definition.expiresAtTurn != null && Number(state.turn) > Number(definition.expiresAtTurn);
      const phaseExpired = definition.expiresAtTurn != null
        && Number(state.turn) === Number(definition.expiresAtTurn)
        && definition.expiresAtPhase
        && state.phase === definition.expiresAtPhase
        && definition.createdPhase !== state.phase;
      if (eventExpired || turnExpired || phaseExpired) list.splice(index, 1);
    }
  }
}
