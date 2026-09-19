import {
  fingerprintAction,
  fingerprintEvent,
  hashAuthoritativeState,
  hashStructuralState,
  resourceDelta,
  resourceVector,
  hasProductiveProgress,
  fingerprintValue
} from './LoopStateHasher.js';
import { LOOP_CLASS, LOOP_SHORTCUT_ACTION, SHORTCUT_CONDITION } from './LoopTypes.js';

const CHOICE_KINDS = new Set(['choice']);

export function classifyLoopCycle({ exactState = false, steps = [], progressDelta = {} } = {}) {
  if (steps.some(step => CHOICE_KINDS.has(step.kind) || step.hadChoice)) return LOOP_CLASS.WITH_CHOICES;
  if (exactState && steps.length && steps.every(step => step.mandatory === true)) return LOOP_CLASS.MANDATORY_INFINITE;
  if (exactState) return LOOP_CLASS.OPTIONAL;
  if (hasProductiveProgress(progressDelta)) return LOOP_CLASS.DETERMINISTIC_RESOURCE;
  if (Object.keys(progressDelta).length) return LOOP_CLASS.PROGRESS_TOWARD_TERMINATION;
  return LOOP_CLASS.OPTIONAL;
}

function cloneStep(step) {
  return {
    playerId: step.playerId,
    kind: step.kind || 'action',
    action: structuredClone(step.action),
    actionFingerprint: step.actionFingerprint,
    mandatory: !!step.mandatory,
    hadChoice: !!step.hadChoice
  };
}

export class LoopService {
  constructor(engine) {
    this.engine = engine;
    this.observations = [];
    this.detected = new Map();
    this.sequence = 0;
    this.lastDetectedLoopId = null;
  }

  reset({ seed = false } = {}) {
    this.observations = [];
    this.detected.clear();
    this.sequence = 0;
    this.lastDetectedLoopId = null;
    if (seed) this.seed();
  }

  stateHash() { return hashAuthoritativeState(this.engine.state); }
  structuralHash() { return hashStructuralState(this.engine.state); }
  eventFingerprint(type, payload) { return fingerprintEvent(type, payload); }

  _observation(step = null) {
    return {
      index: this.observations.length,
      stateHash: this.stateHash(),
      structuralHash: null,
      resources: resourceVector(this.engine.state),
      step: step ? cloneStep(step) : null,
      actionSequence: this.engine._actionSequence || 0,
      turn: this.engine.state.turn,
      phase: this.engine.state.phase
    };
  }

  seed() {
    this.observations = [this._observation(null)];
    return this.observations[0];
  }

  _trim() {
    const max = this.engine.safety?.limits?.maxLoopObservations || 512;
    if (this.observations.length > max) this.observations.splice(0, this.observations.length - max);
  }

  _registerLoop({ classification, sequence, startStateHash, endStateHash, structuralHash, progressDelta = {}, exactState = false, source = 'action-cycle' }) {
    const signature = fingerprintValue({ classification, sequence: sequence.map(step => ({ playerId: step.playerId, kind: step.kind, actionFingerprint: step.actionFingerprint })), structuralHash });
    const id = `loop-${signature}`;
    const existing = this.detected.get(id);
    if (existing) {
      existing.occurrences++;
      existing.lastSeenActionSequence = this.engine._actionSequence || 0;
      existing.endStateHash = endStateHash;
      existing.progressDelta = structuredClone(progressDelta);
      this.lastDetectedLoopId = id;
      return existing;
    }
    const loop = {
      id,
      classification,
      signature,
      source,
      period: sequence.length,
      sequence: sequence.map(cloneStep),
      startStateHash,
      endStateHash,
      structuralHash,
      progressDelta: structuredClone(progressDelta),
      exactState,
      deterministic: classification !== LOOP_CLASS.WITH_CHOICES,
      shortcutEligible: [LOOP_CLASS.OPTIONAL, LOOP_CLASS.DETERMINISTIC_RESOURCE].includes(classification) && !sequence.some(step => step.kind === 'choice'),
      occurrences: 1,
      detectedAtActionSequence: this.engine._actionSequence || 0,
      lastSeenActionSequence: this.engine._actionSequence || 0
    };
    this.detected.set(id, loop);
    this.lastDetectedLoopId = id;
    this.engine.log?.('LOOP_DETECTED', {
      loopId: id,
      classification,
      period: loop.period,
      shortcutEligible: loop.shortcutEligible
    });
    return loop;
  }

