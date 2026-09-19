#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVERGREEN_MECHANICS, COMMANDER_MECHANICS, CASTING_MECHANICS, SPECIALTY_MECHANICS } from '../src/mechanics/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src/data/generated/rules-coverage-dashboard.json');
const CHECK_ONLY = process.argv.includes('--check');

function readJson(rel, fallback = null) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); }
  catch (error) { if (fallback !== null) return fallback; throw new Error(`Unable to read ${rel}: ${error.message}`); }
}
function exists(rel) { return fs.existsSync(path.join(ROOT, rel)); }
function listFiles(rel) {
  const dir = path.join(ROOT, rel);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(name => !name.startsWith('.')).sort();
}
function writeAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}
function pct(n, d) { return d ? Number(((n / d) * 100).toFixed(2)) : 0; }
function normalized(value = '') { return String(value).trim().toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' '); }

const support = readJson('src/data/generated/card-support.json');
const coverage = readJson('src/data/generated/coverage-report.json');
const readiness = readJson('src/data/generated/deck-readiness.json');
const cards = readJson('src/data/source/cards.json');
const census = readJson('src/data/generated/oracle-support-census.json', { cards: [], catalog: {} });
const productionCatalog = readJson('.cache/scryfall/card-catalog.json', { cards: [], complete: false });
const catalogById = new Map((productionCatalog.cards || []).map(card => [card.id, card]));
const catalogByOracleId = new Map((productionCatalog.cards || []).filter(card => card.oracleId).map(card => [card.oracleId, card]));
const templateCompilation = readJson('src/data/generated/oracle-template-compilation.json', { rows: [] });
const templateByCard = new Map((templateCompilation.rows || []).map(row => [row.cardId, row]));
const supportByCard = new Map((support.cards || []).map(row => [row.cardId, row]));
const allMechanics = [...EVERGREEN_MECHANICS, ...COMMANDER_MECHANICS, ...CASTING_MECHANICS, ...SPECIALTY_MECHANICS];

function recognizeMechanics(card = {}) {
  const explicit = [...(card.mechanics || []), ...(card.mechanicTags || [])].map(normalized);
  const keywords = (card.keywords || []).map(normalized);
  const text = normalized(card.oracleText || card.rulesText || '');
  return allMechanics.filter(def => {
    const names = new Set([normalized(def.id), normalized(def.name), ...(def.aliases || []).map(normalized)]);
    if (explicit.some(item => names.has(item)) || keywords.some(item => names.has(item))) return true;
    if ((def.keywordPatterns || []).some(pattern => pattern instanceof RegExp ? keywords.some(keyword => { pattern.lastIndex = 0; return pattern.test(keyword); }) : keywords.includes(normalized(pattern)))) return true;
    return (def.oraclePatterns || []).some(pattern => pattern instanceof RegExp ? (() => { pattern.lastIndex = 0; return pattern.test(text); })() : text.includes(normalized(pattern)));
  }).map(def => def.id);
}

function dashboardStatus(row) {
  if (row.supportStatus === 'fully_supported') return 'fully_supported';
  if (row.supportStatus === 'unsupported') return 'unsupported';
  if (!row.certification && Number(row.testCount || 0) === 0 && Number(row.goldenTestCount || 0) === 0) return 'unreviewed';
  return 'partially_supported';
}

