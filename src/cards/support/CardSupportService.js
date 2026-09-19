import generatedSupport from '../../data/generated/card-support.json' with { type: 'json' };
import generatedCoverage from '../../data/generated/coverage-report.json' with { type: 'json' };
import { OracleImplementationRegistry } from './OracleImplementationRegistry.js';
import { IMPLEMENTATION_PATH, STEP17_RULES_VERSION, SUPPORT_STATUS, baseOracleIdentity } from './OracleIdentity.js';

function mapRecords(payload) {
  const rows = Array.isArray(payload?.cards) ? payload.cards : [];
  return Object.fromEntries(rows.map(row => [row.cardId, row]));
}

function runtimeFallback(card = {}) {
  const identity = baseOracleIdentity(card);
  const hasExecutable = !!(card.script || card.cardScript || (card.abilities || []).length || (card.spellEffects || []).length || (card.keywords || []).length);
  return {
    cardId: card.id,
    name: card.name || card.id,
    oracleId: identity.oracleId,
    oracleIdentity: identity.key,
    identitySource: identity.source,
    implementationPath: card.script || card.cardScript ? IMPLEMENTATION_PATH.DECLARATIVE : (hasExecutable ? IMPLEMENTATION_PATH.DECLARATIVE : IMPLEMENTATION_PATH.AUTO_TEMPLATE),
    supportStatus: card.supported === false ? SUPPORT_STATUS.UNSUPPORTED : SUPPORT_STATUS.PARTIAL,
    strictEligible: false,
    caveats: card.supported === false ? [card.unsupportedReason || 'Runtime definition is explicitly unsupported.'] : ['Runtime card has not been certified by the Step 17 support database.'],
    testCount: 0,
    testFiles: [],
    requiredCustomHooks: [],
    lastValidatedRulesVersion: STEP17_RULES_VERSION
  };
}

export class CardSupportService {
  constructor(db = {}, { supportPayload = generatedSupport, coveragePayload = generatedCoverage } = {}) {
    this.records = mapRecords(supportPayload);
    this.coveragePayload = coveragePayload || {};
    this.sourceDb = structuredClone(db || {});
    this.registry = new OracleImplementationRegistry(this.sourceDb, { supportRecords: this.records });
  }

  prepareDatabase(db = {}) {
    const prepared = this.registry.applyToDatabase(db);
    for (const [id, card] of Object.entries(prepared)) {
      const record = this.records[id] || runtimeFallback(card);
      card.supportStatus = record.supportStatus;
      card.supportMetadata = {
        oracleIdentity: record.oracleIdentity,
        identitySource: record.identitySource,
        implementationPath: record.implementationPath,
        strictEligible: !!record.strictEligible,
        testCount: Number(record.testCount || 0),
        caveats: [...(record.caveats || [])],
        requiredCustomHooks: [...(record.requiredCustomHooks || [])],
        lastValidatedRulesVersion: record.lastValidatedRulesVersion || STEP17_RULES_VERSION
      };
      if (!card.oracleId && record.oracleId) card.oracleId = record.oracleId;
    }
    return prepared;
  }

  getCardStatus(cardId, db = null) {
    if (this.records[cardId]) return structuredClone(this.records[cardId]);
    const card = db?.[cardId];
    return card ? runtimeFallback(card) : null;
  }

  registerRuntimeCard(card) {
    if (!card?.id) throw new Error('Runtime support registration requires a card id.');
    if (!this.records[card.id]) this.records[card.id] = runtimeFallback(card);
    this.sourceDb[card.id] = structuredClone(card);
    this.registry = new OracleImplementationRegistry(this.sourceDb, { supportRecords: this.records });
    return this.getCardStatus(card.id, { [card.id]: card });
  }

  prepareCard(card) {
    if (!card?.id) throw new Error('Preparing a runtime card requires a card id.');
    const prepared = this.registry.applyToDatabase({ [card.id]: card })[card.id] || structuredClone(card);
    const record = this.records[card.id] || runtimeFallback(prepared);
    prepared.supportStatus = record.supportStatus;
    prepared.supportMetadata = {
      oracleIdentity: record.oracleIdentity,
      identitySource: record.identitySource,
      implementationPath: record.implementationPath,
      strictEligible: !!record.strictEligible,
      testCount: Number(record.testCount || 0),
      caveats: [...(record.caveats || [])],
      requiredCustomHooks: [...(record.requiredCustomHooks || [])],
      lastValidatedRulesVersion: record.lastValidatedRulesVersion || STEP17_RULES_VERSION
    };
    if (!prepared.oracleId && record.oracleId) prepared.oracleId = record.oracleId;
    return prepared;
  }

  getOracleImplementation(cardId) {
    const row = this.registry.resolveImplementation(cardId);
    return row ? structuredClone(row) : null;
  }

  deckReadiness(deck, db = {}) {
    const entries = deck?.cards || [];
    const blockers = [];
    const counts = { fully_supported: 0, partially_supported: 0, unsupported: 0, missing: 0 };
    for (const entry of entries) {
      const card = db[entry.id];
      const status = this.getCardStatus(entry.id, db);
      if (!card || !status) {
        counts.missing += Number(entry.quantity || 1);
        blockers.push({ cardId: entry.id, name: card?.name || entry.id, reason: 'No Step 17 support record exists.' });
        continue;
      }
      counts[status.supportStatus] = (counts[status.supportStatus] || 0) + Number(entry.quantity || 1);
      if (!status.strictEligible) blockers.push({ cardId: entry.id, name: card.name, status: status.supportStatus, caveats: [...(status.caveats || [])] });
    }
    return {
      deckId: deck?.id || null,
      name: deck?.name || null,
      cardCount: entries.reduce((sum, entry) => sum + Number(entry.quantity || 1), 0),
      statusCounts: counts,
      strictReady: blockers.length === 0,
      silentUnsupportedCount: 0,
      blockers
    };
  }

  coverage() { return structuredClone(this.coveragePayload); }
}
