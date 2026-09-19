import crypto from 'node:crypto';

export const STEP43_CHANGE_TYPES = Object.freeze({
  NEW_PRINTING: 'new_printing_only',
  NEW_ORACLE: 'new_oracle_card',
  ORACLE_TEXT: 'oracle_text_change',
  LEGALITY: 'legality_change',
  RULING_METADATA: 'ruling_metadata_change',
  MECHANIC_INDICATOR: 'new_keyword_mechanic_indicator'
});

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}

export function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value ?? null))).digest('hex');
}

export function oracleIdentity(card = {}) {
  return card.oracleId || card.oracle_id || card.oracleIdentity || card.id || card.name || null;
}

function printingIdentity(card = {}) {
  return card.scryfallId || card.scryfall_id || card.printingId || card.id || [card.set, card.collectorNumber].filter(Boolean).join(':') || null;
}

function oracleText(card = {}) {
  return String(card.oracleText ?? card.oracle_text ?? '').trim();
}

function mechanics(card = {}) {
  return [...new Set([...(card.keywords || []), ...(card.mechanics || []), ...(card.mechanicTags || [])].filter(Boolean).map(String))].sort();
}

function legalities(card = {}) { return stable(card.legalities || {}); }
function rulingMetadata(card = {}) { return stable(card.rulingMetadata || card.rulings || {}); }

function groupByOracle(cards = []) {
  const groups = new Map();
  for (const card of cards) {
    const id = oracleIdentity(card);
    if (!id) continue;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(card);
  }
  return groups;
}

function representative(group = []) {
  return [...group].sort((a, b) => String(printingIdentity(a)).localeCompare(String(printingIdentity(b)) ))[0] || {};
}

export function classifyCatalogChanges(previousCards = [], nextCards = []) {
  const before = groupByOracle(previousCards);
  const after = groupByOracle(nextCards);
  const changes = [];

  for (const [oid, nextGroup] of after.entries()) {
    const prevGroup = before.get(oid);
    const next = representative(nextGroup);
    if (!prevGroup) {
      changes.push({ type: STEP43_CHANGE_TYPES.NEW_ORACLE, oracleId: oid, name: next.name || '', printingIds: nextGroup.map(printingIdentity).filter(Boolean).sort() });
      continue;
    }
    const prev = representative(prevGroup);
    const prevPrints = new Set(prevGroup.map(printingIdentity).filter(Boolean));
    const newPrints = nextGroup.map(printingIdentity).filter(Boolean).filter(id => !prevPrints.has(id)).sort();
    if (newPrints.length && stableHash({ text: oracleText(prev), legality: legalities(prev), rulings: rulingMetadata(prev), mechanics: mechanics(prev) }) === stableHash({ text: oracleText(next), legality: legalities(next), rulings: rulingMetadata(next), mechanics: mechanics(next) })) {
      changes.push({ type: STEP43_CHANGE_TYPES.NEW_PRINTING, oracleId: oid, name: next.name || prev.name || '', printingIds: newPrints });
    }
    if (oracleText(prev) !== oracleText(next)) {
      changes.push({ type: STEP43_CHANGE_TYPES.ORACLE_TEXT, oracleId: oid, name: next.name || prev.name || '', beforeFingerprint: stableHash(oracleText(prev)), afterFingerprint: stableHash(oracleText(next)) });
    }
    if (stableHash(legalities(prev)) !== stableHash(legalities(next))) {
      changes.push({ type: STEP43_CHANGE_TYPES.LEGALITY, oracleId: oid, name: next.name || prev.name || '' });
    }
    if (stableHash(rulingMetadata(prev)) !== stableHash(rulingMetadata(next))) {
      changes.push({ type: STEP43_CHANGE_TYPES.RULING_METADATA, oracleId: oid, name: next.name || prev.name || '' });
    }
    const oldMechanics = new Set(mechanics(prev));
    const addedMechanics = mechanics(next).filter(item => !oldMechanics.has(item));
    if (addedMechanics.length) {
      changes.push({ type: STEP43_CHANGE_TYPES.MECHANIC_INDICATOR, oracleId: oid, name: next.name || prev.name || '', addedMechanics });
    }
  }

  return changes.sort((a, b) => a.oracleId.localeCompare(b.oracleId) || a.type.localeCompare(b.type));
}

export function buildUpdatePlan(previousCatalog = {}, nextCatalog = {}, options = {}) {
  const previousCards = previousCatalog.cards || [];
  const nextCards = nextCatalog.cards || [];
  const changes = classifyCatalogChanges(previousCards, nextCards);
  const semanticTypes = new Set([
    STEP43_CHANGE_TYPES.NEW_ORACLE,
    STEP43_CHANGE_TYPES.ORACLE_TEXT,
    STEP43_CHANGE_TYPES.MECHANIC_INDICATOR,
    STEP43_CHANGE_TYPES.RULING_METADATA
  ]);
  const affectedOracleIds = [...new Set(changes.filter(change => semanticTypes.has(change.type)).map(change => change.oracleId))].sort();
  const legalityOracleIds = [...new Set(changes.filter(change => change.type === STEP43_CHANGE_TYPES.LEGALITY).map(change => change.oracleId))].sort();
  const printingOnlyOracleIds = [...new Set(changes.filter(change => change.type === STEP43_CHANGE_TYPES.NEW_PRINTING).map(change => change.oracleId))].sort();
  return {
    schemaVersion: 1,
    createdAt: options.createdAt || new Date().toISOString(),
    previousVersion: previousCatalog.sourceUpdatedAt || previousCatalog.databaseVersion || null,
    candidateVersion: nextCatalog.sourceUpdatedAt || nextCatalog.databaseVersion || null,
    previousCount: previousCards.length,
    candidateCount: nextCards.length,
    changeCount: changes.length,
    changes,
    affectedOracleIds,
    legalityOracleIds,
    printingOnlyOracleIds,
    requiresImplementationReview: affectedOracleIds.length > 0,
    requiresLegalityRefresh: legalityOracleIds.length > 0,
    canReuseExistingImplementationsForPrintingOnly: true
  };
}

export function buildAffectedTestPlan(updatePlan, supportRows = []) {
  const affected = new Set([...(updatePlan.affectedOracleIds || []), ...(updatePlan.legalityOracleIds || [])]);
  const rows = supportRows.filter(row => affected.has(row.oracleId));
  const testFiles = [...new Set(rows.flatMap(row => row.testFiles || []))].sort();
  const cardIds = [...new Set(rows.map(row => row.cardId))].sort();
  return {
    schemaVersion: 1,
    affectedOracleIds: [...affected].sort(),
    affectedCardIds: cardIds,
    testFiles,
    includeCompilerValidation: (updatePlan.affectedOracleIds || []).length > 0,
    includeSupportValidation: affected.size > 0,
    includeGoldenValidation: rows.some(row => Number(row.goldenTestCount || 0) > 0),
    noRuntimeImplementationWorkForPrintingOnly: (updatePlan.affectedOracleIds || []).length === 0 && (updatePlan.printingOnlyOracleIds || []).length > 0
  };
}
