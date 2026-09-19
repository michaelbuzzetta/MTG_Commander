import { classifyCatalogCardScope } from './CardScopePolicy.js';
const clone = value => structuredClone(value);

function normalizeName(value = '') {
  return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[’‘]/g, "'").replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
}

function catalogIdentity(card = {}) {
  const oracleId = card.oracleId || card.oracle_id || null;
  if (oracleId) return `oracle:${oracleId}`;
  if (card.id) return `catalog:${card.id}`;
  return `catalog-name:${normalizeName(card.name)}`;
}

export const STEP45_TRIAGE_CATEGORY = Object.freeze({
  FULL: 'fully-supported',
  NON_DIGITAL: 'non-digital-exclusion',
  FORMAT_SCOPE: 'format-scope-exclusion',
  ENGINE_CAPABILITY: 'missing-engine-capability',
  CUSTOM_HOOK: 'custom-hook-review',
  SCRIPT: 'missing-script-or-template',
  CERTIFICATION: 'missing-test-or-certification'
});

function walkUnsupported(value, path = [], out = []) {
  if (!value || typeof value !== 'object') return out;
  if (value.supported === false) {
    out.push({
      path: path.join('.') || '$',
      name: value.name || null,
      reason: value.unsupportedReason || 'Explicitly unsupported behavior.'
    });
  }
  for (const [key, child] of Object.entries(value)) {
    if (child && typeof child === 'object') walkUnsupported(child, [...path, key], out);
  }
  return out;
}

function includesCaveat(row, pattern) {
  return (row?.caveats || []).some(text => pattern.test(String(text)));
}

export function collectExplicitUnsupportedNodes(card = {}) {
  return walkUnsupported(card, []);
}

export function classifyRemainingCard(row = {}, card = {}, template = null) {
  if (row.supportStatus === 'fully_supported' && row.strictEligible) {
    return { category: STEP45_TRIAGE_CATEGORY.FULL, reason: 'Strict-mode support certification is current.' };
  }

  const explicitUnsupported = collectExplicitUnsupportedNodes(card);
  if (row.implementationPath === 'non-digital-unsupported' || card.nonDigital === true || card.digitalScope === 'excluded') {
    return {
      category: STEP45_TRIAGE_CATEGORY.NON_DIGITAL,
      reason: card.unsupportedReason || row.caveats?.[0] || 'Explicitly classified outside the declared digital scope.',
      explicitUnsupported
    };
  }

  if (explicitUnsupported.length) {
    return {
      category: STEP45_TRIAGE_CATEGORY.ENGINE_CAPABILITY,
      reason: explicitUnsupported.map(item => item.reason).join(' | '),
      explicitUnsupported
    };
  }

  if ((row.requiredCustomHooks || []).length || row.implementationPath === 'custom-hook-required') {
    return {
      category: STEP45_TRIAGE_CATEGORY.CUSTOM_HOOK,
      reason: 'One or more exceptional behaviors require a versioned, tested custom hook.',
      explicitUnsupported
    };
  }

  if (includesCaveat(row, /No complete machine-readable behavior/i)
      || (row.implementationPath === 'auto-template-candidate' && ['ambiguous', 'unrecognized', 'review_required'].includes(template?.status))) {
    return {
      category: STEP45_TRIAGE_CATEGORY.SCRIPT,
      reason: 'Machine-readable behavior is incomplete and requires a reusable primitive, template, or declarative script.',
      explicitUnsupported
    };
  }

  return {
    category: STEP45_TRIAGE_CATEGORY.CERTIFICATION,
    reason: 'Rules behavior is present or partially present, but strict support still lacks required certification and/or behavioral coverage.',
    explicitUnsupported
  };
}

export class PracticalCoverageService {
  constructor({ support, cards, templates = { rows: [] }, updateState = {}, catalog = null, promotions = { cards: {} } } = {}) {
    this.support = support || { cards: [] };
    this.cards = cards || {};
    this.templates = templates || { rows: [] };
    this.updateState = updateState || {};
    this.catalog = catalog && Array.isArray(catalog.cards) ? catalog : null;
    this.templateByCard = new Map((this.templates.rows || []).map(row => [row.cardId, row]));
    this.promotions = promotions || { cards: {} };
    this.promotionByCard = new Map(Object.entries(this.promotions.cards || {}));
  }

