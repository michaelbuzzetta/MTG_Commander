import { SUPPORT_STATUS } from '../../cards/support/OracleIdentity.js';

export const UNSUPPORTED_INTERACTION_MODE = Object.freeze({
  STANDARD: 'standard',
  STRICT: 'strict',
  SANDBOX: 'sandbox'
});

const VALID_MODES = new Set(Object.values(UNSUPPORTED_INTERACTION_MODE));

function clone(value, fallback = null) {
  if (value == null) return fallback;
  try { return structuredClone(value); } catch { return String(value); }
}

function normalizeMode(value) {
  const mode = String(value || UNSUPPORTED_INTERACTION_MODE.STANDARD).trim().toLowerCase();
  if (!VALID_MODES.has(mode)) throw new Error(`Unknown unsupported-interaction mode "${value}"`);
  return mode;
}

function cardIdentity(engine, ref = null) {
  if (!ref) return null;
  const runtimeDb = engine?.db || engine?.initialDb || {};
  let object = typeof ref === 'object' ? ref : null;
  if (!object && typeof ref === 'string' && engine?.state) {
    object = engine?.zones?.find?.(ref)?.card || engine?.findPermanent?.(ref) || null;
  }
  const cardId = object?.cardId || object?.id || (typeof ref === 'string' && runtimeDb?.[ref] ? ref : null);
  const definition = cardId ? runtimeDb?.[cardId] : null;
  const status = cardId ? engine?.cardSupport?.getCardStatus?.(cardId, runtimeDb) : null;
  if (!cardId && !definition && !status) return null;
  return {
    cardId: cardId || null,
    instanceId: object?.instanceId || object?.gameObjectId || null,
    name: definition?.name || status?.name || object?.name || cardId || null,
    oracleIdentity: status?.oracleIdentity || definition?.supportMetadata?.oracleIdentity || null,
    supportStatus: status?.supportStatus || definition?.supportStatus || null,
    strictEligible: !!(status?.strictEligible ?? definition?.supportMetadata?.strictEligible)
  };
}

function unsupportedMessage(card, message) {
  if (message) return String(message);
  if (card?.name) return `${card.name} requires an interaction that is not supported by the current rules engine.`;
  return 'The requested interaction is not supported by the current rules engine.';
}

export class UnsupportedInteraction extends Error {
  constructor(details = {}) {
    super(details.message || 'Unsupported interaction encountered.');
    this.name = 'UnsupportedInteraction';
    this.code = 'UNSUPPORTED_INTERACTION';
    this.diagnosticId = details.diagnosticId || null;
    this.cardId = details.cardId || details.card?.cardId || null;
    this.cardName = details.cardName || details.card?.name || null;
    this.ability = details.ability || details.abilityId || null;
    this.scriptNode = clone(details.scriptNode, null);
    this.context = clone(details.context, null);
    this.rulesVersion = details.rulesVersion || null;
    this.gameId = details.gameId || null;
    this.turn = details.turn ?? null;
    this.phase = details.phase || null;
    this.eventId = details.eventId || null;
    this.stackObjectId = details.stackObjectId || null;
    this.actionSequence = details.actionSequence ?? null;
    this.supportStatus = details.supportStatus || null;
    this.suggestedSupportStatus = details.suggestedSupportStatus || SUPPORT_STATUS.PARTIAL;
    this.mode = details.mode || UNSUPPORTED_INTERACTION_MODE.STANDARD;
    this.rollback = details.rollback || null;
    this.statisticsEligible = details.statisticsEligible !== false;
    this.detail = clone(details.detail, null);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      diagnosticId: this.diagnosticId,
      cardId: this.cardId,
      cardName: this.cardName,
      ability: this.ability,
      scriptNode: clone(this.scriptNode, null),
      context: clone(this.context, null),
      rulesVersion: this.rulesVersion,
      gameId: this.gameId,
      turn: this.turn,
      phase: this.phase,
      eventId: this.eventId,
      stackObjectId: this.stackObjectId,
      actionSequence: this.actionSequence,
      supportStatus: this.supportStatus,
      suggestedSupportStatus: this.suggestedSupportStatus,
      mode: this.mode,
      rollback: this.rollback,
      statisticsEligible: this.statisticsEligible,
      detail: clone(this.detail, null)
    };
  }
}

/**
 * Step 41 fail-safe for interactions the engine cannot faithfully execute.
 *
 * Standard/strict modes stop before guessing. Sandbox mode may explicitly use
 * a caller-supplied approximation, but every such use is labeled and marks the
 * run ineligible for official statistics.
 */
