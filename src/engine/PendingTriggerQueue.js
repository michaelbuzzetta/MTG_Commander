import { uid } from '../utils.js';

export class PendingTriggerQueue {
  constructor(engine) { this.engine = engine; }

  enqueue({ definition, source, controller, eventType, eventPayload, eventRecord }) {
    const trigger = {
      id: uid('trg'),
      batchId: null,
      definitionId: definition.definitionId,
      triggerKind: definition.kind,
      event: eventType,
      source: source ? structuredClone(source) : null,
      sourceInstanceId: source?.instanceId || definition.sourceInstanceId || null,
      sourceGameObjectId: source?.gameObjectId || definition.sourceObjectId || null,
      controller,
      ability: structuredClone(definition.ability || {
        type: 'triggered',
        event: eventType,
        condition: definition.condition || {},
        targets: definition.targets || undefined,
        minTargets: definition.minTargets ?? undefined,
        maxTargets: definition.maxTargets ?? undefined,
        effect: definition.effect
      }),
      effect: structuredClone(definition.effect),
      optional: !!definition.optional,
      optionalDecision: definition.optional ? null : true,
      orderIndex: null,
      targets: null,
      eventPayload: structuredClone(eventPayload || {}),
      eventRecord: eventRecord ? structuredClone({
        eventId: eventRecord.eventId,
        sequence: eventRecord.sequence,
        type: eventRecord.type,
        status: eventRecord.status,
        provenance: eventRecord.provenance || null
      }) : null,
      interveningIf: structuredClone(definition.interveningIf || null),
      stacked: false
    };
    this.engine.state.pendingTriggers.push(trigger);
    return trigger;
  }

  assignBatch(triggers) {
    if (!triggers.length) return null;
    const batchId = uid('trigger-batch');
    for (const trigger of triggers) trigger.batchId = batchId;
    return batchId;
  }

  batch(batchId) {
    return this.engine.state.pendingTriggers.filter(trigger => trigger.batchId === batchId);
  }

  removeBatch(batchId) {
    this.engine.state.pendingTriggers = this.engine.state.pendingTriggers.filter(trigger => trigger.batchId !== batchId);
  }
}
