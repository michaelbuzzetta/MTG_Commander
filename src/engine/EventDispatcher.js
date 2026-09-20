import { uid } from './utils.js';
import { buildEventProvenance, summarizeEventPayload, summarizeEventResult } from './provenance.js';

/**
 * Step 3 authoritative event dispatcher.
 *
 * Lifecycle:
 *  1. construct + validate request
 *  2. run registered replacement/prevention transforms (extension point)
 *  3. commit exactly one authoritative mutation handler
 *  4. record compact result/provenance
 *  5. publish trigger-facing notifications
 *  6. stabilize state at the outer event boundary when requested
 *
 * Built-in handlers are required to validate every failure-prone precondition
 * before their first mutation. This keeps illegal requests atomic without
 * cloning the entire Commander state on every event. Custom handlers can set
 * `snapshotOnCommitError: true` to request full rollback protection.
 */
export class EventDispatcher {
  constructor(engine) {
    this.engine = engine;
    this.handlers = new Map();
    this.transformers = [];
    this.subscribers = new Map();
    this.eventStack = [];
    this._stabilizing = false;
    this.rejectedEvents = [];
    this.eventLog = [];
    this.sequenceCursor = 0;
  }

  register(type, { validate = null, commit, snapshotOnCommitError = false } = {}) {
    if (!type || typeof commit !== 'function') throw new Error('Event handlers require a type and commit function');
    this.handlers.set(type, { validate, commit, snapshotOnCommitError });
    return this;
  }

  addTransformer(transformer) {
    if (typeof transformer !== 'function') throw new Error('Event transformer must be a function');
    this.transformers.push(transformer);
    return () => {
      const index = this.transformers.indexOf(transformer);
      if (index >= 0) this.transformers.splice(index, 1);
    };
  }

  /**
   * Subscribe to completed engine events without modifying card-specific code.
   * Use '*' to observe every event. Subscribers receive immutable records.
   * Step 9 can build its trigger matcher on this same interface.
   */
  subscribe(type, subscriber) {
    if (!type || typeof subscriber !== 'function') throw new Error('Event subscription requires a type and subscriber');
    const bucket = this.subscribers.get(type) || new Set();
    bucket.add(subscriber);
    this.subscribers.set(type, bucket);
    return () => {
      bucket.delete(subscriber);
      if (!bucket.size) this.subscribers.delete(type);
    };
  }

  _publish(record, eventPayload = null) {
    const listeners = [
      ...(this.subscribers.get(record.type) || []),
      ...(this.subscribers.get('*') || [])
    ];
    if (!listeners.length) return;
    const snapshot = structuredClone(record);
    const payloadSnapshot = eventPayload == null ? null : structuredClone(eventPayload);
    for (const subscriber of listeners) subscriber(structuredClone(snapshot), this.engine, payloadSnapshot == null ? null : structuredClone(payloadSnapshot));
  }

  currentEventId() {
    return this.eventStack.at(-1)?.eventId || null;
  }

  _nextSequence() {
    this.sequenceCursor += 1;
    return this.sequenceCursor;
  }

  syncSequenceFromState() {
    // Event diagnostics are intentionally non-authoritative and are not part of
    // GameState snapshots. Restoring/resetting state therefore starts a fresh
    // event-log segment instead of cloning an ever-growing log into UI/AI views.
    this.clearLog();
  }

  _record(record) {
    // Nested events finish before their parent handler returns. Keep the stored
    // log in creation/causal order instead of completion order so parent events
    // precede their children deterministically. The log is diagnostics/replay
    // metadata, not authoritative game state, so snapshots stay small.
    const log = this.eventLog;
    const existing = log.findIndex(item => item.eventId === record.eventId);
    if (existing >= 0) log.splice(existing, 1);
    const insertAt = log.findIndex(item => Number(item.sequence || 0) > Number(record.sequence || 0));
    if (insertAt < 0) log.push(record);
    else log.splice(insertAt, 0, record);
  }

  _recordRejected(record) {
    this.rejectedEvents.push(structuredClone(record));
  }