export class UnsupportedInteractionService {
  constructor(engine, { mode = UNSUPPORTED_INTERACTION_MODE.STANDARD, simulationPurpose = 'gameplay', allowPartialSimulationOverride = false, maxDiagnostics = 100 } = {}) {
    this.engine = engine;
    this.mode = normalizeMode(mode);
    this.simulationPurpose = String(simulationPurpose || 'gameplay');
    this.allowPartialSimulationOverride = !!allowPartialSimulationOverride;
    this.maxDiagnostics = Math.max(1, Number(maxDiagnostics || 100));
    this.sequence = 0;
    this.diagnostics = [];
    this.statisticsEligible = this.mode !== UNSUPPORTED_INTERACTION_MODE.SANDBOX;
    this.statisticsExclusionReasons = this.mode === UNSUPPORTED_INTERACTION_MODE.SANDBOX
      ? ['Permissive sandbox mode is excluded from official simulation/statistics output.']
      : [];
  }

  isStrict() { return this.mode === UNSUPPORTED_INTERACTION_MODE.STRICT; }
  isSandbox() { return this.mode === UNSUPPORTED_INTERACTION_MODE.SANDBOX; }

  policySnapshot() {
    return {
      mode: this.mode,
      simulationPurpose: this.simulationPurpose,
      allowPartialSimulationOverride: this.allowPartialSimulationOverride,
      strict: this.isStrict(),
      sandbox: this.isSandbox(),
      statisticsEligible: !!this.statisticsEligible,
      statisticsExclusionReasons: [...this.statisticsExclusionReasons],
      diagnosticCount: this.diagnostics.length,
      guarantees: this.isSandbox()
        ? ['Unsupported behavior may be approximated only when explicitly encountered and is always labeled.', 'Sandbox output is not eligible for official statistics.']
        : ['Unsupported behavior raises UNSUPPORTED_INTERACTION instead of being silently approximated.']
    };
  }

  _nextDiagnosticId() {
    this.sequence += 1;
    return `unsupported-${String(this.sequence).padStart(6, '0')}`;
  }

  _runtimeContext(details = {}) {
    const e = this.engine;
    const card = cardIdentity(e, details.card || details.source || details.cardId || details.cardInstanceId || details.permanentId || null);
    return {
      diagnosticId: details.diagnosticId || this._nextDiagnosticId(),
      message: unsupportedMessage(card, details.message),
      card,
      cardId: details.cardId || card?.cardId || null,
      cardName: details.cardName || card?.name || null,
      ability: details.ability || details.abilityId || null,
      scriptNode: clone(details.scriptNode || details.node, null),
      context: clone(details.context, null),
      rulesVersion: e?.rulesVersion || details.rulesVersion || null,
      gameId: e?.gameId || details.gameId || null,
      turn: e?.state?.turn ?? details.turn ?? null,
      phase: e?.state?.phase || details.phase || null,
      eventId: e?.events?.currentEventId?.() || details.eventId || null,
      stackObjectId: details.stackObjectId || e?._activeActionContext?.stackObjectId || null,
      actionSequence: e?._activeActionContext?.sequence ?? e?._actionSequence ?? details.actionSequence ?? null,
      supportStatus: details.supportStatus || card?.supportStatus || null,
      suggestedSupportStatus: details.suggestedSupportStatus || SUPPORT_STATUS.PARTIAL,
      detail: clone(details.detail, null)
    };
  }

  _diagnosticBundle(base, { outcome, approximation = null, rollback = null } = {}) {
    const e = this.engine;
    let stateHash = null;
    let replayMetadata = null;
    try { stateHash = e?.replay?.stateHash?.() || null; } catch {}
    try { replayMetadata = e?.replay?.metadata?.() || null; } catch {}
    return {
      ...base,
      code: 'UNSUPPORTED_INTERACTION',
      mode: this.mode,
      simulationPurpose: this.simulationPurpose,
      outcome,
      approximation: clone(approximation, null),
      rollback: rollback || null,
      statisticsEligible: !!this.statisticsEligible,
      stateHash,
      replayMetadata,
      activeAction: clone(e?._activeActionContext, null),
      recentEvents: clone(e?.events?.getLogSnapshot?.()?.slice(-12), []),
      timestamp: new Date().toISOString()
    };
  }

  _remember(record) {
    this.diagnostics.push(record);
    if (this.diagnostics.length > this.maxDiagnostics) this.diagnostics.splice(0, this.diagnostics.length - this.maxDiagnostics);
    return record;
  }

  markStatisticsIneligible(reason) {
    this.statisticsEligible = false;
    if (reason && !this.statisticsExclusionReasons.includes(reason)) this.statisticsExclusionReasons.push(reason);
  }

