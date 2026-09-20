import { hasSubtype } from '../utils.js';
import { TRIGGER_KIND } from './TriggerDefinition.js';
import { matchesTargetFilter } from '../choices/TargetFilter.js';


function definitionForObject(engine, object) {
  if (!object?.cardId) return {};
  return engine.copy?.definitionForObject(object) || engine.db[object.cardId] || {};
}

function eventObject(payload = {}) {
  return payload.object || payload.target || payload.card || payload.source || null;
}


function objectCandidate(engine, object, fallbackZone = null) {
  if (!object) return null;
  const cardId = object.cardId;
  return {
    id: object.instanceId || object.gameObjectId,
    kind: object.zone === 'battlefield' ? 'permanent' : 'card',
    zone: object.zone || fallbackZone,
    controller: object.controller,
    owner: object.owner,
    card: object,
    definition: cardId ? definitionForObject(engine, object) : null
  };
}

function affectedCandidate(engine, payload = {}) {
  const object = eventObject(payload);
  if (object?.cardId || object?.instanceId || object?.gameObjectId) {
    return objectCandidate(engine, object, payload.toZone || payload.fromZone || null);
  }
  const playerId = payload.targetPlayer || payload.playerId || payload.affectedPlayer || null;
  if (playerId && engine.state.players[playerId]) {
    return {
      id: playerId,
      kind: 'player',
      zone: null,
      controller: playerId,
      owner: playerId,
      card: null,
      definition: null
    };
  }
  return null;
}

function sourceZoneAllowed(definition, source) {
  const zones = definition.sourceZones || ['battlefield'];
  if (zones.includes('any')) return true;
  return zones.includes(source?.zone);
}

export class TriggerMatcher {
  constructor(engine, registry) {
    this.engine = engine;
    this.registry = registry;
  }

  sourceCandidates(payload = {}) {
    const out = [];
    const seenObjects = new Set();
    for (const [controller, player] of Object.entries(this.engine.state.players)) {
      for (const permanent of player.battlefield || []) {
        const key = permanent.gameObjectId || permanent.instanceId;
        if (seenObjects.has(key)) continue;
        seenObjects.add(key);
        out.push({ source: permanent, controller, viaLki: false });
      }

      // Triggered abilities normally function on the battlefield, but a card
      // script may explicitly declare another source zone. Only those explicit
      // declarations are inspected outside the battlefield so hidden-zone
      // cards do not accidentally gain battlefield-style abilities.
      for (const zone of ['graveyard', 'exile', 'command', 'hand', 'library']) {
        for (const card of player[zone] || []) {
          const abilities = definitionForObject(this.engine, card).abilities || [];
          const hasZoneTrigger = abilities.some(ability => {
            if (ability?.type !== 'triggered') return false;
            const declared = ability.sourceZones ?? ability.sourceZone;
            if (declared == null) return false;
            const zones = Array.isArray(declared) ? declared : [declared];
            return zones.includes(zone) || zones.includes('any');
          });
          if (!hasZoneTrigger) continue;
          const key = card.gameObjectId || card.instanceId;
          if (seenObjects.has(key)) continue;
          seenObjects.add(key);
          out.push({ source: card, controller: card.controller || card.owner || controller, viaLki: false });
        }
      }
    }

    // Spells may themselves have triggered abilities that function while the
    // spell is on the stack (for example, "when you cast this spell"). Only
    // definitions that explicitly declare the stack as a source zone are
    // inspected here.
    for (const item of this.engine.state.stack || []) {
      const card = item?.card;
      if (!card?.cardId) continue;
      const abilities = definitionForObject(this.engine, card).abilities || [];
      const hasStackTrigger = abilities.some(ability => {
        if (ability?.type !== 'triggered') return false;
        const declared = ability.sourceZones ?? ability.sourceZone;
        if (declared == null) return false;
        const zones = Array.isArray(declared) ? declared : [declared];
        return zones.includes('stack') || zones.includes('any');
      });
      if (!hasStackTrigger) continue;
      const key = card.gameObjectId || card.instanceId;
      if (seenObjects.has(key)) continue;
      seenObjects.add(key);
      out.push({ source: card, controller: item.controller || card.controller || card.owner, viaLki: false });
    }

    // Leaves/dies triggers see the source as it existed immediately before
    // leaving the battlefield. Step 8 provides this snapshot on the event.
    const lkiObject = payload.object || (payload.lkiId ? this.engine.lki.get(payload.lkiId)?.object : null);
    if (lkiObject?.instanceId && payload.fromZone === 'battlefield') {
      const key = lkiObject.gameObjectId || lkiObject.instanceId;
      if (!seenObjects.has(key)) {
        out.push({
          source: structuredClone(lkiObject),
          controller: payload.controller || lkiObject.controller || lkiObject.owner,
          viaLki: true
        });
      }
    }
    return out;
  }