  _makeEvent(type, payload, options = {}) {
    const sequence = this._nextSequence();
    const parentEventId = options.parentEventId ?? this.currentEventId();
    return {
      eventId: uid('evt'),
      sequence,
      type,
      payload,
      provenance: buildEventProvenance(this.engine, payload, {
        parentEventId,
        cause: options.cause || null
      }),
      replacementTrace: [],
      preventionTrace: [],
      replacementOrder: options.replacementOrder ? [...options.replacementOrder] : null,
      skipReplacements: options.skipReplacements === true
    };
  }

  _applyTransformers(event) {
    let current = event;
    for (const transformer of this.transformers) {
      const transformed = transformer(current, this.engine);
      if (transformed === false || transformed?.prevented === true) {
        current = { ...current, prevented: true, ...(typeof transformed === 'object' ? transformed : {}) };
        break;
      }
      if (transformed && typeof transformed === 'object') current = transformed;
    }
    return current;
  }

  dispatch(type, payload = {}, options = {}) {
    const initialHandler = this.handlers.get(type);
    if (!initialHandler) {
      this.engine.unsupported?.encounter({
        message: `No authoritative event handler is registered for ${type}.`,
        scriptNode: { eventType: type, payload: summarizeEventPayload(payload) },
        context: { kind: 'event-handler', stage: 'initial-dispatch', eventType: type }
      }, {
        approximation: { kind: 'explicit-no-op', description: `Sandbox skipped unsupported event ${type}.` }
      });
      return null;
    }

    // Step 19 guards mandatory recursive event chains before they can hang a
    // simulation. An identical event request at an identical authoritative
    // state inside its own ancestry is a mandatory no-progress loop and the
    // game is a draw. Other runaway recursion is stopped by the safety budget.
    this.engine.safety?.assertEventDepth((this.eventStack?.length || 0) + 1, { eventType: type });
    const mandatoryLoop = this.engine.loops?.detectMandatoryEventCycle(type, payload, this.eventStack);
    if (mandatoryLoop) return null;

    const event = this._makeEvent(type, payload, options);
    try {
      initialHandler.validate?.(event, this.engine);
    } catch (error) {
      this._recordRejected({
        eventId: event.eventId,
        sequence: event.sequence,
        type: event.type,
        status: 'rejected',
        payload: summarizeEventPayload(event.payload),
        provenance: event.provenance,
        error: error?.message || String(error)
      });
      throw error;
    }

    const transformed = this._applyTransformers(event);
    if (transformed.prevented) {
      const record = {
        eventId: transformed.eventId,
        sequence: transformed.sequence,
        type: transformed.type,
        status: 'prevented',
        payload: summarizeEventPayload(transformed.payload),
        provenance: transformed.provenance,
        replacementTrace: transformed.replacementTrace || [],
        preventionTrace: transformed.preventionTrace || []
      };
      this._record(record);
      this._publish(record, transformed.payload);
      this.engine.triggers?.afterEventBoundary?.();
      return transformed.result ?? null;
    }

    // Replacement/prevention layers may rewrite both the payload and the event
    // type. A rewritten event is validated by the authoritative handler for the
    // final event type before any mutation occurs.
    const handler = this.handlers.get(transformed.type);
    if (!handler) {
      this.engine.unsupported?.encounter({
        message: `No authoritative event handler is registered for replacement result ${transformed.type}.`,
        scriptNode: { eventType: transformed.type, payload: summarizeEventPayload(transformed.payload) },
        eventId: transformed.eventId,
        context: { kind: 'event-handler', stage: 'post-replacement', eventType: transformed.type }
      }, {
        approximation: { kind: 'explicit-no-op', description: `Sandbox skipped unsupported replacement event ${transformed.type}.` }
      });
      return null;
    }
    try {
      handler.validate?.(transformed, this.engine);
    } catch (error) {
      this._recordRejected({
        eventId: transformed.eventId,
        sequence: transformed.sequence,
        type: transformed.type,
        status: 'rejected-after-transform',
        payload: summarizeEventPayload(transformed.payload),
        provenance: transformed.provenance,
        error: error?.message || String(error)
      });
      throw error;
    }

    const rollback = handler.snapshotOnCommitError ? structuredClone(this.engine.state) : null;
    this.engine.loops?.markEventFrame(transformed);
    this.eventStack.push(transformed);
    let result;
    try {
      result = handler.commit(transformed, this.engine);
    } catch (error) {
      if (rollback) this.engine.state = rollback;
      this.eventStack.pop();
      this._recordRejected({
        eventId: transformed.eventId,
        sequence: transformed.sequence,
        type: transformed.type,
        status: 'failed',
        payload: summarizeEventPayload(transformed.payload),
        provenance: transformed.provenance,
        error: error?.message || String(error)
      });
      throw error;
    }
    this.eventStack.pop();
    // Step 38 invalidates non-authoritative query caches immediately after each
    // committed engine mutation. Event type also drives the lightweight source
    // topology revision used by trigger/replacement indexes.
    this.engine.performance?.afterEvent?.(transformed.type);

    const committedRecord = {
      eventId: transformed.eventId,
      sequence: transformed.sequence,
      type: transformed.type,
      status: 'committed',
      payload: summarizeEventPayload(transformed.payload),
      result: summarizeEventResult(result),
      provenance: transformed.provenance,
      replacementTrace: transformed.replacementTrace || [],
      preventionTrace: transformed.preventionTrace || []
    };
    this._record(committedRecord);
    this._publish(committedRecord, transformed.payload);

    if (options.stabilize === true && this.eventStack.length === 0 && !this._stabilizing && !this.engine.state.pendingChoice) {
      this._stabilizing = true;
      try {
        // Step 12 will replace the legacy SBA implementation. Step 3 still
        // centralizes when it is invoked so later event systems have one hook.
        this.engine.stateBasedActions?.();
      } finally {
        this._stabilizing = false;
      }
    }
    if (this.eventStack.length === 0) this.engine.triggers?.afterEventBoundary?.();
    return result;
  }

