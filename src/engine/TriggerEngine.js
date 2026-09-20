import { TriggerRegistry, TriggerMatcher, PendingTriggerQueue } from './triggers/index.js';

/**
 * Step 9 triggered-ability facade.
 *
 * Card abilities and temporary delayed/reflexive registrations are normalized
 * into TriggerDefinitions. Completed events are observed through the Step 3
 * event stream; matched triggers are queued and only placed on the stack at a
 * rules boundary after the current event transaction/state stabilization has
 * finished.
 */
export class TriggerEngine {
  constructor(engine) {
    this.engine = engine;
    this.registry = new TriggerRegistry(engine);
    this.matcher = new TriggerMatcher(engine, this.registry);
    this.queue = new PendingTriggerQueue(engine);
    this._observing = 0;
    this._unsubscribe = engine.events.subscribe('*', (record, _engine, eventPayload) => {
      this.observe(record, eventPayload || {});
    });
  }

  dispose() { this._unsubscribe?.(); }

  observe(record, payload = {}) {
    if (!record?.type || !['committed', 'observed'].includes(record.status)) return [];
    this._observing += 1;
    try {
      const matched = this.matcher.matchEvent(record.type, payload);
      const queued = [];
      for (const match of matched) {
        const trigger = this.queue.enqueue({
          ...match,
          eventType: record.type,
          eventPayload: payload,
          eventRecord: record
        });
        queued.push(trigger);
        this.registry.markFired(match.definition);
      }
      this.queue.assignBatch(queued);
      this.registry.expireForEvent(record.type);
      return queued;
    } finally {
      this._observing -= 1;
    }
  }

  /** Compatibility entry point for legacy callers/tests. New code uses events. */
  collect(event, payload = {}) {
    return this.observe({
      eventId: null,
      sequence: null,
      type: event,
      status: 'observed',
      provenance: null
    }, payload);
  }

  registerDelayedTrigger(fields) { return this.registry.registerDelayed(fields); }
  registerReflexiveTrigger(fields) { return this.registry.registerReflexive(fields); }

  _batch(batchId) { return this.queue.batch(batchId); }

  _choiceResume() {
    return this.engine.state.phase === 'CLEANUP' ? 'CLEANUP' : 'PRIORITY';
  }

  _apnapOrder() { return this.engine.multiplayer.apnapOrder(); }

  /**
   * A trigger batch may be stacked only after the current event transaction is
   * complete and state-based actions have finished. Step 12 will replace the
   * legacy SBA implementation; this gate already enforces Step 9 timing.
   */
  canFlushNow() {
    const e = this.engine;
    if (this._observing > 0 || e._triggerDeferral > 0) return false;
    if (e.events?.eventStack?.length) return false;
    if (e.state.pendingChoice) return false;
    return true;
  }

  afterEventBoundary() {
    if (!this.canFlushNow()) return false;
    if (!this.engine.state.pendingTriggers.length) return false;
    this.flush();
    return true;
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

  chooseMode(triggerId, modeId) {
    const trigger = this.engine.state.pendingTriggers.find(item => item.id === triggerId);
    if (!trigger) throw new Error('Triggered ability is no longer pending');
    const mode = (trigger.ability?.modes || []).find(item => item.id === modeId);
    if (!mode) throw new Error('Triggered ability mode is not legal');
    trigger.selectedMode = modeId;
    trigger.ability = { ...trigger.ability, ...(mode.targets ? { targets: structuredClone(mode.targets) } : { targets: undefined }), effect: structuredClone(mode.effect), modes: undefined };
    trigger.effect = structuredClone(mode.effect);
    this.engine.state.pendingChoice = null;
    this.flush();
    return modeId;
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

  interveningIfHolds(triggerLike) {
    const condition = triggerLike?.interveningIf;
    if (!condition) return true;
    const source = triggerLike.sourceInstanceId
      ? (this.engine.findPermanent(triggerLike.sourceInstanceId) || triggerLike.source)
      : triggerLike.source;
    // If an intervening-if condition explicitly depends on the current source
    // object, a source that no longer exists cannot satisfy it.
    if (condition.sourceCounterAtLeast && triggerLike.sourceInstanceId && !this.engine.findPermanent(triggerLike.sourceInstanceId)) return false;
    return this.matcher.matchCondition(condition, triggerLike.eventPayload || {}, triggerLike.controller, source);
  }

  flush() {
    const s = this.engine.state;
    if (s.pendingChoice) return;

    while (s.pendingTriggers.length) {
      const batchId = s.pendingTriggers[0].batchId;
      const batch = this._batch(batchId);
      if (!batch.length) {
        s.pendingTriggers.shift();
        continue;
      }

      // Intervening-if clauses are checked once when the event is observed and
      // again here before the ability is actually put on the stack. The second
      // required check at resolution is performed by ResolutionPipeline.
      for (const trigger of batch) {
        if (trigger.stacked || trigger.optionalDecision === false) continue;
        if (!this.interveningIfHolds(trigger)) trigger.optionalDecision = false;
      }

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
      for (const controller of this._apnapOrder()) {
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
          if (Array.isArray(trigger.ability?.modes) && trigger.ability.modes.length && !trigger.selectedMode) {
            s.pendingChoice = {
              type: 'TRIGGER_MODE', playerId: trigger.controller, triggerId: trigger.id,
              sourceName: this.engine.db[trigger.source?.cardId]?.name || 'Triggered ability',
              modes: trigger.ability.modes.map(mode => ({ id: mode.id, label: mode.label || mode.id })),
              resume: this._choiceResume()
            };
            s.priorityPlayer = trigger.controller;
            return;
          }
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
                targetSource: structuredClone(trigger.ability),
                sourceObjectId: trigger.source?.instanceId || trigger.source?.gameObjectId || null,
                resume: this._choiceResume()
              };
              s.priorityPlayer = trigger.controller;
              return;
            }
          }

          this.engine.stack.push({
            id: trigger.id,
            type: 'trigger',
            controller: trigger.controller,
            source: trigger.source,
            sourceInstanceId: trigger.sourceInstanceId,
            sourceGameObjectId: trigger.sourceGameObjectId,
            ability: trigger.ability,
            effect: trigger.effect,
            targets: [...(trigger.targets || [])],
            eventPayload: trigger.eventPayload,
            triggerDefinitionId: trigger.definitionId,
            triggerKind: trigger.triggerKind,
            interveningIf: trigger.interveningIf,
            triggeringEvent: trigger.eventRecord
          });
          trigger.stacked = true;
        }
      }

      this.queue.removeBatch(batchId);
    }
  }
}
