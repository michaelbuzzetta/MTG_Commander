import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PracticalCoverageService, collectExplicitUnsupportedNodes, STEP45_TRIAGE_CATEGORY } from '../src/support/PracticalCoverageService.js';

const support = JSON.parse(fs.readFileSync('src/data/generated/card-support.json', 'utf8'));
const cards = JSON.parse(fs.readFileSync('src/data/generated/cards.json', 'utf8'));
const templates = JSON.parse(fs.readFileSync('src/data/generated/oracle-template-compilation.json', 'utf8'));
const updateState = JSON.parse(fs.readFileSync('src/data/updates/step43-update-state.json', 'utf8'));
const triage = JSON.parse(fs.readFileSync('src/data/generated/step45-remaining-card-triage.json', 'utf8'));
const release = JSON.parse(fs.readFileSync('src/data/generated/practical-100-coverage-report.json', 'utf8'));

test('Step 45: every support record is assigned exactly one final triage category', () => {
  const service = new PracticalCoverageService({ support, cards, templates, updateState });
  const result = service.buildTriage();
  assert.equal(result.rows.length, support.cards.length);
  const legal = new Set(Object.values(STEP45_TRIAGE_CATEGORY));
  assert.ok(result.rows.every(row => legal.has(row.category)));
  assert.equal(Object.values(result.summary.categoryCounts).reduce((a,b)=>a+b,0), support.cards.length);
});

test('Step 45: nested unsupported card faces remain visible while the certified Esika MDFC no longer carries that blocker', () => {
  const syntheticCard = {
    id: 'fixture-mdfc',
    name: 'Fixture MDFC',
    supported: true,
    alternateFace: { name: 'Unsupported Back', supported: false, unsupportedReason: 'Fixture engine gap.' }
  };
  const nodes = collectExplicitUnsupportedNodes(syntheticCard);
  assert.ok(nodes.some(node => node.path === 'alternateFace' && /Fixture engine gap/i.test(node.reason)));

  assert.deepEqual(collectExplicitUnsupportedNodes(cards.esika), []);
  const fullRow = triage.groups['fully-supported'].find(item => item.cardId === 'esika');
  assert.ok(fullRow, 'Esika should move out of engine-capability triage once both MDFC faces are behaviorally certified');
  assert.equal(triage.groups['missing-engine-capability'].some(item => item.cardId === 'esika'), false);
});

test('Step 45: practical 100% cannot certify an incomplete card catalog', () => {
  const service = new PracticalCoverageService({ support, cards, templates, updateState: { ...updateState, catalogComplete: false } });
  const assessment = service.buildReleaseAssessment();
  assert.equal(assessment.practical100Ready, false);
  assert.ok(assessment.blockers.some(text => /catalog.*incomplete/i.test(text)));
  assert.throws(() => service.assertPractical100(), error => error?.code === 'PRACTICAL_100_NOT_READY');
});

test('Step 45: synthetic complete fully-supported scope passes the final certification gate', () => {
  const minimalSupport = { cards: [{ cardId: 'x', name: 'X', oracleIdentity: 'oracle:x', supportStatus: 'fully_supported', strictEligible: true, implementationPath: 'declarative-scripted', caveats: [], requiredCustomHooks: [] }] };
  const service = new PracticalCoverageService({ support: minimalSupport, cards: { x: { id: 'x', name: 'X', oracleId: 'x', supported: true } }, updateState: { catalogComplete: true, catalogCount: 1, sourceType: 'test' }, catalog: { complete: true, cards: [{ id: 'catalog-x', oracleId: 'x', name: 'X' }] } });
  assert.equal(service.assertPractical100().practical100Ready, true);
});



