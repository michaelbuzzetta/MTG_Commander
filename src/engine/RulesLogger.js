const LEVEL = Object.freeze({ PLAYER: 'player', DEVELOPER: 'developer', VERBOSE: 'verbose' });
const LEVELS = new Set(Object.values(LEVEL));

function safeClone(value) {
  if (value == null) return value;
  try { return structuredClone(value); } catch { return String(value); }
}

function objectId(value) {
  if (!value || typeof value !== 'object') return null;
  return value.gameObjectId || value.instanceId || value.stackObjectId || value.requestId || value.eventId || value.id || null;
}

function collectStableIds(value, out = {}, seen = new Set(), depth = 0) {
  if (value == null || depth > 4) return out;
  if (typeof value !== 'object') return out;
  if (seen.has(value)) return out;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 50)) collectStableIds(item, out, seen, depth + 1);
    return out;
  }
  const mappings = [
    ['gameObjectId', 'gameObjectIds'], ['instanceId', 'gameObjectIds'], ['eventId', 'eventIds'],
    ['stackObjectId', 'stackObjectIds'], ['stackItemId', 'stackObjectIds'], ['playerId', 'playerIds'],
    ['controller', 'playerIds'], ['sourceController', 'playerIds'], ['scriptId', 'abilityIds'],
    ['abilityId', 'abilityIds'], ['requestId', 'choiceRequestIds']
  ];
  for (const [key, bucket] of mappings) {
    const raw = value[key];
    if (raw == null || typeof raw === 'object') continue;
    out[bucket] ||= [];
    const text = String(raw);
    if (!out[bucket].includes(text)) out[bucket].push(text);
  }
  for (const nested of Object.values(value)) collectStableIds(nested, out, seen, depth + 1);
  return out;
}

function summarizeAction(action = {}) {
  const result = {};
  for (const [key, value] of Object.entries(action || {})) {
    if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) result[key] = value;
    else if (Array.isArray(value)) result[key] = value.map(item => (item == null || ['string', 'number', 'boolean'].includes(typeof item)) ? item : objectId(item) || '[object]');
    else result[key] = objectId(value) || '[object]';
  }
  return result;
}

function playerMessageForEvent(record) {
  const p = record.payload || {};
  switch (record.type) {
    case 'DRAW_CARD': return `${p.playerId || 'A player'} drew a card.`;
    case 'DEAL_DAMAGE': return `${p.sourceController || 'A source'} dealt ${p.amount ?? '?'} damage.`;
    case 'GAIN_LIFE': return `${p.playerId || 'A player'} gained ${p.amount ?? '?'} life.`;
    case 'LOSE_LIFE': return `${p.playerId || 'A player'} lost ${p.amount ?? '?'} life.`;
    case 'MOVE_ZONE': return `A card moved${p.toZone ? ` to ${p.toZone}` : ' between zones'}.`;
    case 'CAST': return `${p.playerId || 'A player'} cast a spell.`;
    case 'ATTACK': return `${p.playerId || 'A player'} declared attackers.`;
    case 'BLOCK': return `${p.playerId || 'A player'} declared blockers.`;
    default: return null;
  }
}

export class RulesLogger {
  constructor(engine, { verbose = false, maxEntries = 5000, enabled = true } = {}) {
    this.engine = engine;
    this.enabled = enabled !== false;
    this.verboseEnabled = !!verbose;
    this.maxEntries = Math.max(100, Number(maxEntries) || 5000);
    this.sequence = 0;
    this.entries = [];
    this.unsubscribe = this.enabled ? (engine.events?.subscribe?.('*', record => this.recordEvent(record)) || null) : null;
  }