  matchCondition(condition = {}, payload = {}, controller, source) {
    const e = this.engine;
    const obj = eventObject(payload);
    if (condition.controllerEvent && payload.controller !== controller) return false;
    if (condition.eventController === 'opponent' && !e.areOpponents(controller, payload.controller)) return false;
    if ((condition.sourceEvent || condition.selfEvent) && obj?.instanceId !== source?.instanceId) return false;
    if (condition.notSelfEvent && obj?.instanceId === source?.instanceId) return false;
    if (condition.sourceSubtype) {
      const def = definitionForObject(e, obj);
      const matched = obj?.zone === 'battlefield' && e.findPermanent(obj.instanceId)
        ? e.static.hasSubtype(e.findPermanent(obj.instanceId), condition.sourceSubtype)
        : hasSubtype(def, condition.sourceSubtype);
      if (!matched) return false;
    }
    if (condition.spellSubtype) {
      const def = definitionForObject(e, payload.card);
      if (!hasSubtype(def, condition.spellSubtype)) return false;
    }
    if (condition.notToken && obj?.isToken) return false;
    if (condition.type) {
      const def = definitionForObject(e, obj);
      if (!(def?.typeLine || '').toLowerCase().includes(String(condition.type).toLowerCase())) return false;
    }
    if (condition.cardType) {
      const def = definitionForObject(e, payload.card || obj);
      if (!(def?.typeLine || '').toLowerCase().includes(String(condition.cardType).toLowerCase())) return false;
    }
    if (condition.cardTypeNot) {
      const def = definitionForObject(e, payload.card);
      if ((def?.typeLine || '').toLowerCase().includes(String(condition.cardTypeNot).toLowerCase())) return false;
    }
    if (condition.yourTurn && e.state.activePlayer !== controller) return false;
    if (condition.firstDrawThisTurn && !payload.firstDrawThisTurn) return false;
    if (condition.phase && payload.phase !== condition.phase) return false;
    if (condition.sourceAttacking && !(payload.attackers || []).includes(source?.instanceId)) return false;
    if (condition.exactlyOneAttacker && (payload.attackers || []).length !== 1) return false;
    if (condition.eventTargetHasCounter && Number(obj?.counters?.[condition.eventTargetHasCounter] || 0) <= 0) return false;
    if (condition.eventCounterType && payload.counterType !== condition.eventCounterType) return false;
    if (condition.controllerOtherCreatureWithCounter) {
      const player = e.state.players[controller];
      const hasOther = player?.battlefield?.some(card => card.instanceId !== source?.instanceId
        && e.static.isType(card, 'Creature')
        && Number(card.counters?.[condition.controllerOtherCreatureWithCounter] || 0) > 0);
      if (!hasOther) return false;
    }
    if (condition.sourceCounterAtLeast) {
      const rule = condition.sourceCounterAtLeast;
      const liveSource = e.findPermanent(source?.instanceId) || source;
      if (Number(liveSource?.counters?.[rule.counter] || 0) < Number(rule.amount || 0)) return false;
    }
    if (condition.eventTargetController === 'you' && obj?.controller !== controller) return false;
    if (condition.exploredLand === true && !payload.revealedLand) return false;
    if (condition.exploredLand === false && payload.revealedLand) return false;
    if (condition.sourceManaSpent && !(payload.manaSourceIds || []).includes(source?.instanceId)) return false;
    if (condition.spellSharesCommanderType) {
      const spellDef = definitionForObject(e, payload.card);
      const commander = e.state.players[controller]?.command?.[0] || e.state.players[controller]?.battlefield?.find(c => c.isCommander);
      const commanderDef = definitionForObject(e, commander);
      if (!(commanderDef.subtypes || []).some(type => hasSubtype(spellDef, type))) return false;
    }
    if (condition.spellSharesChosenType) {
      const spellDef = definitionForObject(e, payload.card);
      if (!source?.chosenType || !hasSubtype(spellDef, source.chosenType)) return false;
    }
    if (condition.eventSharesChosenType) {
      const eventDef = definitionForObject(e, obj);
      if (!source?.chosenType || !hasSubtype(eventDef, source.chosenType)) return false;
    }
    if (condition.castModePrefix && !String(obj?.castMode || payload.castMode || '').startsWith(condition.castModePrefix)) return false;
    if (condition.encoreSacrificeDue && Number(source?.encoreSacrificeTurn) !== Number(e.state.turn)) return false;
    if (condition.controllerPermanentCardsInGraveyardAtLeast != null) {
      const count = (e.state.players[controller]?.graveyard || []).filter(card => {
        const definition = definitionForObject(e, card);
        return !String(definition.typeLine || '').toLowerCase().includes('instant')
          && !String(definition.typeLine || '').toLowerCase().includes('sorcery');
      }).length;
      if (count < Number(condition.controllerPermanentCardsInGraveyardAtLeast)) return false;
    }
    return true;
  }