  encounter(details = {}, { approximation = null } = {}) {
    const base = this._runtimeContext(details);
    if (this.isSandbox()) {
      const approximationRecord = approximation || {
        kind: 'explicit-no-op',
        description: 'Unsupported interaction was skipped in permissive sandbox mode.'
      };
      const reason = `Sandbox approximation used: ${base.cardName || base.cardId || base.ability || 'unsupported interaction'}.`;
      this.markStatisticsIneligible(reason);
      const record = this._remember(this._diagnosticBundle(base, { outcome: 'sandbox-approximation', approximation: approximationRecord }));
      this.engine?.logger?.recordDeveloper?.('unsupported-sandbox-approximation', base.message, record);
      return { allowed: true, approximated: true, diagnostic: clone(record) };
    }

    const record = this._remember(this._diagnosticBundle(base, { outcome: 'halted' }));
    const error = new UnsupportedInteraction({ ...record, statisticsEligible: this.statisticsEligible });
    error.diagnostic = clone(record);
    throw error;
  }

  annotateRollback(error, rollback = 'action-checkpoint-restored') {
    if (!error || error.code !== 'UNSUPPORTED_INTERACTION') return error;
    error.rollback = rollback;
    const row = this.diagnostics.find(item => item.diagnosticId === error.diagnosticId);
    if (row) row.rollback = rollback;
    if (error.diagnostic) error.diagnostic.rollback = rollback;
    return error;
  }

  preflightDeck(deck, db = this.engine?.db || this.engine?.initialDb || {}) {
    return this.engine?.cardSupport?.deckReadiness?.(deck, db) || {
      deckId: deck?.id || null,
      name: deck?.name || null,
      strictReady: false,
      blockers: [{ cardId: null, name: deck?.name || 'Deck', reason: 'Card-support service unavailable.' }]
    };
  }

  preflightDecks(decks = [], { requireStrict = this.isStrict(), purpose = this.simulationPurpose } = {}) {
    const rows = (Array.isArray(decks) ? decks : [decks]).filter(Boolean).map(deck => this.preflightDeck(deck, this.engine?.initialDb || this.engine?.db || {}));
    const blockers = rows.flatMap(row => (row.blockers || []).map(blocker => ({ deckId: row.deckId, deckName: row.name, ...blocker })));
    const report = {
      purpose,
      requireStrict: !!requireStrict,
      deckCount: rows.length,
      strictReady: rows.length > 0 && blockers.length === 0,
      decks: rows,
      blockers,
      statisticsEligible: blockers.length === 0 && !this.isSandbox()
    };
    if (requireStrict && blockers.length) {
      const first = blockers[0];
      this.encounter({
        message: `Strict support preflight blocked ${blockers.length} card entr${blockers.length === 1 ? 'y' : 'ies'} across ${rows.length} deck${rows.length === 1 ? '' : 's'}. First blocker: ${first.name || first.cardId}.`,
        cardId: first.cardId,
        cardName: first.name,
        supportStatus: first.status || null,
        suggestedSupportStatus: SUPPORT_STATUS.FULL,
        context: { kind: 'deck-preflight', purpose, blockers: blockers.slice(0, 50) },
        detail: { deckReports: rows }
      });
    }
    return report;
  }

  assertCardSupported(ref, details = {}) {
    const card = cardIdentity(this.engine, ref);
    if (!card) {
      if (this.isStrict()) return this.encounter({ ...details, card: ref, message: details.message || 'Strict mode encountered a card/object without support metadata.', suggestedSupportStatus: SUPPORT_STATUS.FULL });
      return { allowed: true, approximated: false };
    }
    const definition = card.cardId ? this.engine?.db?.[card.cardId] : null;
    const explicitlyUnsupported = definition?.supported === false || card.supportStatus === SUPPORT_STATUS.UNSUPPORTED;
    const strictBlocked = this.isStrict() && !card.strictEligible;
    if (!explicitlyUnsupported && !strictBlocked) return { allowed: true, approximated: false };
    return this.encounter({
      ...details,
      card: ref,
      cardId: card.cardId,
      cardName: card.name,
      supportStatus: card.supportStatus,
      suggestedSupportStatus: strictBlocked ? SUPPORT_STATUS.FULL : SUPPORT_STATUS.PARTIAL,
      message: details.message || (strictBlocked
        ? `${card.name || card.cardId} is not certified for strict rules mode.`
        : (definition?.unsupportedReason || `${card.name || card.cardId} is explicitly unsupported.`))
    }, {
      approximation: { kind: 'existing-partial-implementation', description: `Continue with the currently implemented behavior for ${card.name || card.cardId}.` }
    });
  }

  assertActionSupported(action = {}) {
    const ref = action.cardInstanceId || action.permanentId || action.sourceInstanceId || null;
    if (!ref) return { allowed: true, approximated: false };
    return this.assertCardSupported(ref, { context: { kind: 'action-preflight', actionType: action.type || null } });
  }

  diagnosticsSnapshot() { return clone(this.diagnostics, []); }
}
