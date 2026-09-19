import { hashState } from './StateHasher.js';
import { currentUidSequence, setUidSequence } from '../utils.js';
import { GAME_ENGINE_API_VERSION } from '../public/api.js';

export const REPLAY_SCHEMA = 'mtg-commander-replay';
export const REPLAY_VERSION = 1;
export const CHECKPOINT_SCHEMA = 'mtg-commander-checkpoint';
export const CHECKPOINT_VERSION = 1;

export class ReplayService {
  constructor(engine) {
    this.engine = engine;
  }

  stateHash() {
    return hashState(this.engine.state);
  }

  metadata() {
    const e = this.engine;
    return {
      rulesVersion: e.rulesVersion || 'mtg-cr-2026-08-07',
      cardDatabaseVersion: e.cardDatabaseVersion || 'embedded-generated-db',
      engineBuild: 'step42-strict-release-gate',
      seed: e.random.snapshot().seed,
      rng: e.random.snapshot(),
      uidSequenceStart: e._uidSequenceStart ?? 0,
      gameId: e.gameId || null,
      simulationPurpose: e.simulationPurpose || 'gameplay',
      unsupportedInteractionMode: e.unsupported?.mode || 'standard',
      allowPartialSimulationOverride: !!e.unsupported?.allowPartialSimulationOverride,
      statisticsEligible: e.unsupported?.statisticsEligible !== false,
      unsupportedDiagnosticCount: e.unsupported?.diagnostics?.length || 0,
      strictRulesMode: e.strictRules?.configSnapshot?.() || { enabled: false },
      strictPreflightReady: e.strictRules?.preflightSnapshot?.()?.strictReady ?? null,
      rulesVersionDescriptor: e.rulesVersions?.descriptor?.(e.rulesVersion) || null
    };
  }

  createCheckpoint(label = null) {
    const e = this.engine;
    return {
      schema: CHECKPOINT_SCHEMA,
      schemaVersion: CHECKPOINT_VERSION,
      label,
      createdAtActionSequence: e._actionSequence,
      state: e.serializeState(),
      rng: e.random.snapshot(),
      runtimeIdSequence: e._runtimeIdSequence || 0,
      uidSequence: currentUidSequence(),
      actionSequence: e._actionSequence,
      replayActions: structuredClone(e._replayActions),
      aiDecisions: structuredClone(e._aiDecisions),
      aiDecisionSequence: e._aiDecisionSequence,
      stateHash: this.stateHash()
    };
  }

  restoreCheckpoint(checkpoint) {
    if (!checkpoint || checkpoint.schema !== CHECKPOINT_SCHEMA || checkpoint.schemaVersion !== CHECKPOINT_VERSION) {
      throw new Error('Unsupported replay checkpoint format');
    }
    const e = this.engine;
    if (checkpoint.uidSequence != null) setUidSequence(checkpoint.uidSequence);
    e.restoreState(checkpoint.state, { internal: true, reason: 'replay-checkpoint-restore' });
    e.random.restore(checkpoint.rng);
    e._runtimeIdSequence = Number(checkpoint.runtimeIdSequence || 0);
    e._actionSequence = Number(checkpoint.actionSequence || 0);
    e._replayActions = structuredClone(checkpoint.replayActions || []);
    e._aiDecisions = structuredClone(checkpoint.aiDecisions || []);
    e._aiDecisionSequence = Number(checkpoint.aiDecisionSequence || 0);
    const actual = this.stateHash();
    if (checkpoint.stateHash && checkpoint.stateHash !== actual) {
      throw new Error(`Checkpoint state hash mismatch: expected ${checkpoint.stateHash}, received ${actual}`);
    }
    return e.getStateSnapshot();
  }

  serialize() {
    const e = this.engine;
    const random = e.random.snapshot();
    return {
      schema: REPLAY_SCHEMA,
      schemaVersion: REPLAY_VERSION,
      apiVersion: GAME_ENGINE_API_VERSION,
      engine: 'MTG AI Trainer GameEngine',
      metadata: this.metadata(),
      started: !!e.state.started,
      initialDecks: {
        player: { id: e.initialDeckA?.id || e.initialDeckA?.name || null, version: e.initialDeckA?.version || null },
        opponents: (Array.isArray(e.initialDeckB) ? e.initialDeckB : [e.initialDeckB]).filter(Boolean).map(deck => ({ id: deck.id || deck.name || null, version: deck.version || null }))
      },
      pregameConfig: structuredClone(e._pregameConfig),
      actions: structuredClone(e._replayActions),
      aiDecisions: structuredClone(e._aiDecisions),
      finalStateHash: this.stateHash(),
      rng: random,
      history: structuredClone(e.state.history || []),
      turnHistory: structuredClone(e.state.turnHistory || []),
      skippedTurnHistory: structuredClone(e.state.skippedTurnHistory || []),
      turnState: e.turn.getSnapshot(),
      loops: e.loops.snapshot(),
      safetyBudget: e.safety.snapshot(),
      legality: e.legality.snapshot(),
      timing: e.timing.snapshot(),
      unsupportedInteractions: e.unsupported ? {
        policy: e.unsupported.policySnapshot(),
        diagnostics: e.unsupported.diagnosticsSnapshot()
      } : null,
      strictCertification: e.strictRules?.certificationSnapshot?.() || null,
      events: e.events.getLogSnapshot(),
      rulesLogs: e.logger ? {
        player: e.logger.playerLog(),
        developer: e.logger.developerLog(),
        verbose: e.logger.verboseTrace()
      } : { player: [], developer: [], verbose: [] }
    };
  }
}