  buildTriage() {
    const supportRows = this.support.cards || [];
    const supportByOracleId = new Map();
    const supportByIdentity = new Map();
    const supportByName = new Map();
    for (const row of supportRows) {
      if (row.oracleId && !supportByOracleId.has(row.oracleId)) supportByOracleId.set(row.oracleId, row);
      if (row.oracleIdentity && !supportByIdentity.has(row.oracleIdentity)) supportByIdentity.set(row.oracleIdentity, row);
      const key = normalizeName(row.name);
      if (key && !supportByName.has(key)) supportByName.set(key, row);
    }

    const sourceByOracleId = new Map();
    const sourceByName = new Map();
    for (const card of Object.values(this.cards || {})) {
      if (card?.oracleId && !sourceByOracleId.has(card.oracleId)) sourceByOracleId.set(card.oracleId, card);
      const key = normalizeName(card?.name);
      if (key && !sourceByName.has(key)) sourceByName.set(key, card);
    }

    const catalogCards = this.catalog?.cards || [];
    const usingCatalogUniverse = this.catalog?.complete === true && catalogCards.length > 0;
    const matchedSupportIds = new Set();
    const rows = [];

    const materializeSupportedRow = (row, catalogCard = null) => {
      matchedSupportIds.add(row.cardId);
      const card = this.cards[row.cardId]
        || (row.oracleId ? sourceByOracleId.get(row.oracleId) : null)
        || sourceByName.get(normalizeName(row.name))
        || {};
      const classification = classifyRemainingCard(row, card, this.templateByCard.get(row.cardId) || null);
      return {
        cardId: row.cardId,
        catalogCardId: catalogCard?.id || null,
        name: catalogCard?.name || row.name,
        oracleId: catalogCard?.oracleId || row.oracleId || null,
        oracleIdentity: catalogCard ? catalogIdentity(catalogCard) : row.oracleIdentity,
        supportStatus: row.supportStatus,
        strictEligible: !!row.strictEligible,
        implementationPath: row.implementationPath,
        category: classification.category,
        reason: classification.reason,
        caveats: clone(row.caveats || []),
        requiredCustomHooks: clone(row.requiredCustomHooks || []),
        explicitUnsupported: clone(classification.explicitUnsupported || []),
        catalogMatched: !!catalogCard
      };
    };

    if (usingCatalogUniverse) {
      for (const catalogCard of catalogCards) {
        const oid = catalogCard.oracleId || catalogCard.oracle_id || null;
        const identity = catalogIdentity(catalogCard);
        const scope = classifyCatalogCardScope(catalogCard);
        if (!scope.inScope) {
          rows.push({
            cardId: catalogCard.id || identity,
            catalogCardId: catalogCard.id || null,
            name: catalogCard.name || identity,
            oracleId: oid,
            oracleIdentity: identity,
            supportStatus: 'excluded',
            strictEligible: false,
            implementationPath: 'format-scope-excluded',
            category: STEP45_TRIAGE_CATEGORY.FORMAT_SCOPE,
            reason: scope.reason,
            commanderLegality: scope.commanderLegality,
            caveats: [],
            requiredCustomHooks: [],
            explicitUnsupported: [],
            catalogMatched: true
          });
          continue;
        }
        const row = (oid && supportByOracleId.get(oid))
          || supportByIdentity.get(identity)
          || supportByName.get(normalizeName(catalogCard.name));
        if (row) {
          rows.push(materializeSupportedRow(row, catalogCard));
          continue;
        }
        const promotion = this.promotionByCard.get(catalogCard.id);
        if (promotion) {
          rows.push({
            cardId: catalogCard.id || identity,
            catalogCardId: catalogCard.id || null,
            name: catalogCard.name || identity,
            oracleId: oid,
            oracleIdentity: identity,
            supportStatus: 'partially_supported',
            strictEligible: false,
            implementationPath: 'compiler-promoted-runtime',
            category: STEP45_TRIAGE_CATEGORY.CERTIFICATION,
            reason: 'Exact high-confidence compiler behavior is runtime-authoritative but remains strict-ineligible pending card-specific behavioral and golden certification.',
            caveats: ['Compiler-promoted runtime behavior is uncertified.'],
            requiredCustomHooks: [], explicitUnsupported: [], catalogMatched: true
          });
          continue;
        }
        rows.push({
          cardId: catalogCard.id || identity,
          catalogCardId: catalogCard.id || null,
          name: catalogCard.name || identity,
          oracleId: oid,
          oracleIdentity: identity,
          supportStatus: 'partial',
          strictEligible: false,
          implementationPath: 'auto-template-candidate',
          category: STEP45_TRIAGE_CATEGORY.SCRIPT,
          reason: 'This production-catalog Oracle identity has no machine-readable implementation registered in the authoritative card-support inventory.',
          caveats: ['No implementation/support record is registered for this production-catalog Oracle identity.'],
          requiredCustomHooks: [],
          explicitUnsupported: [],
          catalogMatched: true
        });
      }
    } else {
      for (const row of supportRows) rows.push(materializeSupportedRow(row));
    }

    const orphanImplementations = usingCatalogUniverse
      ? supportRows.filter(row => !matchedSupportIds.has(row.cardId)).map(row => ({ cardId: row.cardId, name: row.name, oracleId: row.oracleId || null, oracleIdentity: row.oracleIdentity || null }))
      : [];

    const categoryCounts = {};
    for (const row of rows) categoryCounts[row.category] = (categoryCounts[row.category] || 0) + 1;
    const fullySupported = rows.filter(row => row.category === STEP45_TRIAGE_CATEGORY.FULL);
    const nonDigitalExcluded = rows.filter(row => row.category === STEP45_TRIAGE_CATEGORY.NON_DIGITAL);
    const formatExcluded = rows.filter(row => row.category === STEP45_TRIAGE_CATEGORY.FORMAT_SCOPE);
    const excluded = [...nonDigitalExcluded, ...formatExcluded];
    const unresolved = rows.filter(row => ![STEP45_TRIAGE_CATEGORY.FULL, STEP45_TRIAGE_CATEGORY.NON_DIGITAL, STEP45_TRIAGE_CATEGORY.FORMAT_SCOPE].includes(row.category));
    const inScope = rows.length - excluded.length;

    return {
      rows,
      summary: {
        catalogCount: usingCatalogUniverse ? catalogCards.length : rows.length,
        inScopeCount: inScope,
        fullySupportedCount: fullySupported.length,
        explicitNonDigitalExclusionCount: nonDigitalExcluded.length,
        explicitFormatScopeExclusionCount: formatExcluded.length,
        explicitExclusionCount: excluded.length,
        unresolvedInScopeCount: unresolved.length,
        categoryCounts,
        strictCoveragePercent: inScope ? Number(((fullySupported.length / inScope) * 100).toFixed(2)) : 0,
        usingProductionCatalogUniverse: usingCatalogUniverse,
        orphanImplementationCount: orphanImplementations.length,
        orphanImplementations
      }
    };
  }

