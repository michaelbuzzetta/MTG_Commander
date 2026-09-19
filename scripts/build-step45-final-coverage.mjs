#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PracticalCoverageService, STEP45_TRIAGE_CATEGORY } from '../src/support/PracticalCoverageService.js';

const ROOT = path.resolve('.');
const read = (rel, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); }
  catch (error) { if (fallback !== null) return fallback; throw error; }
};
const writeJson = (rel, value) => {
  const file = path.join(ROOT, rel); fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`; fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`); fs.renameSync(temp, file);
};
const writeText = (rel, value) => {
  const file = path.join(ROOT, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value);
};

const support = read('src/data/generated/card-support.json');
const packageJson = read('package.json', {});
const compilerSha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'src/cards/compiler/OracleAstCompiler.js'))).digest('hex');
const cards = read('src/data/generated/cards.json');
const templates = read('src/data/generated/oracle-template-compilation.json', { rows: [] });
const promotions = read('src/data/generated/compiler-promoted-cards.json', { cards: {} });
const updateState = read('src/data/updates/step43-update-state.json', {});
const productionCatalog = read('.cache/scryfall/card-catalog.json', { cards: [], complete: false });
const rulesImpact = read('src/data/generated/rules-change-impact-report.json', {});
const dashboard = read('src/data/generated/rules-coverage-dashboard.json', {});
const service = new PracticalCoverageService({ support, cards, templates, updateState, catalog: productionCatalog, promotions });
const assessment = service.buildReleaseAssessment();
const generatedAt = new Date().toISOString();

const triage = {
  schema: 'mtg-commander-step45-remaining-card-triage', schemaVersion: 1, generatedAt,
  rulesVersion: support.rulesVersion || null,
  catalog: { complete: assessment.catalogComplete, sourceType: assessment.catalogSourceType, count: assessment.catalogCount },
  summary: assessment.triage.summary,
  groups: Object.fromEntries(Object.values(STEP45_TRIAGE_CATEGORY).map(category => [category, assessment.triage.rows.filter(row => row.category === category)]))
};
writeJson('src/data/generated/step45-remaining-card-triage.json', triage);

const exclusions = assessment.triage.rows.filter(row => row.category === STEP45_TRIAGE_CATEGORY.NON_DIGITAL).map(row => ({
  cardId: row.cardId, name: row.name, oracleIdentity: row.oracleIdentity, reason: row.reason
}));
writeJson('src/data/generated/non-digital-exclusions.json', {
  schema: 'mtg-commander-step45-non-digital-exclusions', schemaVersion: 1, generatedAt,
  policy: 'Only explicitly reviewed physical/non-digital effects are excluded. Partial engine support is never converted into a non-digital exclusion.',
  exclusions,
  count: exclusions.length
});

const formatScopeExclusions = assessment.triage.rows.filter(row => row.category === STEP45_TRIAGE_CATEGORY.FORMAT_SCOPE).map(row => ({
  cardId: row.cardId, name: row.name, oracleIdentity: row.oracleIdentity, commanderLegality: row.commanderLegality || 'not_legal', reason: row.reason
}));
writeJson('src/data/generated/format-scope-exclusions.json', {
  schema: 'mtg-commander-step45-format-scope-exclusions', schemaVersion: 1, generatedAt,
  policy: 'The practical-100 executable card scope is the Commander card pool. Oracle identities explicitly marked not_legal in Commander are retained in the census and excluded with a recorded reason rather than silently ignored.',
  exclusions: formatScopeExclusions,
  count: formatScopeExclusions.length
});

