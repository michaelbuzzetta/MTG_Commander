const QUALITY_KEYS = new Set([
  'cardId','cardIds','cardName','type','types','subtype','subtypes','color','colors',
  'manaValue','minManaValue','maxManaValue','land','nonland','basic','nonbasic','legendary',
  'and','or','not'
]);

export function filterHasStatedQuality(filter = {}) {
  return Object.keys(filter || {}).some(key => QUALITY_KEYS.has(key));
}

function int(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : fallback;
}

export function normalizeSearchRequest(request = {}) {
  if (!request || typeof request !== 'object') throw new Error('SearchRequest must be an object');
  const searchingPlayerId = request.searchingPlayerId || request.playerId;
  if (!searchingPlayerId) throw new Error('SearchRequest requires searchingPlayerId');
  const libraryOwnerId = request.libraryOwnerId || request.libraryPlayerId || searchingPlayerId;
  const minCount = int(request.minCount ?? request.min ?? (request.optional ? 0 : 1), 0);
  const maxCount = Math.max(minCount, int(request.maxCount ?? request.max ?? request.amount ?? 1, 1));
  const filter = structuredClone(request.filter || {});
  const statedQuality = filterHasStatedQuality(filter);
  const allowFailToFind = request.allowFailToFind == null ? statedQuality : !!request.allowFailToFind;
  const destination = request.destination || request.toZone || 'hand';
  const destinationPlan = Array.isArray(request.destinationPlan)
    ? request.destinationPlan.map(item => typeof item === 'string' ? { zone: item } : structuredClone(item || {}))
    : null;
  return Object.freeze({
    id: request.id || null,
    searchingPlayerId,
    libraryOwnerId,
    chooserPlayerId: request.chooserPlayerId || searchingPlayerId,
    minCount,
    maxCount,
    filter,
    statedQuality,
    allowFailToFind,
    revealFound: !!request.revealFound,
    destination,
    destinationPlayerId: request.destinationPlayerId || searchingPlayerId,
    destinationPlan,
    moveFound: request.moveFound !== false,
    shuffleAfter: request.shuffleAfter !== false,
    scopeTop: request.scopeTop == null ? null : Math.max(0, int(request.scopeTop)),
    tapped: !!request.tapped,
    reason: request.reason || 'library-search',
    optional: !!request.optional,
    metadata: structuredClone(request.metadata || {}),
    returnFoundCards: request.returnFoundCards !== false
  });
}
