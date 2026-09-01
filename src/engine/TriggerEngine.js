import { uid, hasSubtype } from './utils.js';

export class TriggerEngine {
  constructor(engine) { this.engine = engine; }

  _eventObject(payload = {}) {
    return payload.object || payload.target || payload.card || payload.source || null;
  }

  _sourceCandidates(payload = {}) {
    const out = [];
    const seen = new Set();
    for (const [controller, player] of Object.entries(this.engine.state.players)) {
      for (const permanent of player.battlefield) {
        seen.add(permanent.instanceId);
        out.push({ source: permanent, controller });
      }
    }

    // Leaves/dies triggers need the abilities and controller the object had immediately
    // before it left. Category 5 events already carry that last-known object snapshot.
    const lki = payload.object;
    if (lki?.instanceId && payload.fromZone === 'battlefield' && !seen.has(lki.instanceId)) {
      out.push({ source: lki, controller: payload.controller || lki.controller || lki.owner });
    }
    return out;
  }

  collect(event, payload = {}) {
    const s = this.engine.state;
    const batchId = uid('trigger-batch');
    for (const { source, controller } of this._sourceCandidates(payload)) {
      const definition = this.engine.db[source.cardId];
      for (const ability of definition?.abilities || []) {
        if (ability.type !== 'triggered' || ability.event !== event) continue;
        if (!this.matches(ability, payload, controller, source)) continue;
        s.pendingTriggers.push({
          id: uid('trg'),
          batchId,
          event,
          source,
          sourceInstanceId: source.instanceId,
          controller,
          ability: structuredClone(ability),
          effect: structuredClone(ability.effect),
          optional: !!ability.optional,
          optionalDecision: ability.optional ? null : true,
          orderIndex: null,
          targets: null,
          eventPayload: structuredClone(payload),
          stacked: false
        });
      }
    }
  }

  matches(ability, payload, controller, source) {
    const condition = ability.condition || {};
    const eventObject = this._eventObject(payload);
    if (condition.controllerEvent && payload.controller !== controller) return false;
    if ((condition.sourceEvent || condition.selfEvent) && eventObject?.instanceId !== source.instanceId) return false;
    if (condition.notSelfEvent && eventObject?.instanceId === source.instanceId) return false;
    if (condition.sourceSubtype) {
      const definition = this.engine.db[eventObject?.cardId];
      const matchesSubtype = eventObject?.zone === 'battlefield'
        ? this.engine.static.hasSubtype(eventObject, condition.sourceSubtype)
        : hasSubtype(definition, condition.sourceSubtype);
      if (!matchesSubtype) return false;
    }
    if (condition.spellSubtype) {
      const definition = this.engine.db[payload.card?.cardId];
      if (!hasSubtype(definition, condition.spellSubtype)) return false;
    }
    if (condition.notToken && eventObject?.isToken) return false;
    if (condition.type) {
      const definition = this.engine.db[eventObject?.cardId];
      if (!(definition?.typeLine || '').toLowerCase().includes(String(condition.type).toLowerCase())) return false;
    }
    if (condition.cardType) {
      const definition = this.engine.db[payload.card?.cardId];
      if (!(definition?.typeLine || '').toLowerCase().includes(String(condition.cardType).toLowerCase())) return false;
    }
    if (condition.cardTypeNot) {
      const definition = this.engine.db[payload.card?.cardId];
      if ((definition?.typeLine || '').toLowerCase().includes(String(condition.cardTypeNot).toLowerCase())) return false;
    }
    if (condition.yourTurn && this.engine.state.activePlayer !== controller) return false;
    if (condition.firstDrawThisTurn && !payload.firstDrawThisTurn) return false;
    if (condition.phase && payload.phase !== condition.phase) return false;
    if (condition.sourceAttacking && !(payload.attackers || []).includes(source.instanceId)) return false;
    if (condition.eventTargetHasCounter && Number(eventObject?.counters?.[condition.eventTargetHasCounter] || 0) <= 0) return false;
    if (condition.eventCounterType && payload.counterType !== condition.eventCounterType) return false;
    if (condition.controllerOtherCreatureWithCounter) {
      const player = this.engine.state.players[controller];
      const hasOther = player?.battlefield?.some(card => card.instanceId !== source.instanceId
        && this.engine.static.isType(card, 'Creature')
        && Number(card.counters?.[condition.controllerOtherCreatureWithCounter] || 0) > 0);
      if (!hasOther) return false;
    }
    if (condition.sourceCounterAtLeast) {
      const rule = condition.sourceCounterAtLeast;
      if (Number(source.counters?.[rule.counter] || 0) < Number(rule.amount || 0)) return false;
    }
    if (condition.eventTargetController === 'you' && eventObject?.controller !== controller) return false;
    if (condition.exploredLand === true && !payload.revealedLand) return false;
    if (condition.exploredLand === false && payload.revealedLand) return false;
    if (condition.sourceManaSpent && !(payload.manaSourceIds || []).includes(source.instanceId)) return false;
    if (condition.spellSharesCommanderType) {
      const spellDef = this.engine.db[payload.card?.cardId] || {};
      const commander = this.engine.state.players[controller]?.command?.[0] || this.engine.state.players[controller]?.battlefield?.find(c => c.isCommander);
      const commanderDef = this.engine.db[commander?.cardId] || {};
      if (!(commanderDef.subtypes || []).some(type => hasSubtype(spellDef, type))) return false;
    }
    if (condition.spellSharesChosenType) {
      const spellDef = this.engine.db[payload.card?.cardId] || {};
      if (!source.chosenType || !hasSubtype(spellDef, source.chosenType)) return false;
    }
    if (condition.eventSharesChosenType) {
      const eventDef = this.engine.db[eventObject?.cardId] || {};
      if (!source.chosenType || !hasSubtype(eventDef, source.chosenType)) return false;
    }
    if (condition.castModePrefix && !String(eventObject?.castMode || payload.castMode || '').startsWith(condition.castModePrefix)) return false;
    if (condition.encoreSacrificeDue && Number(source.encoreSacrificeTurn) !== Number(this.engine.state.turn)) return false;
    return true;
  }