  _detectExact(current) {
    for (let i = this.observations.length - 2; i >= 0; i--) {
      const previous = this.observations[i];
      if (previous.stateHash !== current.stateHash) continue;
      const cycle = this.observations.slice(i + 1).map(obs => obs.step).filter(Boolean);
      if (!cycle.length) return null;
      const classification = classifyLoopCycle({ exactState: true, steps: cycle });
      return this._registerLoop({
        classification,
        sequence: cycle,
        startStateHash: previous.stateHash,
        endStateHash: current.stateHash,
        structuralHash: this.structuralHash(),
        exactState: true
      });
    }
    return null;
  }

  _detectRepeatedPattern(current) {
    const actionObservations = this.observations.filter(obs => obs.step);
    const count = actionObservations.length;
    if (count < 2) return null;
    const maxPeriod = Math.min(16, Math.floor(count / 2));
    for (let period = 1; period <= maxPeriod; period++) {
      const recent = actionObservations.slice(count - period);
      const prior = actionObservations.slice(count - period * 2, count - period);
      if (recent.length !== period || prior.length !== period) continue;
      if (!recent.every((obs, index) => obs.step.actionFingerprint === prior[index].step.actionFingerprint && obs.step.playerId === prior[index].step.playerId && obs.step.kind === prior[index].step.kind)) continue;
      const priorBoundary = actionObservations[count - period - 1] || this.observations[0];
      const delta = resourceDelta(priorBoundary.resources, current.resources);
      if (!Object.keys(delta).length) continue;
      const steps = recent.map(obs => obs.step);
      const classification = classifyLoopCycle({ exactState: false, steps, progressDelta: delta });
      return this._registerLoop({
        classification,
        sequence: steps,
        startStateHash: priorBoundary.stateHash,
        endStateHash: current.stateHash,
        structuralHash: this.structuralHash(),
        progressDelta: delta,
        exactState: false,
        source: 'repeated-action-pattern'
      });
    }
    return null;
  }

  observeAction({ playerId, action, kind = 'action', mandatory = false, hadChoice = false } = {}) {
    if (!action || action.type === LOOP_SHORTCUT_ACTION) {
      this.seed();
      return null;
    }
    const step = {
      playerId,
      kind,
      action: structuredClone(action),
      actionFingerprint: fingerprintAction(action),
      mandatory,
      hadChoice
    };
    const current = this._observation(step);
    this.observations.push(current);
    const exact = this._detectExact(current);
    const detected = exact || this._detectRepeatedPattern(current);
    this._trim();
    return detected;
  }

  resolveMandatoryNoProgress({ type = null, payload = null, source = 'event-recursion', stateHash = this.stateHash() } = {}) {
    const sequence = [{
      playerId: this.engine.state.activePlayer || null,
      kind: 'mandatory',
      action: { type: type || 'MANDATORY_EVENT', payloadFingerprint: fingerprintValue(payload || {}) },
      actionFingerprint: fingerprintValue({ type, payload }, { structural: true }),
      mandatory: true,
      hadChoice: false
    }];
    const loop = this._registerLoop({
      classification: LOOP_CLASS.MANDATORY_INFINITE,
      sequence,
      startStateHash: stateHash,
      endStateHash: stateHash,
      structuralHash: this.structuralHash(),
      exactState: true,
      source
    });
    this.engine.state.winner = 'draw';
    this.engine.state.priorityPlayer = null;
    this.engine.log?.('MANDATORY_LOOP_DRAW', { loopId: loop.id, source });
    return loop;
  }

