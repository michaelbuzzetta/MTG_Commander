import { PerformanceProfiler } from './PerformanceProfiler.js';

const TOPOLOGY_EVENTS = new Set([
  'CAST', 'COPY', 'DRAW_CARD', 'DISCARD_CARD', 'MILL_CARD', 'MOVE_ZONE',
  'DESTROY', 'SACRIFICE', 'EXILE', 'CREATE_TOKEN', 'TRANSFORM', 'CONTROL_CHANGE'
]);

function objectKey(object) {
  return object?.gameObjectId || object?.instanceId || null;
}

export class PerformanceService {
  constructor(engine, {
    enabled = true,
    profiling = false,
    cacheDerivedCharacteristics = true,
    cacheLegalActions = true,
    cacheZoneCandidates = true
  } = {}) {
    this.engine = engine;
    this.enabled = enabled !== false;
    this.profiler = new PerformanceProfiler({ enabled: profiling });
    this.cacheDerivedCharacteristics = this.enabled && cacheDerivedCharacteristics !== false;
    this.cacheLegalActions = this.enabled && cacheLegalActions !== false;
    this.cacheZoneCandidates = this.enabled && cacheZoneCandidates !== false;
    this.stateRevision = 0;
    this.topologyRevision = 0;
    this.derivedCache = new Map();
    this.legalActionCache = new Map();
    this.zoneCache = new Map();
    this.stats = {
      mutations: 0,
      topologyMutations: 0,
      derivedHits: 0,
      derivedMisses: 0,
      legalActionHits: 0,
      legalActionMisses: 0,
      zoneHits: 0,
      zoneMisses: 0
    };
  }

  reset() {
    this.stateRevision = 0;
    this.topologyRevision = 0;
    this.derivedCache.clear();
    this.legalActionCache.clear();
    this.zoneCache.clear();
    for (const key of Object.keys(this.stats)) this.stats[key] = 0;
    this.profiler.reset();
  }

  eventChangesTopology(eventType) {
    return TOPOLOGY_EVENTS.has(String(eventType || ''));
  }

  markMutation(reason = 'mutation', { topology = false } = {}) {
    if (!this.enabled) return this.stateRevision;
    this.stateRevision += 1;
    this.stats.mutations += 1;
    this.derivedCache.clear();
    this.legalActionCache.clear();
    this.zoneCache.clear();
    if (topology) {
      this.topologyRevision += 1;
      this.stats.topologyMutations += 1;
    }
    this.lastMutationReason = String(reason || 'mutation');
    return this.stateRevision;
  }

  markTopology(reason = 'topology') {
    return this.markMutation(reason, { topology: true });
  }

  afterEvent(eventType) {
    return this.markMutation(`event:${eventType}`, { topology: this.eventChangesTopology(eventType) });
  }

  stableQueryBoundary() {
    return !(this.engine?._activeActionContext) && !(this.engine?.events?.eventStack?.length);
  }


  derivedDependencyFingerprint() {
    const state = this.engine.state;
    const parts = [`turn:${state.turn}`, `phase:${state.phase}`, `continuous:${state.continuousTimestampSequence || 0}:${state.continuousEffects?.length || 0}`];
    for (const playerId of state.playerOrder || Object.keys(state.players)) {
      const player = state.players[playerId];
      parts.push(`p:${playerId}:${player?.life ?? ''}:${player?.hand?.length || 0}:${player?.library?.length || 0}:${player?.graveyard?.length || 0}:${player?.exile?.length || 0}`);
      const pc = Object.entries(player?.counters || {}).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join(',');
      parts.push(`pc:${pc}`);
      for (const permanent of player?.battlefield || []) {
        const counters = Object.entries(permanent.counters || {}).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join(',');
        const modifiers = `${permanent.modifiers?.power || 0}/${permanent.modifiers?.toughness || 0}/${(permanent.modifiers?.keywords || []).join('.')}`;
        parts.push(`b:${permanent.gameObjectId || permanent.instanceId}:${permanent.cardId}:${permanent.controller}:${permanent.tapped ? 1 : 0}:${permanent.phasedOut ? 1 : 0}:${permanent.faceDown ? 1 : 0}:${permanent.chosenType || ''}:${permanent.attachedTo || ''}:${permanent.copyState?.timestamp || ''}:${permanent.faceState?.currentFaceIndex ?? ''}:${counters}:${modifiers}`);
      }
    }
    for (const attachment of state.attachments || []) parts.push(`a:${attachment.attachedId || ''}:${attachment.hostId || ''}:${attachment.timestamp || ''}`);
    return parts.join('|');
  }