const censusIsAuthoritative = census.catalog?.productionUniverseEnumerated === true && census.catalog?.coverageCountMatchesDeclared === true;
const dashboardRows = (census.cards || []).length ? census.cards : (support.cards || []);
const details = dashboardRows.map(row => {
  const supportRow = supportByCard.get(row.cardId) || null;
  const catalogCard = (row.catalogCardId && catalogById.get(row.catalogCardId)) || (row.oracleId && catalogByOracleId.get(row.oracleId)) || null;
  const card = cards[row.cardId] || catalogCard || {};
  const template = templateByCard.get(row.catalogCardId || row.cardId) || templateByCard.get(row.cardId) || null;
  const mechanics = recognizeMechanics(card);
  const classification = row.classification || null;
  const supportStatus = row.supportLevel || row.supportStatus || supportRow?.supportStatus || 'partial';
  const tests = row.behavioralTests || { count: Number(row.testCount || 0), files: row.testFiles || [], goldenCount: Number(row.goldenTestCount || 0) };
  const status = classification === 'fully-supported' || (supportStatus === 'fully_supported' && row.strictEligible)
    ? 'fully_supported'
    : classification === 'non-digital-exclusion' || supportStatus === 'unsupported'
      ? 'unsupported'
      : Number(tests.count || 0) === 0 && Number(tests.goldenCount || 0) === 0
        ? 'unreviewed'
        : 'partially_supported';
  const hasScript = !!(card.script || card.cardScript) || row.declarativeScriptStatus === 'present';
  const executable = hasScript || (card.abilities || []).length > 0 || (card.spellEffects || []).length > 0 || (card.keywords || []).length > 0 || /Creature/i.test(card.typeLine || '');
  return {
    cardId: row.cardId,
    catalogCardId: row.catalogCardId || catalogCard?.id || null,
    oracleId: row.oracleId || supportRow?.oracleId || catalogCard?.oracleId || null,
    name: row.name,
    typeLine: card.typeLine || '',
    manaCost: card.manaCost || '',
    oracleText: card.oracleText || '',
    oracleIdentity: row.oracleIdentity || supportRow?.oracleIdentity || null,
    dashboardStatus: status,
    supportStatus,
    strictEligible: !!row.strictEligible,
    classification,
    classificationReason: row.classificationReason || null,
    implementationPath: row.implementationPath || supportRow?.implementationPath || null,
    parserStatus: row.parserCompilerStatus || template?.status || 'not_indexed',
    parserConfidence: row.parserCompilerConfidence || template?.confidence || 'none',
    matchedTemplates: template?.matchedTemplates || [],
    scriptStatus: row.declarativeScriptStatus || (hasScript ? 'explicit_script' : executable ? 'engine_definition' : 'pending_implementation'),
    castingSupport: row.strictEligible ? 'strict-certified' : status === 'unsupported' ? 'unsupported' : 'rules-path-present-not-certified',
    abilityCount: (card.abilities || []).length,
    spellEffectCount: (card.spellEffects || []).length,
    keywordCount: (card.keywords || []).length,
    mechanics,
    aiSupport: row.strictEligible ? 'authoritative-legal-actions-certified' : status === 'unsupported' ? 'not-supported' : 'authoritative-legal-actions-not-strict-certified',
    testCount: Number(tests.count || 0),
    testFiles: tests.files || [],
    goldenTestCount: Number(tests.goldenCount || 0),
    requiredCustomHooks: row.customHooks || row.requiredCustomHooks || supportRow?.requiredCustomHooks || [],
    caveats: row.knownCaveats || row.caveats || supportRow?.caveats || [],
    identityWarnings: supportRow?.identityWarnings || [],
    lastValidatedRulesVersion: row.lastValidatedRulesVersion || supportRow?.lastValidatedRulesVersion || support.rulesVersion
  };
}).sort((a, b) => a.name.localeCompare(b.name));

const dashboardStatusCounts = { fully_supported: 0, partially_supported: 0, unsupported: 0, unreviewed: 0 };
for (const row of details) dashboardStatusCounts[row.dashboardStatus]++;
const mechanicUsage = new Map(allMechanics.map(def => [def.id, { id: def.id, name: def.name, category: def.category, cardCount: 0 }]));
for (const row of details) for (const id of row.mechanics) if (mechanicUsage.has(id)) mechanicUsage.get(id).cardCount++;
const mechanics = [...mechanicUsage.values()].sort((a, b) => b.cardCount - a.cardCount || a.name.localeCompare(b.name));

const primitive = readJson('coverage/step33-primitive-coverage.json', {});
const interactions = readJson('coverage/step34-interaction-matrix.json', {});
const golden = readJson('coverage/step35-golden-card-coverage.json', {});
const judge = readJson('coverage/step36-judge-scenario-coverage.json', {});
const performance = readJson('performance-artifacts/step38-benchmarks.json', {});
const fuzzFailureFiles = [...listFiles('fuzz-artifacts/failures'), ...listFiles('tests/fuzz/failure-corpus').filter(name => name.endsWith('.json'))];
const workflows = listFiles('.github/workflows').filter(name => /\.ya?ml$/i.test(name));
const stepTests = listFiles('tests').filter(name => /^step\d+-.+\.test\.js$/.test(name));

const subsystemHealth = [
  { id: 'rules-primitives', label: 'Rules primitives', status: primitive.status === 'pass' ? 'pass' : 'attention', metric: `${primitive.coveredPrimitiveCount || 0}/${primitive.requiredPrimitiveCount || 0}`, detail: `${(primitive.missingPrimitives || []).length} missing primitives` },
  { id: 'pairwise-interactions', label: 'Cross-system interactions', status: interactions.pass ? 'pass' : 'attention', metric: `${interactions.present || 0}/${interactions.required || 0}`, detail: `${(interactions.missing || []).length} required interactions missing` },
  { id: 'golden-cards', label: 'Golden card behavior', status: golden.pass ? 'pass' : 'attention', metric: `${golden.goldenCoveredCards || 0}/${golden.fullySupportedCards || 0}`, detail: `${golden.goldenBehaviorCases || 0} behavior cases` },
  { id: 'judge-scenarios', label: 'Judge scenarios', status: judge.pass ? 'pass' : 'attention', metric: `${judge.executableScenarioCount || 0}/${judge.scenarioCount || 0}`, detail: `${judge.criticalTraceSnapshotCount || 0} trace snapshots` },
  { id: 'fuzzing', label: 'Fuzz failure corpus', status: fuzzFailureFiles.length === 0 ? 'pass' : 'attention', metric: `${fuzzFailureFiles.length} failures`, detail: exists('.github/workflows/step37-fuzz-nightly.yml') ? 'Nightly seeded fuzz job configured' : 'Nightly fuzz job missing' },
  { id: 'performance', label: 'Performance benchmarks', status: performance.passed ? 'pass' : 'attention', metric: performance.passed ? 'within thresholds' : `${(performance.failures || []).length} regressions`, detail: performance.generatedAt ? `Last artifact ${performance.generatedAt}` : 'No benchmark artifact' },
  { id: 'rules-ui', label: 'Rules-driven UI', status: exists('tests/step39-rules-driven-ui.test.js') && exists('scripts/check-step39-ui.mjs') ? 'configured' : 'attention', metric: 'Step 39', detail: 'Generic engine-request renderers and UI integration checks' },
  { id: 'ci', label: 'CI / verification configuration', status: workflows.length ? 'configured' : 'attention', metric: `${workflows.length} workflows`, detail: `${stepTests.length} numbered step test suites discovered` }
];

