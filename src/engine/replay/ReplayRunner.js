import { GameEngine } from '../GameEngine.js';
import { REPLAY_SCHEMA, REPLAY_VERSION } from './ReplayService.js';
import { RulesVersionService, CURRENT_RULES_VERSION } from '../rules-version/index.js';

function parseReplay(replay) {
  const parsed = typeof replay === 'string' ? JSON.parse(replay) : structuredClone(replay);
  if (!parsed || parsed.schema !== REPLAY_SCHEMA || parsed.schemaVersion !== REPLAY_VERSION) throw new Error('Unsupported replay format');
  return parsed;
}

export class ReplayRunner {
  static run(replayInput, { deckA, deckB, db, verifyHashes = true, runtimeRulesVersion = null } = {}) {
    const replay = parseReplay(replayInput);
    if (!deckA || !deckB || !db) throw new Error('ReplayRunner requires deckA, deckB and db');
    const metadata = replay.metadata || {};
    const effectiveRulesVersion = runtimeRulesVersion || metadata.rulesVersion || CURRENT_RULES_VERSION;
    const versionService = new RulesVersionService({ currentVersion: effectiveRulesVersion });
    versionService.validateReplay(metadata, effectiveRulesVersion, { throwOnFailure: true });
    const engine = new GameEngine(deckA, deckB, db, {
      seed: metadata.seed ?? replay.rng?.seed,
      startingPlayer: replay.pregameConfig?.startingPlayer ?? 'first',
      validateDecks: replay.pregameConfig?.validateDecks ?? true,
      formatRules: replay.pregameConfig?.formatRules || {},
      uidSequenceStart: metadata.uidSequenceStart ?? 0,
      rulesVersion: effectiveRulesVersion,
      cardDatabaseVersion: metadata.cardDatabaseVersion || 'embedded-generated-db'
    });
    if (replay.started) engine.start();
    const checkpoints = [];
    for (const entry of replay.actions || []) {
      const response = entry.kind === 'choice'
        ? engine.submitChoice(entry.playerId, entry.action)
        : (entry.action?.type === 'PASS_PRIORITY' ? engine.passPriority(entry.playerId) : engine.submitAction(entry.playerId, entry.action));
      if (!response.ok) throw new Error(`Replay action ${entry.sequence} failed: ${response.error?.message || 'unknown error'}`);
      if (verifyHashes && entry.stateHash) {
        const actual = engine.getReplayStateHash();
        if (actual !== entry.stateHash) throw new Error(`Replay state hash mismatch at action ${entry.sequence}: expected ${entry.stateHash}, received ${actual}`);
      }
      checkpoints.push({ sequence: entry.sequence, stateHash: engine.getReplayStateHash() });
    }
    const finalStateHash = engine.getReplayStateHash();
    if (verifyHashes && replay.finalStateHash && finalStateHash !== replay.finalStateHash) {
      throw new Error(`Replay final state hash mismatch: expected ${replay.finalStateHash}, received ${finalStateHash}`);
    }
    return { engine, finalStateHash, checkpoints };
  }
}