test('Step 45: a complete production catalog with unimplemented Oracle identities can never false-pass', () => {
  const minimalSupport = { cards: [{ cardId: 'x', name: 'X', oracleId: 'x', oracleIdentity: 'oracle:x', supportStatus: 'fully_supported', strictEligible: true, implementationPath: 'declarative-scripted', caveats: [], requiredCustomHooks: [] }] };
  const service = new PracticalCoverageService({
    support: minimalSupport,
    cards: { x: { id: 'x', name: 'X', oracleId: 'x', supported: true } },
    updateState: { catalogComplete: true, catalogCount: 2, sourceType: 'test' },
    catalog: { complete: true, cards: [{ id: 'catalog-x', oracleId: 'x', name: 'X' }, { id: 'catalog-y', oracleId: 'y', name: 'Y' }] }
  });
  const assessment = service.buildReleaseAssessment();
  assert.equal(assessment.censusCatalogCount, 2);
  assert.equal(assessment.censusCoversDeclaredCatalog, true);
  assert.equal(assessment.practical100Ready, false);
  assert.equal(assessment.triage.summary.unresolvedInScopeCount, 1);
  assert.ok(assessment.triage.rows.some(row => row.oracleIdentity === 'oracle:y' && row.category === 'missing-script-or-template'));
});

test('Step 45: a declared complete catalog is rejected when the production catalog universe is not supplied', () => {
  const minimalSupport = { cards: [{ cardId: 'x', name: 'X', oracleIdentity: 'oracle:x', supportStatus: 'fully_supported', strictEligible: true, implementationPath: 'declarative-scripted', caveats: [], requiredCustomHooks: [] }] };
  const service = new PracticalCoverageService({ support: minimalSupport, cards: { x: { id: 'x', name: 'X' } }, updateState: { catalogComplete: true, catalogCount: 1, sourceType: 'test' } });
  const assessment = service.buildReleaseAssessment();
  assert.equal(assessment.practical100Ready, false);
  assert.equal(assessment.productionUniverseLoaded, false);
  assert.ok(assessment.blockers.some(text => /not enumerating.*production catalog/i.test(text)));
});


test('Step 45: pending Step 43 semantic or legality review blocks certification even when card coverage is otherwise complete', () => {
  const minimalSupport = { cards: [{ cardId: 'x', name: 'X', oracleId: 'x', oracleIdentity: 'oracle:x', supportStatus: 'fully_supported', strictEligible: true, implementationPath: 'declarative-scripted', caveats: [], requiredCustomHooks: [] }] };
  const catalog = { complete: true, cards: [{ id: 'catalog-x', oracleId: 'x', name: 'X' }] };
  const base = { catalogComplete: true, catalogCount: 1, sourceType: 'test' };
  const semantic = new PracticalCoverageService({ support: minimalSupport, cards: { x: { id: 'x', name: 'X', oracleId: 'x', supported: true } }, catalog, updateState: { ...base, pendingImplementationReview: 1 } }).buildReleaseAssessment();
  assert.equal(semantic.practical100Ready, false);
  assert.ok(semantic.blockers.some(text => /semantic implementation-review queue/i.test(text)));
  const legality = new PracticalCoverageService({ support: minimalSupport, cards: { x: { id: 'x', name: 'X', oracleId: 'x', supported: true } }, catalog, updateState: { ...base, pendingLegalityRefresh: 1 } }).buildReleaseAssessment();
  assert.equal(legality.practical100Ready, false);
  assert.ok(legality.blockers.some(text => /pending legality/i.test(text)));
});

test('Step 45: generated release status is fail-closed and numerically consistent', () => {
  assert.equal(release.practical100Ready, release.catalogComplete && release.productionUniverseLoaded && release.censusCoversDeclaredCatalog && release.step43ReviewClear && release.unresolvedInScopeCount === 0);
  assert.equal(release.inScopeCount, release.fullySupportedCount + release.unresolvedInScopeCount);
  assert.equal(release.status, release.practical100Ready ? 'certified' : 'blocked');
});

test('Step 45: non-digital exclusions never contain unresolved partial cards without explicit exclusion classification', () => {
  const exclusions = JSON.parse(fs.readFileSync('src/data/generated/non-digital-exclusions.json', 'utf8'));
  const excludedIds = new Set(exclusions.exclusions.map(row => row.cardId));
  for (const row of support.cards) {
    if (!excludedIds.has(row.cardId)) continue;
    assert.equal(row.implementationPath, 'non-digital-unsupported');
  }
});