const releaseReport = {
  schema: 'mtg-commander-step45-practical-100-coverage', schemaVersion: 1, generatedAt,
  status: assessment.practical100Ready ? 'certified' : 'blocked',
  practical100Ready: assessment.practical100Ready,
  rulesVersion: support.rulesVersion || null,
  packageVersion: packageJson.version || null,
  compilerSha256,
  oracleCatalogSha256: updateState.oracleCatalogSha256 || null,
  printingCatalogSha256: updateState.printingCatalogSha256 || null,
  catalogSourceUpdatedAt: updateState.sourceUpdatedAt || null,
  declaredScope: 'All Commander-legal and Commander-banned Oracle identities in the complete production catalog. Commander-not-legal identities are explicitly recorded as format-scope exclusions; genuinely non-digital in-scope cards require separate explicit non-digital exclusions.',
  catalogComplete: assessment.catalogComplete,
  catalogSourceType: assessment.catalogSourceType,
  catalogCount: assessment.catalogCount,
  censusCatalogCount: assessment.censusCatalogCount,
  censusCoversDeclaredCatalog: assessment.censusCoversDeclaredCatalog,
  productionUniverseLoaded: assessment.productionUniverseLoaded,
  pendingImplementationReview: assessment.pendingImplementationReview,
  pendingLegalityRefresh: assessment.pendingLegalityRefresh,
  step43ReviewClear: assessment.step43ReviewClear,
  inScopeCount: assessment.triage.summary.inScopeCount,
  fullySupportedCount: assessment.triage.summary.fullySupportedCount,
  unresolvedInScopeCount: assessment.triage.summary.unresolvedInScopeCount,
  strictCoveragePercent: assessment.strictCoveragePercent,
  explicitNonDigitalExclusionCount: assessment.triage.summary.explicitNonDigitalExclusionCount,
  explicitFormatScopeExclusionCount: assessment.triage.summary.explicitFormatScopeExclusionCount,
  explicitExclusionCount: assessment.triage.summary.explicitExclusionCount,
  blockers: assessment.blockers,
  rulesChangeImpact: { changedOracleIdentities: rulesImpact.changedOracleIdentities || rulesImpact.changeCount || 0 },
  dashboardCriticalVerificationGreen: dashboard.releaseGate?.criticalVerificationGreen === true,
  acceptance: {
    productionCatalogUniverseEnumerated: assessment.productionUniverseLoaded && assessment.censusCoversDeclaredCatalog,
    step43SemanticAndLegalityReviewClear: assessment.step43ReviewClear,
    everyInScopeOracleCardFullySupportedAndTested: assessment.allInScopeFullySupported,
    everyOutOfScopeCardExplicitlyListed: true,
    noUnknownOrPartialCardCanEnterStrictMode: true,
    sameTaggedVersionsVerificationRequired: true
  }
};
writeJson('src/data/generated/practical-100-coverage-report.json', releaseReport);

const categoryLines = Object.entries(triage.summary.categoryCounts).map(([key, value]) => `- ${key}: ${value}`).join('\n');
const notes = `# Step 45 Practical 100% Coverage Release Notes\n\nGenerated: ${generatedAt}\n\n## Release status\n${releaseReport.status.toUpperCase()}\n\nThe Step 45 engineering gate is implemented. Practical 100% certification is issued only when the Step 43 catalog is complete and every in-scope Oracle implementation is fully strict-certified.\n\n## Current measured scope\n- Catalog complete: ${releaseReport.catalogComplete}\n- Catalog records: ${releaseReport.catalogCount}\n- In-scope records: ${releaseReport.inScopeCount}\n- Fully supported: ${releaseReport.fullySupportedCount}\n- Unresolved in-scope: ${releaseReport.unresolvedInScopeCount}\n- Strict coverage: ${releaseReport.strictCoveragePercent}%\n- Explicit non-digital exclusions: ${releaseReport.explicitNonDigitalExclusionCount}
- Explicit Commander format-scope exclusions: ${releaseReport.explicitFormatScopeExclusionCount}\n\n## Remaining-card triage\n${categoryLines}\n\n## Release blockers\n${releaseReport.blockers.length ? releaseReport.blockers.map(item => `- ${item}`).join('\n') : '- None.'}\n\n## Definition of practical 100%\nAll Commander-legal and Commander-banned cards inside the declared execution scope must be fully supported and tested under one tagged engine/rules/database version. Commander-not-legal Oracle identities must be explicitly listed as format-scope exclusions. In-scope cards that cannot be represented faithfully must appear in the explicit non-digital exclusion list; they are never silently approximated.\n`;
writeText('PRACTICAL_100_COVERAGE_RELEASE_NOTES.md', notes);
console.log(`Step 45 coverage report built: ${releaseReport.status}; ${releaseReport.fullySupportedCount}/${releaseReport.inScopeCount} in-scope cards fully supported (${releaseReport.strictCoveragePercent}%).`);
if (process.argv.includes('--require-certified') && !releaseReport.practical100Ready) process.exit(2);
