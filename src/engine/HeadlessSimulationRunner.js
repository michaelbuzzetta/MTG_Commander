import { GameEngine } from '../GameEngine.js';
import { FuzzBot } from '../fuzz/index.js';
import { UNSUPPORTED_INTERACTION_MODE } from '../diagnostics/index.js';

export class HeadlessSimulationRunner {
  constructor({ db, decks, invariantChecks = true, performanceOptimizations = true, engineOptions = {} } = {}) {
    if (!db) throw new Error('HeadlessSimulationRunner requires a card database');
    if (!Array.isArray(decks) || decks.length < 2) throw new Error('HeadlessSimulationRunner requires at least two decks');
    this.db = db;
    this.decks = decks;
    this.invariantChecks = invariantChecks !== false;
    this.performanceOptimizations = performanceOptimizations !== false;
    this.engineOptions = structuredClone(engineOptions || {});
  }

  _selected(playerCount = 4) {
    const count = Math.max(2, Math.min(4, Number(playerCount) || 4));
    const selected = this.decks.slice(0, count);
    if (selected.length < count) throw new Error(`Need ${count} decks for a ${count}-player headless simulation`);
    return selected;
  }

  /**
   * Step 42 startup support preflight. This intentionally constructs a standard
   * engine only to query the existing support database; no game is started and
   * no actions are executed. Official/strict simulation creation performs the
   * complete strict startup preflight again inside GameEngine.
   */
  preflight({ playerCount = 4, strict = true } = {}) {
    const selected = this._selected(playerCount);
    const engine = new GameEngine(selected[0], selected.slice(1), this.db, {
      ...this.engineOptions,
      seed: 'step42-preflight',
      startingPlayer: 'first',
      rulesVersion: this.engineOptions.rulesVersion || 'step42-strict-rules-v1',
      cardDatabaseVersion: this.engineOptions.cardDatabaseVersion || 'embedded-generated-db',
      invariantChecks: false,
      headless: true,
      validateDecks: false,
      unsupportedInteractionMode: UNSUPPORTED_INTERACTION_MODE.STANDARD,
      strictRulesMode: false,
      simulationPurpose: 'preflight'
    });
    return engine.preflightDeckSupport(selected, { requireStrict: false, purpose: strict ? 'strict-batch-preflight' : 'batch-preflight' });
  }

  createEngine({ seed = 'step38-headless', playerCount = 4, profiling = false, officialSimulation = false, unsupportedInteractionMode = null } = {}) {
    const selected = this._selected(playerCount);
    const mode = unsupportedInteractionMode || (officialSimulation
      ? UNSUPPORTED_INTERACTION_MODE.STRICT
      : UNSUPPORTED_INTERACTION_MODE.STANDARD);
    if (officialSimulation && mode === UNSUPPORTED_INTERACTION_MODE.SANDBOX) {
      throw new Error('Official simulations cannot run in permissive sandbox mode.');
    }
    const engine = new GameEngine(selected[0], selected.slice(1), this.db, {
      ...this.engineOptions,
      seed,
      startingPlayer: 'first',
      rulesVersion: this.engineOptions.rulesVersion || 'step42-strict-rules-v1',
      cardDatabaseVersion: this.engineOptions.cardDatabaseVersion || 'embedded-generated-db',
      invariantChecks: officialSimulation ? true : this.invariantChecks,
      headless: true,
      performanceOptimizations: this.performanceOptimizations,
      profilePerformance: profiling,
      allowPartialSimulationOverride: officialSimulation ? false : !!this.engineOptions.allowPartialSimulationOverride,
      unsupportedInteractionMode: mode,
      strictRulesMode: officialSimulation ? { enabled: true } : (this.engineOptions.strictRulesMode ?? false),
      simulationPurpose: officialSimulation ? 'official-simulation' : 'headless-simulation'
    });
    if (officialSimulation) {
      const preflight = engine.getStrictPreflightReport();
      if (!preflight?.strictReady) throw new Error('Official simulation failed strict startup preflight.');
    }
    return engine;
  }

  runFuzz({ seed = 'step38-headless', playerCount = 4, maxActions = 250, profiling = false, officialSimulation = false, unsupportedInteractionMode = null } = {}) {
    const engine = this.createEngine({ seed, playerCount, profiling, officialSimulation, unsupportedInteractionMode });
    const result = new FuzzBot(engine, { seed, maxActions, persistFailures: false }).run();
    if (officialSimulation && !engine.isSimulationStatisticsEligible()) {
      throw new Error('Official simulation became ineligible for statistics because an unsupported interaction/approximation was encountered.');
    }
    const certification = engine.getSimulationCertification();
    if (officialSimulation && !certification?.certified) {
      throw new Error('Official simulation completed without a valid Step 42 strict certification.');
    }
    return {
      result,
      performance: engine.getPerformanceSnapshot(),
      replay: JSON.parse(engine.serializeReplay()),
      supportPolicy: engine.getUnsupportedInteractionPolicy(),
      strictPreflight: engine.getStrictPreflightReport(),
      certification,
      statisticsEligible: engine.isSimulationStatisticsEligible()
    };
  }

  runOfficialFuzz(options = {}) {
    return this.runFuzz({ ...options, officialSimulation: true });
  }
}