  _push(level, kind, message, detail = {}, ids = null) {
    if (!this.enabled) return null;
    if (!LEVELS.has(level)) throw new Error(`Unknown rules log level ${level}`);
    if (level === LEVEL.VERBOSE && !this.verboseEnabled) return null;
    const entry = Object.freeze({
      logId: `rules-log-${++this.sequence}`,
      sequence: this.sequence,
      level,
      kind,
      turn: this.engine.state.turn,
      phase: this.engine.state.phase,
      activePlayer: this.engine.state.activePlayer || null,
      priorityPlayer: this.engine.state.priorityPlayer || null,
      actionSequence: this.engine._activeActionContext?.sequence || this.engine._actionSequence || 0,
      message: String(message || kind),
      ids: ids || collectStableIds(detail),
      detail: safeClone(detail)
    });
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) this.entries.splice(0, this.entries.length - this.maxEntries);
    return entry;
  }

  recordPlayer(message, detail = {}) { return this._push(LEVEL.PLAYER, 'player', message, detail); }
  recordDeveloper(kind, message, detail = {}) { return this._push(LEVEL.DEVELOPER, kind, message, detail); }
  recordVerbose(kind, message, detail = {}) { return this._push(LEVEL.VERBOSE, kind, message, detail); }

  recordLegacy(type, data = {}) {
    const entry = this.recordDeveloper('engine-log', type, { type, ...safeClone(data) });
    if (/PLAYER_ELIMINATED|TURN_COMPLETED|STACK_ITEM_COUNTERED/.test(type)) this.recordPlayer(type.replaceAll('_', ' ').toLowerCase(), data);
    if (/SBA|RULE_|WARD_|TRIGGER_|COUNTERED_ON_RESOLUTION|PARTIAL_TARGET_RESOLUTION/.test(type)) {
      this.recordVerbose('rules-intervention', type, data);
    }
    return entry;
  }

  recordActionRequested(playerId, action, kind = 'action') {
    return this.recordDeveloper('action-requested', `Action requested: ${action?.type || 'UNKNOWN'}`, { playerId, kind, action: summarizeAction(action) });
  }

  recordActionValidated(playerId, action, kind = 'action') {
    return this.recordVerbose('action-validated', `Action validated: ${action?.type || 'UNKNOWN'}`, { playerId, kind, action: summarizeAction(action) });
  }

  recordActionRejected(playerId, action, error, stage = 'validation') {
    const diagnostic = error?.diagnostic ? safeClone(error.diagnostic) : null;
    return this.recordDeveloper('action-rejected', `Action rejected: ${error?.message || String(error)}`, {
      playerId, stage, action: summarizeAction(action), errorCode: error?.code || null, diagnostic
    });
  }

  recordActionCompleted(playerId, action, result, kind = 'action') {
    return this.recordDeveloper('action-completed', `Action completed: ${action?.type || 'UNKNOWN'}`, {
      playerId, kind, action: summarizeAction(action), result: objectId(result) || (['string','number','boolean'].includes(typeof result) ? result : result == null ? null : '[object]'),
      stateHash: this.engine.replay?.stateHash?.() || null
    });
  }

  recordEvent(record) {
    this.recordDeveloper('event', `${record.type} ${record.status}`, record);
    const playerMessage = playerMessageForEvent(record);
    if (playerMessage && (record.status === 'committed' || record.status === 'observed')) this.recordPlayer(playerMessage, { eventId: record.eventId, type: record.type });
    if ((record.replacementTrace || []).length) this.recordVerbose('replacement', `Replacement effect(s) applied to ${record.type}`, { eventId: record.eventId, trace: record.replacementTrace });
    if ((record.preventionTrace || []).length) this.recordVerbose('prevention', `Prevention effect(s) applied to ${record.type}`, { eventId: record.eventId, trace: record.preventionTrace });
  }

  traceLegality(operation, playerId, context = {}) {
    const result = this.engine.legality.assess(operation, playerId, context);
    this.recordVerbose('legality', result.allowed ? `${result.operation} allowed` : `${result.operation} denied`, result);
    return safeClone(result);
  }

  traceCharacteristics(object) {
    const result = this.engine.continuous.characteristics(object, { trace: true });
    this.recordVerbose('layers', `Derived characteristics evaluated for ${object?.instanceId || object?.gameObjectId || object?.cardId || 'object'}`, result);
    return safeClone(result);
  }

  setVerbose(enabled) { this.verboseEnabled = !!enabled; return this.verboseEnabled; }

  clear() { this.entries = []; this.sequence = 0; }

  snapshot({ level = null, sinceSequence = 0 } = {}) {
    const normalized = level == null ? null : String(level).toLowerCase();
    if (normalized && !LEVELS.has(normalized)) throw new Error(`Unknown rules log level ${level}`);
    return safeClone(this.entries.filter(entry => (!normalized || entry.level === normalized) && entry.sequence > Number(sinceSequence || 0)));
  }

  playerLog() { return this.snapshot({ level: LEVEL.PLAYER }); }
  developerLog() { return this.snapshot({ level: LEVEL.DEVELOPER }); }
  verboseTrace() { return this.snapshot({ level: LEVEL.VERBOSE }); }

  diagnosticBundle({ includeState = true, includeReplay = true } = {}) {
    const replay = this.engine.replay;
    return {
      schema: 'mtg-commander-diagnostic-bundle',
      schemaVersion: 1,
      metadata: replay?.metadata?.() || {},
      reproduction: {
        seed: this.engine.random?.snapshot?.().seed ?? null,
        turn: this.engine.state.turn,
        phase: this.engine.state.phase,
        actionIndex: this.engine._actionSequence || 0,
        eventIndex: this.engine.events?.sequenceCursor || 0,
        rulesVersion: this.engine.rulesVersion || null,
        cardDatabaseVersion: this.engine.cardDatabaseVersion || null,
        stateHash: replay?.stateHash?.() || null
      },
      logs: {
        player: this.playerLog(),
        developer: this.developerLog(),
        verbose: this.verboseTrace()
      },
      eventLog: this.engine.events?.getLogSnapshot?.() || [],
      rejectedEvents: safeClone(this.engine.events?.rejectedEvents || []),
      replacementTrace: this.engine.replacements?.getTraceSnapshot?.() || [],
      legalityDiagnostics: this.engine.legality?.getDiagnostics?.() || [],
      invariantReport: safeClone(this.engine.invariants?.lastReport || null),
      ...(includeState ? { state: this.engine.serializeState() } : {}),
      ...(includeReplay ? { replay: this.engine.replay?.serialize?.() || null } : {})
    };
  }
}

export { LEVEL as RULES_LOG_LEVEL };
