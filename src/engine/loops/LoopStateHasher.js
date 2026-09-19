const NON_RULE_STATE_KEYS = new Set([
  'history',
  'turnHistory',
  'skippedTurnHistory',
  'knownInformation',
  'lastKnownInformation'
]);

const STRUCTURAL_ID_KEYS = new Set([
  'instanceId', 'gameObjectId', 'zoneChangeId', 'eventId', 'parentEventId',
  'stackObjectId', 'lkiId', 'requestId', 'id'
]);

function normalize(value, { structural = false, key = '' } = {}) {
  if (value == null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'NaN';
    if (!Number.isFinite(value)) return String(value);
    return value;
  }
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (Array.isArray(value)) return value.map(item => normalize(item, { structural, key })).filter(item => item !== undefined);
  if (value instanceof Set) return [...value].map(item => normalize(item, { structural, key })).sort(compareJson);
  if (value instanceof Map) return [...value.entries()].map(([k, v]) => [String(k), normalize(v, { structural, key: String(k) })]).sort((a, b) => a[0].localeCompare(b[0]));

  const out = {};
  for (const childKey of Object.keys(value).sort()) {
    if (NON_RULE_STATE_KEYS.has(childKey)) continue;
    if (structural && STRUCTURAL_ID_KEYS.has(childKey)) {
      if (childKey === 'id' && key === 'players') out[childKey] = value[childKey];
      else out[childKey] = '<id>';
      continue;
    }
    const child = normalize(value[childKey], { structural, key: childKey });
    if (child !== undefined) out[childKey] = child;
  }
  return out;
}

function compareJson(a, b) {
  return JSON.stringify(a).localeCompare(JSON.stringify(b));
}

export function stableStringify(value, options = {}) {
  return JSON.stringify(normalize(value, options));
}

export function fnv1aHash(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function fingerprintValue(value, options = {}) {
  return fnv1aHash(stableStringify(value, options));
}

function compactZoneCard(card, zone, structural = false) {
  if (!card || typeof card !== 'object') return card;
  const instanceId = structural ? '<id>' : (card.instanceId || null);
  const gameObjectId = structural ? '<id>' : (card.gameObjectId || null);
  const attachedTo = structural && card.attachedTo ? '<id>' : (card.attachedTo || null);
  const exiledBy = structural && card.exiledBy ? '<id>' : (card.exiledBy || null);
  const common = [instanceId, gameObjectId, structural ? 0 : Number(card.zoneChangeId || 0), card.cardId || null, card.owner || null, card.controller || null];
  if (zone === 'library') return [...common, !!card.faceDown];
  if (zone === 'hand') return [...common, !!card.foretold, !!card.faceDown, card.castMode || null];
  if (zone === 'graveyard') return [...common, !!card.faceDown, card.commanderIdentity || null];
  if (zone === 'exile') return [...common, !!card.foretold, !!card.faceDown, exiledBy, card.castMode || null, card.commanderIdentity || null];
  if (zone === 'command') return [...common, !!card.isCommander, card.commanderIdentity || null, card.commanderDesignationIndex ?? null];
  return [
    ...common,
    !!card.tapped,
    !!card.summoningSick,
    card.counters || {},
    Number(card.damageMarked || 0),
    Number(card.damagePrevention || 0),
    !!card.attacking,
    structural && card.attackTarget ? '<id>' : (card.attackTarget || null),
    structural && card.blocking ? '<id>' : (card.blocking || null),
    card.modifiers || {},
    card.createdTurn ?? null,
    card.controlledSinceTurn ?? null,
    card.chosenType || null,
    attachedTo,
    !!card.phasedOut,
    !!card.foretold,
    !!card.faceDown,
    exiledBy,
    card.castMode || null,
    !!card.isCommander,
    card.commanderIdentity || null,
    !!card.token,
    card.faceState?.currentFace ?? card.faceState?.faceIndex ?? null,
    !!card.faceState?.transformed
  ];
}

function compactPlayer(player, structural = false) {
  const zones = {};
  for (const zone of ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command']) zones[zone] = (player?.[zone] || []).map(card => compactZoneCard(card, zone, structural));
  return {
    life: Number(player?.life || 0),
    manaPool: player?.manaPool || {},
    restrictedMana: player?.restrictedMana || [],
    landPlaysRemaining: Number(player?.landPlaysRemaining || 0),
    additionalLandPlays: Number(player?.additionalLandPlays || 0),
    commanderTax: Number(player?.commanderTax || 0),
    commanderTaxLedger: player?.commanderTaxLedger || {},
    commanderDamage: player?.commanderDamage || {},
    counters: player?.counters || {},
    mulligans: Number(player?.mulligans || 0),
    maxHandSize: Number(player?.maxHandSize ?? 7),
    damagePrevention: Number(player?.damagePrevention || 0),
    lost: !!player?.lost,
    eliminatedAtTurn: player?.eliminatedAtTurn ?? null,
    zones
  };
}

function compactStackItem(item, structural = false) {
  if (!item || typeof item !== 'object') return item;
  return {
    id: structural ? '<id>' : (item.id || null),
    gameObjectId: structural ? '<id>' : (item.gameObjectId || null),
    objectKind: item.objectKind || null,
    type: item.type || null,
    controller: item.controller || null,
    card: item.card ? compactZoneCard(item.card, 'stack', structural) : null,
    source: item.source ? compactZoneCard(item.source, item.source.zone || 'battlefield', structural) : null,
    ability: item.ability || null,
    effect: item.effect || null,
    targets: structural ? (item.targets || []).map(() => '<id>') : (item.targets || []),
    selections: structural ? (item.selections || []).map(() => '<id>') : (item.selections || []),
    modes: item.modes || item.mode || null,
    xValue: item.xValue ?? null,
    divided: item.divided || null,
    isCopy: !!item.isCopy,
    copyMetadata: item.copyMetadata || null,
    lockedCost: item.lockedCost || null,
    additionalCosts: item.additionalCosts || []
  };
}

function compactReferenceObject(value, structural = false) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(item => compactReferenceObject(item, structural));
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'baseCharacteristics' || key === 'cardIdentity') continue;
    if (structural && /(?:^|_)(?:id|ids)$/i.test(key)) {
      out[key] = Array.isArray(child) ? child.map(() => '<id>') : (child == null ? child : '<id>');
      continue;
    }
    if (child && typeof child === 'object' && child.cardId && child.instanceId) out[key] = compactZoneCard(child, child.zone || 'battlefield', structural);
    else out[key] = compactReferenceObject(child, structural);
  }
  return out;
}