  /**
   * Commit a rules-defined simultaneous event set while deferring trigger
   * stacking until every member has completed. Replacement effects still see
   * each event individually; the shared batch metadata preserves simultaneity.
   */
  dispatchSimultaneous(requests = [], options = {}) {
    if (!Array.isArray(requests)) throw new Error('Simultaneous event requests must be an array');
    const batchId = options.batchId || uid('sim');
    const results = [];
    return this.engine._withDeferredTriggers(() => {
      requests.forEach((request, index) => {
        if (!request?.type) throw new Error('Each simultaneous event request requires a type');
        const payload = { ...(request.payload || {}), simultaneousBatchId: batchId, simultaneousIndex: index, simultaneousSize: requests.length };
        results.push(this.dispatch(request.type, payload, { ...(request.options || {}), stabilize: false, cause: request.options?.cause || options.cause || 'simultaneous-event' }));
      });
      if (options.stabilize !== false && !this.engine.state.pendingChoice) this.engine.stateBasedActions?.();
      return { batchId, results };
    });
  }

  /**
   * Publish an observation for triggers/logs without committing a second state
   * mutation. Existing card data subscribes to these legacy notification names.
   */
  notify(type, payload = {}, options = {}) {
    const event = this._makeEvent(type, payload, options);
    this.engine.state.history.push({
      turn: this.engine.state.turn,
      phase: this.engine.state.phase,
      type,
      ...payload,
      eventId: event.eventId,
      parentEventId: event.provenance.parentEventId
    });
    const observedRecord = {
      eventId: event.eventId,
      sequence: event.sequence,
      type,
      status: 'observed',
      payload: summarizeEventPayload(payload),
      provenance: event.provenance
    };
    this._record(observedRecord);
    this._publish(observedRecord, payload);
    if (this.eventStack.length === 0) this.engine.triggers?.afterEventBoundary?.();
    return event;
  }

  clearLog() {
    this.eventLog = [];
    this.rejectedEvents = [];
    this.eventStack = [];
    this.sequenceCursor = 0;
  }

  getLogSnapshot() {
    return structuredClone(this.eventLog);
  }
}