  _batch(batchId) {
    return this.engine.state.pendingTriggers.filter(trigger => trigger.batchId === batchId);
  }

  _choiceResume() {
    return this.engine.state.phase === 'CLEANUP' ? 'CLEANUP' : 'PRIORITY';
  }

  chooseOptional(triggerId, accept) {
    const trigger = this.engine.state.pendingTriggers.find(item => item.id === triggerId);
    if (!trigger || !trigger.optional) throw new Error('Optional trigger is no longer pending');
    trigger.optionalDecision = !!accept;
    this.engine.state.pendingChoice = null;
    this.flush();
    return !!accept;
  }

  orderTriggers(triggerIds) {
    const choice = this.engine.state.pendingChoice;
    if (!choice || choice.type !== 'TRIGGER_ORDER') throw new Error('No trigger-order choice is pending');
    const expected = choice.triggerIds;
    if (!Array.isArray(triggerIds) || triggerIds.length !== expected.length || new Set(triggerIds).size !== triggerIds.length) {
      throw new Error('Order every simultaneous trigger exactly once');
    }
    if (triggerIds.some(id => !expected.includes(id))) throw new Error('Trigger order contains an invalid trigger');
    triggerIds.forEach((id, index) => {
      const trigger = this.engine.state.pendingTriggers.find(item => item.id === id);
      if (trigger) trigger.orderIndex = index;
    });
    this.engine.state.pendingChoice = null;
    this.flush();
    return triggerIds;
  }

  chooseTargets(triggerId, targetIds) {
    const trigger = this.engine.state.pendingTriggers.find(item => item.id === triggerId);
    if (!trigger) throw new Error('Triggered ability is no longer pending');
    this.engine.targeting.validateTargets(trigger.controller, trigger.ability, targetIds, { sourceObject: trigger.source });
    trigger.targets = [...targetIds];
    this.engine.state.pendingChoice = null;
    this.flush();
    return targetIds;
  }

  flush() {
    const s = this.engine.state;
    if (s.pendingChoice) return;

    while (s.pendingTriggers.length) {
      const batchId = s.pendingTriggers[0].batchId;
      const batch = this._batch(batchId);

      const undecided = batch.find(trigger => trigger.optional && trigger.optionalDecision == null);
      if (undecided) {
        s.pendingChoice = {
          type: 'OPTIONAL_TRIGGER',
          playerId: undecided.controller,
          triggerId: undecided.id,
          batchId,
          sourceName: this.engine.db[undecided.source?.cardId]?.name || 'Triggered ability',
          event: undecided.event,
          resume: this._choiceResume()
        };
        s.priorityPlayer = undecided.controller;
        return;
      }

      const accepted = batch.filter(trigger => trigger.optionalDecision !== false && !trigger.stacked);
      const apnap = [s.activePlayer, ...Object.keys(s.players).filter(id => id !== s.activePlayer)];
      for (const controller of apnap) {
        const controlled = accepted.filter(trigger => trigger.controller === controller);
        if (!controlled.length) continue;

        if (controlled.length > 1 && controlled.some(trigger => trigger.orderIndex == null)) {
          s.pendingChoice = {
            type: 'TRIGGER_ORDER',
            playerId: controller,
            batchId,
            triggerIds: controlled.map(trigger => trigger.id),
            triggers: controlled.map(trigger => ({
              id: trigger.id,
              sourceName: this.engine.db[trigger.source?.cardId]?.name || 'Triggered ability',
              event: trigger.event
            })),
            resume: this._choiceResume()
          };
          s.priorityPlayer = controller;
          return;
        }

        const ordered = [...controlled].sort((a, b) => {
          if (a.orderIndex == null && b.orderIndex == null) return 0;
          if (a.orderIndex == null) return 1;
          if (b.orderIndex == null) return -1;
          return a.orderIndex - b.orderIndex;
        });
        for (const trigger of ordered) {
          if (this.engine.targeting.hasTargets(trigger.ability) && trigger.targets == null) {
            const targetSets = this.engine.targeting.generateTargetSets(trigger.controller, trigger.ability, { sourceObject: trigger.source });
            if (!targetSets.length) {
              trigger.stacked = true;
              continue;
            }
            if (targetSets.length === 1) {
              trigger.targets = [...targetSets[0]];
            } else {
              const bounds = this.engine.targeting.bounds(trigger.ability);
              const candidateIds = [...new Set(targetSets.flat())];
              s.pendingChoice = {
                type: 'TRIGGER_TARGET',
                playerId: trigger.controller,
                triggerId: trigger.id,
                sourceName: this.engine.db[trigger.source?.cardId]?.name || 'Triggered ability',
                candidateIds,
                minTargets: bounds.min,
                maxTargets: bounds.max,
                resume: this._choiceResume()
              };
              s.priorityPlayer = trigger.controller;
              return;
            }
          }
          s.stack.push({
            id: trigger.id,
            type: 'trigger',
            controller: trigger.controller,
            source: trigger.source,
            sourceInstanceId: trigger.sourceInstanceId,
            ability: trigger.ability,
            effect: trigger.effect,
            targets: [...(trigger.targets || [])],
            eventPayload: trigger.eventPayload
          });
          trigger.stacked = true;
        }
      }

      s.pendingTriggers = s.pendingTriggers.filter(trigger => trigger.batchId !== batchId);
    }
  }
}