  matches(definition, eventType, payload, controller, source) {
    if (!definition.eventPattern.includes(eventType)) return false;
    if (definition.controller && definition.controller !== controller) return false;
    if (!sourceZoneAllowed(definition, source)) return false;
    if (definition.sourceCardId && source?.cardId !== definition.sourceCardId) return false;
    if (definition.sourceObjectId && ![source?.instanceId, source?.gameObjectId].includes(definition.sourceObjectId)) return false;
    if (definition.controllerRelation === 'event-controller' && payload.controller !== controller) return false;

    if (definition.sourceFilter) {
      const candidate = objectCandidate(this.engine, source);
      if (!candidate || !matchesTargetFilter(this.engine, controller, candidate, definition.sourceFilter, { sourceObject: source, eventPayload: payload })) {
        return false;
      }
    }
    if (definition.affectedFilter) {
      const candidate = affectedCandidate(this.engine, payload);
      if (!candidate || !matchesTargetFilter(this.engine, controller, candidate, definition.affectedFilter, { sourceObject: source, eventPayload: payload })) {
        return false;
      }
    }
    return this.matchCondition(definition.condition || {}, payload, controller, source);
  }

  matchEvent(eventType, payload = {}) {
    const matches = [];
    // Step 38: source definitions are indexed by event type and rebuilt only
    // when source topology changes. Predicate/condition checks remain dynamic.
    for (const { source, controller, viaLki, definition } of this.registry.indexedSourcesForEvent(eventType)) {
      if (!this.matches(definition, eventType, payload, controller, source)) continue;
      matches.push({ definition, source, controller, viaLki });
    }

    // A source that just left the battlefield may no longer be present in the
    // post-commit index. Re-introduce its LKI definition for leave/dies events.
    const lkiObject = payload.object || (payload.lkiId ? this.engine.lki.get(payload.lkiId)?.object : null);
    if (lkiObject?.instanceId && payload.fromZone === 'battlefield') {
      const controller = payload.controller || lkiObject.controller || lkiObject.owner;
      for (const definition of this.registry.cardDefinitionsFor(lkiObject)) {
        if (!(definition.eventPattern || []).includes(eventType)) continue;
        const adjusted = definition.sourceZones.includes('battlefield')
          ? { ...definition, sourceZones: ['battlefield', lkiObject.zone] }
          : definition;
        if (!this.matches(adjusted, eventType, payload, controller, lkiObject)) continue;
        const duplicate = matches.some(match => match.definition.definitionId === definition.definitionId
          && (match.source?.gameObjectId || match.source?.instanceId) === (lkiObject.gameObjectId || lkiObject.instanceId));
        if (!duplicate) matches.push({ definition, source: structuredClone(lkiObject), controller, viaLki: true });
      }
    }

    for (const definition of this.registry.temporaryDefinitions()) {
      if (!definition.eventPattern.includes(eventType)) continue;
      const source = definition.sourceSnapshot
        || (definition.sourceObjectId ? this.engine._queryObject(definition.sourceObjectId) : null)
        || (definition.sourceInstanceId ? this.engine._queryObject(definition.sourceInstanceId) : null)
        || null;
      const controller = definition.controller || source?.controller || source?.owner || payload.controller || this.engine.state.activePlayer;
      if (!this.matches({ ...definition, sourceZones: ['any'] }, eventType, payload, controller, source)) continue;
      matches.push({ definition, source, controller, viaLki: !!definition.sourceSnapshot });
    }
    return matches;
  }

  interveningIfHolds(definition, controller, source, eventPayload = {}) {
    if (!definition?.interveningIf) return true;
    return this.matchCondition(definition.interveningIf, eventPayload, controller, source);
  }
}