  getDerived(object) {
    if (!this.cacheDerivedCharacteristics || !this.stableQueryBoundary()) return null;
    const id = objectKey(object);
    if (!id) return null;
    const row = this.derivedCache.get(id);
    const fingerprint = this.derivedDependencyFingerprint();
    if (!row || row.revision !== this.stateRevision || row.fingerprint !== fingerprint) {
      this.stats.derivedMisses += 1;
      return null;
    }
    this.stats.derivedHits += 1;
    return row.value;
  }

  setDerived(object, value) {
    if (!this.cacheDerivedCharacteristics || !this.stableQueryBoundary()) return value;
    const id = objectKey(object);
    if (!id) return value;
    this.derivedCache.set(id, { revision: this.stateRevision, fingerprint: this.derivedDependencyFingerprint(), value });
    return value;
  }


  legalActionDependencyFingerprint(playerId) {
    const state = this.engine.state;
    const parts = [
      `turn:${state.turn}`, `phase:${state.phase}`, `active:${state.activePlayer || ''}`, `priority:${state.priorityPlayer || ''}`,
      `turnAction:${state.turnActionPending || ''}`, `winner:${state.winner || ''}`,
      `choice:${state.pendingChoice?.requestId || ''}:${state.pendingChoice?.type || ''}:${state.pendingChoice?.playerId || ''}`,
      `stack:${(state.stack || []).map(item => item.id || item.gameObjectId || item.card?.instanceId || '').join(',')}`
    ];
    for (const pid of state.playerOrder || Object.keys(state.players)) {
      const player = state.players[pid];
      parts.push(`p:${pid}:${player?.lost ? 1 : 0}:${player?.life ?? ''}:${player?.landPlaysRemaining ?? ''}:${JSON.stringify(player?.manaPool || {})}`);
      for (const zone of ['hand', 'command', 'graveyard', 'exile', 'battlefield']) {
        const rows = (player?.[zone] || []).map(card => `${card.instanceId}:${card.cardId}:${card.tapped ? 1 : 0}:${card.phasedOut ? 1 : 0}:${card.foretold ? 1 : 0}:${card.copyState?.timestamp || ''}:${Object.entries(card.counters || {}).sort().map(([k,v])=>`${k}=${v}`).join('.')}`);
        parts.push(`${zone}:${rows.join(',')}`);
      }
      const library = player?.library || [];
      const top = library[0];
      parts.push(`library:${library.length}:${top?.instanceId || ''}:${top?.cardId || ''}`);
    }
    return `${playerId}|${parts.join('|')}`;
  }

  zoneFingerprint(zone) {
    if (zone === 'stack') return (this.engine.state.stack || []).map(item => `${item.id || ''}:${item.card?.instanceId || ''}`).join('|');
    const rows = [];
    for (const playerId of this.engine.state.playerOrder || Object.keys(this.engine.state.players)) {
      for (const card of this.engine.state.players[playerId]?.[zone] || []) rows.push(`${playerId}:${card.gameObjectId || card.instanceId}:${card.cardId}:${card.controller || ''}:${card.phasedOut ? 1 : 0}`);
    }
    return rows.join('|');
  }