  detectMandatoryEventCycle(type, payload, eventStack = []) {
    const currentStateHash = this.stateHash();
    const eventKey = this.eventFingerprint(type, payload);
    const ancestor = eventStack.find(event => event?._loopStateHash === currentStateHash && event?._loopFingerprint === eventKey);
    if (!ancestor) return null;
    return this.resolveMandatoryNoProgress({ type, payload, stateHash: currentStateHash, source: 'mandatory-event-cycle' });
  }

  markEventFrame(event) {
    if (!event) return event;
    event._loopStateHash = this.stateHash();
    event._loopFingerprint = this.eventFingerprint(event.type, event.payload);
    return event;
  }

  latestLoop() {
    return this.lastDetectedLoopId ? this.detected.get(this.lastDetectedLoopId) || null : null;
  }

  get(loopId) { return this.detected.get(loopId) || null; }

  snapshot() {
    return {
      observationCount: this.observations.length,
      latestLoopId: this.lastDetectedLoopId,
      loops: [...this.detected.values()].map(loop => structuredClone(loop))
    };
  }

  _validateCondition(condition) {
    if (!condition || typeof condition !== 'object') throw new Error('Repeat-until shortcut requires a condition');
    if (!Object.values(SHORTCUT_CONDITION).includes(condition.type)) throw new Error(`Unsupported loop shortcut condition ${condition.type}`);
    if (!this.engine.state.players[condition.playerId]) throw new Error('Loop shortcut condition references an unknown player');
    if (condition.type === SHORTCUT_CONDITION.MANA_AT_LEAST) {
      if (!['W', 'U', 'B', 'R', 'G', 'C'].includes(condition.color)) throw new Error('Mana condition requires a legal mana color');
      if (!(Number(condition.amount) >= 0)) throw new Error('Mana condition requires a nonnegative amount');
    } else if (condition.type === SHORTCUT_CONDITION.COUNTER_AT_LEAST) {
      if (!condition.counterType || !(Number(condition.amount) >= 0)) throw new Error('Counter condition requires counterType and nonnegative amount');
    } else if (!(Number(condition.amount) >= 0)) {
      throw new Error('Loop shortcut condition requires a nonnegative amount');
    }
    return true;
  }

  conditionMet(condition) {
    this._validateCondition(condition);
    const p = this.engine.state.players[condition.playerId];
    switch (condition.type) {
      case SHORTCUT_CONDITION.MANA_AT_LEAST: return Number(p.manaPool?.[condition.color] || 0) >= Number(condition.amount);
      case SHORTCUT_CONDITION.LIFE_AT_MOST: return Number(p.life || 0) <= Number(condition.amount);
      case SHORTCUT_CONDITION.LIFE_AT_LEAST: return Number(p.life || 0) >= Number(condition.amount);
      case SHORTCUT_CONDITION.HAND_SIZE_AT_LEAST: return (p.hand?.length || 0) >= Number(condition.amount);
      case SHORTCUT_CONDITION.COUNTER_AT_LEAST: return Number(p.counters?.[condition.counterType] || 0) >= Number(condition.amount);
      default: return false;
    }
  }

  normalizeShortcutAction(action) {
    const loop = this.get(action.loopId);
    if (!loop) return structuredClone(action);
    return {
      ...structuredClone(action),
      loopSignature: loop.signature,
      classification: loop.classification,
      period: loop.period,
      sequence: loop.sequence.map(step => ({ playerId: step.playerId, kind: step.kind, action: structuredClone(step.action) }))
    };
  }