  buildReleaseAssessment() {
    const triage = this.buildTriage();
    const catalogComplete = this.updateState.catalogComplete === true;
    const declaredCatalogCount = Number(this.updateState.catalogCount ?? triage.summary.catalogCount);
    const censusCoversDeclaredCatalog = triage.summary.catalogCount === declaredCatalogCount;
    const productionUniverseLoaded = triage.summary.usingProductionCatalogUniverse;
    const pendingImplementationReview = Number(this.updateState.pendingImplementationReview || 0);
    const pendingLegalityRefresh = Number(this.updateState.pendingLegalityRefresh || 0);
    const step43ReviewClear = pendingImplementationReview === 0 && pendingLegalityRefresh === 0;
    const allInScopeFullySupported = triage.summary.unresolvedInScopeCount === 0;
    const practical100Ready = catalogComplete && productionUniverseLoaded && censusCoversDeclaredCatalog && step43ReviewClear && allInScopeFullySupported;
    const blockers = [];
    if (!catalogComplete) blockers.push('The Step 43 card-catalog snapshot is incomplete; practical-100% cannot be certified against a partial catalog.');
    if (catalogComplete && !productionUniverseLoaded) blockers.push('A complete Step 43 catalog is declared, but the practical-100 census is not enumerating that production catalog universe.');
    if (!censusCoversDeclaredCatalog) blockers.push(`The practical-100 census covers ${triage.summary.catalogCount} catalog identities but Step 43 declares ${declaredCatalogCount}; release is fail-closed until they match.`);
    if (pendingImplementationReview > 0) blockers.push(`${pendingImplementationReview} Oracle identities remain in the Step 43 semantic implementation-review queue.`);
    if (pendingLegalityRefresh > 0) blockers.push(`${pendingLegalityRefresh} Oracle identities have pending legality refresh/review.`);
    if (!allInScopeFullySupported) blockers.push(`${triage.summary.unresolvedInScopeCount} in-scope card definitions are not yet fully strict-certified.`);
    return {
      practical100Ready,
      catalogComplete,
      catalogSourceType: this.updateState.sourceType || null,
      catalogCount: declaredCatalogCount,
      censusCatalogCount: triage.summary.catalogCount,
      censusCoversDeclaredCatalog,
      productionUniverseLoaded,
      pendingImplementationReview,
      pendingLegalityRefresh,
      step43ReviewClear,
      allInScopeFullySupported,
      strictCoveragePercent: triage.summary.strictCoveragePercent,
      blockers,
      triage
    };
  }

  assertPractical100() {
    const assessment = this.buildReleaseAssessment();
    if (!assessment.practical100Ready) {
      const error = new Error(`Practical 100% coverage gate is not satisfied: ${assessment.blockers.join(' ')}`);
      error.code = 'PRACTICAL_100_NOT_READY';
      error.assessment = assessment;
      throw error;
    }
    return assessment;
  }
}