  memoLegalActions(playerId, compute) {
    if (!this.cacheLegalActions || !this.stableQueryBoundary()) return this.profiler.measure('legal-actions.compute', compute);
    const key = String(playerId);
    const fingerprint = this.legalActionDependencyFingerprint(playerId);
    const cached = this.legalActionCache.get(key);
    if (cached && cached.revision === this.stateRevision && cached.fingerprint === fingerprint) {
      this.stats.legalActionHits += 1;
      return structuredClone(cached.value);
    }
    this.stats.legalActionMisses += 1;
    const result = this.profiler.measure('legal-actions.compute', compute);
    this.legalActionCache.set(key, { revision: this.stateRevision, fingerprint, value: structuredClone(result) });
    return result;
  }

  zoneCandidates(zone) {
    if (!this.cacheZoneCandidates || !this.stableQueryBoundary()) return this.#buildZone(zone);
    const key = String(zone);
    const fingerprint = this.zoneFingerprint(zone);
    const cached = this.zoneCache.get(key);
    if (cached && cached.revision === this.stateRevision && cached.fingerprint === fingerprint) {
      this.stats.zoneHits += 1;
      return cached.value;
    }
    this.stats.zoneMisses += 1;
    const built = this.profiler.measure(`zone-index.${zone}`, () => this.#buildZone(zone));
    this.zoneCache.set(key, { revision: this.stateRevision, fingerprint, value: built });
    return built;
  }

  #buildZone(zone) {
    if (zone === 'stack') {
      return (this.engine.state.stack || []).map(item => ({ playerId: item.controller || null, card: item.card, item })).filter(row => row.card);
    }
    const out = [];
    for (const playerId of this.engine.state.playerOrder || Object.keys(this.engine.state.players)) {
      const player = this.engine.state.players[playerId];
      for (const card of player?.[zone] || []) out.push({ playerId, card });
    }
    return out;
  }


  sourceTopologyFingerprint({ battlefieldOnly = false } = {}) {
    const parts = [];
    for (const playerId of this.engine.state.playerOrder || Object.keys(this.engine.state.players)) {
      const player = this.engine.state.players[playerId];
      for (const source of player?.battlefield || []) {
        parts.push(`battlefield:${source.gameObjectId || source.instanceId || ''}:${source.cardId || ''}:${source.controller || ''}:${source.phasedOut ? 1 : 0}:${source.copyState?.timestamp || ''}:${source.faceState?.currentFaceIndex ?? ''}`);
      }
      if (!battlefieldOnly) {
        // Production zone changes increment topologyRevision. Length/top-card
        // sentinels additionally catch legacy/direct test setup without hashing
        // every card in 100-card libraries on every observed event.
        for (const zone of ['graveyard', 'exile', 'command', 'hand', 'library']) {
          const cards = player?.[zone] || [];
          const first = cards[0];
          const last = cards.at(-1);
          parts.push(`${zone}:${cards.length}:${first?.gameObjectId || first?.instanceId || ''}:${last?.gameObjectId || last?.instanceId || ''}`);
        }
      }
    }
    if (!battlefieldOnly) {
      for (const item of this.engine.state.stack || []) {
        const source = item?.card;
        if (!source) continue;
        parts.push(`stack:${source.gameObjectId || source.instanceId || ''}:${source.cardId || ''}:${item.controller || source.controller || ''}:${source.copyState?.timestamp || ''}:${source.faceState?.currentFaceIndex ?? ''}`);
      }
    }
    return parts.join('|');
  }

  snapshot() {
    return {
      enabled: this.enabled,
      profiling: this.profiler.enabled,
      stateRevision: this.stateRevision,
      topologyRevision: this.topologyRevision,
      lastMutationReason: this.lastMutationReason || null,
      cacheSizes: {
        derived: this.derivedCache.size,
        legalActions: this.legalActionCache.size,
        zones: this.zoneCache.size
      },
      stats: structuredClone(this.stats),
      profiler: this.profiler.snapshot()
    };
  }
}
