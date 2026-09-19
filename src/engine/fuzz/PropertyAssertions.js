function clone(value) {
  try { return structuredClone(value); } catch { return value; }
}

export class FuzzPropertyError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'FuzzPropertyError';
    this.code = code;
    this.detail = clone(detail);
  }
}

/**
 * Step 37 property assertions intentionally validate broad engine truths rather
 * than card-specific final positions. They run after every accepted fuzz action.
 */
export class PropertyAssertions {
  constructor(engine, { unchangedStateLimit = 48 } = {}) {
    this.engine = engine;
    this.unchangedStateLimit = Math.max(8, Number(unchangedStateLimit) || 48);
    this.lastHash = null;
    this.unchangedCount = 0;
  }

  beforeAction(playerId, action, legalActions = []) {
    const encoded = JSON.stringify(action);
    if (!legalActions.some(candidate => JSON.stringify(candidate) === encoded)) {
      throw new FuzzPropertyError('FUZZ_ACTION_NOT_ENGINE_PROVIDED', 'Fuzz bot attempted an action that was not emitted by getLegalActions().', {
        playerId,
        action,
        legalActionCount: legalActions.length
      });
    }
  }

  afterAction({ playerId, action, response }) {
    if (!response?.ok) {
      throw new FuzzPropertyError('LEGAL_ACTION_REJECTED', 'An action emitted by getLegalActions() was rejected by the authoritative engine.', {
        playerId,
        action,
        error: response?.error || null
      });
    }

    const invariant = this.engine.checkInvariants({ boundary: 'fuzz:property', throwOnFailure: false });
    if (!invariant.ok) {
      throw new FuzzPropertyError('INVARIANT_VIOLATION', 'A fuzz action produced an invariant violation.', {
        playerId,
        action,
        failures: invariant.failures
      });
    }

    const hash = this.engine.getReplayStateHash();
    if (hash === this.lastHash) this.unchangedCount += 1;
    else this.unchangedCount = 0;
    this.lastHash = hash;
    if (this.unchangedCount >= this.unchangedStateLimit) {
      throw new FuzzPropertyError('PRIORITY_DEADLOCK', `Authoritative state did not progress for ${this.unchangedCount + 1} consecutive legal actions.`, {
        playerId,
        action,
        stateHash: hash,
        priorityPlayer: this.engine.state.priorityPlayer,
        pendingChoice: this.engine.state.pendingChoice?.type || null
      });
    }

    return { ok: true, stateHash: hash, invariant };
  }

  assertActorCanAct(playerId, legalActions) {
    if (!playerId) {
      throw new FuzzPropertyError('NO_FUZZ_ACTOR', 'No active player can be selected for the current authoritative state.', {
        activePlayer: this.engine.state.activePlayer,
        priorityPlayer: this.engine.state.priorityPlayer,
        pendingChoice: this.engine.state.pendingChoice || null
      });
    }
    if (!Array.isArray(legalActions) || legalActions.length === 0) {
      throw new FuzzPropertyError('NO_LEGAL_ACTIONS', 'The current fuzz actor has no legal actions and the game is not over.', {
        playerId,
        turn: this.engine.state.turn,
        phase: this.engine.state.phase,
        priorityPlayer: this.engine.state.priorityPlayer,
        pendingChoice: this.engine.state.pendingChoice?.type || null
      });
    }
  }
}