  validateShortcut(playerId, action) {
    const loop = this.get(action.loopId);
    if (!loop) throw new Error('The requested loop is no longer available');
    if (!loop.shortcutEligible) throw new Error(`Loop classification ${loop.classification} is not shortcut-eligible`);
    if (!loop.sequence.length) throw new Error('Loop has no repeatable action sequence');
    if (loop.sequence.some(step => step.action?.type === LOOP_SHORTCUT_ACTION || step.kind === 'choice')) throw new Error('Nested/choice-driven loops cannot be shortcut automatically');
    if (loop.sequence[0].playerId !== playerId) throw new Error('The acting player does not own the next loop action');
    if (this.engine.state.pendingChoice) throw new Error('A loop shortcut cannot start while a choice is pending');

    const fixed = action.iterations != null;
    const until = action.until != null;
    if (fixed === until) throw new Error('Specify exactly one of iterations or until for a loop shortcut');
    if (fixed) {
      const iterations = Number(action.iterations);
      if (!Number.isInteger(iterations) || iterations < 1) throw new Error('Loop shortcut iterations must be a positive integer');
      if (iterations > this.engine.safety.limits.maxShortcutIterations) throw new Error('Loop shortcut exceeds the configured iteration limit');
    } else {
      this._validateCondition(action.until);
      const maxIterations = Number(action.maxIterations ?? 1000);
      if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > this.engine.safety.limits.maxShortcutIterations) throw new Error('Invalid repeat-until maximum iteration count');
      if (loop.classification === LOOP_CLASS.OPTIONAL && loop.exactState) throw new Error('A no-progress loop cannot use repeat-until; provide an explicit finite count');
    }

    if (loop.exactState) {
      if (this.stateHash() !== loop.endStateHash) throw new Error('Game state has changed since the loop was detected');
    } else if (this.structuralHash() !== loop.structuralHash) {
      throw new Error('Game structure has changed since the progressing loop was detected');
    }
    return true;
  }

  executeShortcut(playerId, action) {
    this.validateShortcut(playerId, action);
    const loop = this.get(action.loopId);
    const fixedIterations = action.iterations != null ? Number(action.iterations) : null;
    const maxIterations = fixedIterations ?? Number(action.maxIterations ?? 1000);
    this.engine.safety.beginShortcut();
    let completed = 0;
    let stopReason = fixedIterations != null ? 'iteration-count' : 'condition';

    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      if (action.until && this.conditionMet(action.until)) break;
      this.engine.safety.consumeShortcutIteration({ loopId: loop.id, iteration });
      for (let stepIndex = 0; stepIndex < loop.sequence.length; stepIndex++) {
        const step = loop.sequence[stepIndex];
        this.engine.safety.consumeExpandedAction({ loopId: loop.id, iteration, stepIndex });
        this.engine._executeShortcutStep(step.playerId, step.action, step.kind, { loopId: loop.id, iteration, stepIndex });
        if (this.engine.state.winner) break;
        if (this.engine.state.pendingChoice) throw new Error('Detected deterministic loop unexpectedly produced a choice during shortcut execution');
      }
      completed++;
      if (this.engine.state.winner) { stopReason = 'game-ended'; break; }
      if (action.until && this.conditionMet(action.until)) break;
    }

    if (action.until && !this.conditionMet(action.until) && !this.engine.state.winner) {
      throw new Error('Repeat-until shortcut reached its iteration safety limit before the condition became true');
    }

    const execution = {
      loopId: loop.id,
      classification: loop.classification,
      iterations: completed,
      expandedActions: completed * loop.sequence.length,
      stopReason,
      finalStateHash: this.stateHash(),
      until: action.until ? structuredClone(action.until) : null
    };
    this.engine.log?.('LOOP_SHORTCUT_EXECUTED', execution);
    return execution;
  }

  legalShortcutActions(playerId) {
    if (this.engine.state.pendingChoice || this.engine.state.priorityPlayer !== playerId) return [];
    const currentExact = this.stateHash();
    const currentStructural = this.structuralHash();
    const actions = [];
    for (const loop of this.detected.values()) {
      if (!loop.shortcutEligible || loop.sequence[0]?.playerId !== playerId) continue;
      if (loop.exactState ? currentExact !== loop.endStateHash : currentStructural !== loop.structuralHash) continue;
      actions.push({
        type: LOOP_SHORTCUT_ACTION,
        loopId: loop.id,
        classification: loop.classification,
        period: loop.period,
        iterations: 1,
        requiresIterationCount: loop.classification === LOOP_CLASS.OPTIONAL && loop.exactState,
        maxIterations: this.engine.safety.limits.maxShortcutIterations
      });
    }
    return actions;
  }
}
