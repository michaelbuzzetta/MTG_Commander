export class SimulationSafetyBudgetError extends Error {
  constructor(message, diagnostic) {
    super(message);
    this.name = 'SimulationSafetyBudgetError';
    this.code = 'SIMULATION_SAFETY_BUDGET_EXCEEDED';
    this.diagnostic = diagnostic;
  }
}

export class SimulationSafetyBudget {
  constructor(engine, limits = {}) {
    this.engine = engine;
    this.limits = {
      maxEventDepth: 128,
      maxActionDepth: 32,
      maxShortcutIterations: 10000,
      maxExpandedActions: 100000,
      maxLoopObservations: 512,
      ...limits
    };
    this.actionDepth = 0;
    this.shortcutIterations = 0;
    this.expandedActions = 0;
    this.lastFailure = null;
  }

  reset() {
    this.actionDepth = 0;
    this.shortcutIterations = 0;
    this.expandedActions = 0;
    this.lastFailure = null;
  }

  _fail(kind, details = {}) {
    const diagnostic = {
      kind,
      turn: this.engine.state?.turn ?? null,
      phase: this.engine.state?.phase ?? null,
      activePlayer: this.engine.state?.activePlayer ?? null,
      priorityPlayer: this.engine.state?.priorityPlayer ?? null,
      eventDepth: this.engine.events?.eventStack?.length || 0,
      actionDepth: this.actionDepth,
      shortcutIterations: this.shortcutIterations,
      expandedActions: this.expandedActions,
      limits: { ...this.limits },
      ...details
    };
    this.lastFailure = diagnostic;
    throw new SimulationSafetyBudgetError(`Simulation safety budget exceeded: ${kind}`, diagnostic);
  }

  enterAction(context = {}) {
    this.actionDepth++;
    if (this.actionDepth > this.limits.maxActionDepth) this._fail('action-depth', context);
  }

  leaveAction() {
    this.actionDepth = Math.max(0, this.actionDepth - 1);
  }

  assertEventDepth(depth, context = {}) {
    if (depth > this.limits.maxEventDepth) this._fail('event-depth', { depth, ...context });
  }

  beginShortcut() {
    this.shortcutIterations = 0;
    this.expandedActions = 0;
  }

  consumeShortcutIteration(context = {}) {
    this.shortcutIterations++;
    if (this.shortcutIterations > this.limits.maxShortcutIterations) this._fail('shortcut-iterations', context);
  }

  consumeExpandedAction(context = {}) {
    this.expandedActions++;
    if (this.expandedActions > this.limits.maxExpandedActions) this._fail('shortcut-expanded-actions', context);
  }

  snapshot() {
    return {
      limits: { ...this.limits },
      actionDepth: this.actionDepth,
      shortcutIterations: this.shortcutIterations,
      expandedActions: this.expandedActions,
      lastFailure: this.lastFailure ? structuredClone(this.lastFailure) : null
    };
  }
}