const deckRows = (readiness.decks || []).map(deck => ({
  ...deck,
  blockers: (deck.blockerCardIds || []).map(cardId => {
    const row = supportByCard.get(cardId);
    return { cardId, name: row?.name || cards[cardId]?.name || cardId, status: row ? dashboardStatus(row) : 'missing' };
  })
}));

const strictReadyDecks = deckRows.filter(deck => deck.strictReady).length;
const releaseGate = {
  dataBackedCoverage: true,
  fullSupportPercent: pct(dashboardStatusCounts.fully_supported, details.length),
  strictReadyDecks,
  totalDecks: deckRows.length,
  criticalVerificationGreen: subsystemHealth.filter(row => ['rules-primitives','pairwise-interactions','golden-cards','judge-scenarios','fuzzing','performance'].includes(row.id)).every(row => row.status === 'pass'),
  ciStatus: workflows.length ? 'configured-not-a-live-CI-result' : 'not-configured',
  policy: 'Release metrics are derived from repository support records and generated verification artifacts; configured CI is reported separately from live CI execution.'
};

const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  rulesVersion: support.rulesVersion,
  cardDatabaseVersion: coverage.generatedAt || support.generatedAt,
  summary: {
    totalCards: details.length,
    oracleImplementationCount: censusIsAuthoritative ? details.filter(row => row.implementationPath && !['auto-template-candidate'].includes(row.implementationPath)).length : (coverage.oracleImplementationCount || details.length),
    statusCounts: dashboardStatusCounts,
    statusPercent: Object.fromEntries(Object.entries(dashboardStatusCounts).map(([key, value]) => [key, pct(value, details.length)])),
    mechanicsRegistered: mechanics.length,
    mechanicsSeenInCatalog: mechanics.filter(row => row.cardCount > 0).length,
    cardsWithBehaviorTests: details.filter(row => row.testCount > 0).length,
    cardsWithGoldenTests: details.filter(row => row.goldenTestCount > 0).length,
    goldenBehaviorCaseCount: details.reduce((sum, row) => sum + Number(row.goldenTestCount || 0), 0),
    knownEngineFailureCount: fuzzFailureFiles.length,
    strictReadyDecks,
    totalDecks: deckRows.length
  },
  mechanics,
  cards: details,
  decks: deckRows,
  subsystemHealth,
  performance: {
    generatedAt: performance.generatedAt || null,
    passed: !!performance.passed,
    measured: performance.measured || {},
    thresholds: performance.thresholds || {},
    failures: performance.failures || []
  },
  ci: { status: releaseGate.ciStatus, workflows, stepTestSuites: stepTests.length },
  releaseGate,
  metricPolicy: censusIsAuthoritative ? 'Dashboard card percentages are computed from the complete Oracle support census. Unimplemented production-catalog identities remain visible as unreviewed and can never be omitted from release coverage.' : 'Dashboard percentages are computed from the current support census. Unreviewed is a dashboard-only classification for partial cards with no certification and no card/golden behavior tests; it is not treated as fully supported.'
};

if (CHECK_ONLY) {
  const current = readJson('src/data/generated/rules-coverage-dashboard.json', null);
  if (!current) throw new Error('rules-coverage-dashboard.json is missing. Run npm run build:step40.');
  const normalizedCurrent = { ...current, generatedAt: '__generated__' };
  const normalizedOutput = { ...output, generatedAt: '__generated__' };
  if (JSON.stringify(normalizedCurrent) !== JSON.stringify(normalizedOutput)) throw new Error('Step 40 dashboard artifact is stale. Run npm run build:step40.');
  console.log(`Step 40 dashboard artifact is current: ${details.length} cards, ${deckRows.length} decks, ${mechanics.length} mechanics.`);
} else {
  writeAtomic(OUT, output);
  console.log(`Wrote ${path.relative(ROOT, OUT)} with ${details.length} cards, ${deckRows.length} decks, ${mechanics.length} mechanics.`);
}