/**
 * Rules-relevant compact state used only for cycle detection. Static Oracle/card
 * definitions are represented by cardId instead of being re-hashed on every
 * action, keeping Step 19 observation cheap enough for long simulations.
 */
export function buildLoopStateSnapshot(state, { structural = false } = {}) {
  const players = {};
  for (const id of state?.playerOrder || Object.keys(state?.players || {})) players[id] = compactPlayer(state.players?.[id], structural);
  return {
    schemaVersion: state?.schemaVersion ?? null,
    turn: state?.turn ?? null,
    activePlayer: state?.activePlayer ?? null,
    priorityPlayer: state?.priorityPlayer ?? null,
    phase: state?.phase ?? null,
    phaseIndex: state?.phaseIndex ?? null,
    passes: state?.passes ?? null,
    winner: state?.winner ?? null,
    started: !!state?.started,
    gameBegun: !!state?.gameBegun,
    playerOrder: state?.playerOrder || [],
    players,
    stack: (state?.stack || []).map(item => compactStackItem(item, structural)),
    combat: compactReferenceObject(state?.combat || {}, structural),
    pendingTriggers: compactReferenceObject(state?.pendingTriggers || [], structural),
    triggerRegistrations: compactReferenceObject(state?.triggerRegistrations || [], structural),
    continuousEffects: compactReferenceObject(state?.continuousEffects || [], structural),
    preventionEffects: compactReferenceObject(state?.preventionEffects || [], structural),
    pendingChoice: compactReferenceObject(state?.pendingChoice || null, structural),
    pendingResolution: compactReferenceObject(state?.pendingResolution || null, structural),
    turnActionPending: state?.turnActionPending || null,
    cleanupPriority: !!state?.cleanupPriority,
    cardsDrawnThisTurn: state?.cardsDrawnThisTurn || {},
    extraTurns: state?.extraTurns || {},
    extraTurnQueue: state?.extraTurnQueue || [],
    turnKind: state?.turnKind || null,
    normalTurnPlayer: state?.normalTurnPlayer || null,
    turnSequence: state?.turnSequence || [],
    turnStepId: state?.turnStepId || null,
    turnPhaseGroup: state?.turnPhaseGroup || null,
    cleanupIteration: state?.cleanupIteration || 0,
    turnModifiers: state?.turnModifiers || {},
    castingPermissions: compactReferenceObject(state?.castingPermissions || [], structural),
    turnMemory: compactReferenceObject(state?.turnMemory || {}, structural),
    pregame: state?.pregame || null
  };
}

export function hashAuthoritativeState(state) {
  return fingerprintValue(buildLoopStateSnapshot(state, { structural: false }), { structural: false });
}

export function hashStructuralState(state) {
  return fingerprintValue(buildLoopStateSnapshot(state, { structural: true }), { structural: false });
}

export function fingerprintAction(action) {
  return fingerprintValue(action || null, { structural: false });
}

export function fingerprintEvent(type, payload = {}) {
  return fingerprintValue({ type, payload }, { structural: true });
}

function sumCounterMap(map = {}) {
  return Object.values(map || {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
}

export function resourceVector(state) {
  const out = {};
  for (const playerId of state?.playerOrder || Object.keys(state?.players || {})) {
    const p = state.players?.[playerId];
    if (!p) continue;
    out[`${playerId}.life`] = Number(p.life || 0);
    for (const [color, amount] of Object.entries(p.manaPool || {})) out[`${playerId}.mana.${color}`] = Number(amount || 0);
    for (const zone of ['hand', 'library', 'battlefield', 'graveyard', 'exile', 'command']) out[`${playerId}.zone.${zone}`] = p[zone]?.length || 0;
    for (const [counter, amount] of Object.entries(p.counters || {})) out[`${playerId}.counter.${counter}`] = Number(amount || 0);
    out[`${playerId}.permanentCounters`] = (p.battlefield || []).reduce((sum, card) => sum + sumCounterMap(card.counters), 0);
  }
  return out;
}

export function resourceDelta(before = {}, after = {}) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return Object.fromEntries([...keys].sort().map(key => [key, Number(after[key] || 0) - Number(before[key] || 0)]).filter(([, value]) => value !== 0));
}

export function hasProductiveProgress(delta = {}) {
  return Object.entries(delta).some(([key, value]) => value > 0 && (
    key.includes('.mana.') || key.endsWith('.zone.hand') || key.endsWith('.zone.battlefield') ||
    key.endsWith('.permanentCounters') || key.includes('.counter.') || key.endsWith('.life')
  ));
}
