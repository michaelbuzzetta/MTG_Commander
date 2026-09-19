import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCatalogChanges, buildUpdatePlan, buildAffectedTestPlan, STEP43_CHANGE_TYPES } from '../src/database/update/index.js';

const base = [
  { id:'p1', scryfallId:'p1', oracleId:'o1', name:'Alpha', oracleText:'Draw a card.', legalities:{ commander:'legal' }, keywords:[] },
  { id:'p2', scryfallId:'p2', oracleId:'o2', name:'Beta', oracleText:'Flying', legalities:{ commander:'legal' }, keywords:['Flying'] },
  { id:'p3', scryfallId:'p3', oracleId:'o3', name:'Gamma', oracleText:'Haste', legalities:{ commander:'legal' }, keywords:['Haste'] }
];

test('Step 43 classifies new printings without requesting reimplementation', () => {
  const next = [...base, { ...base[0], id:'p1b', scryfallId:'p1b', set:'NEW' }];
  const changes = classifyCatalogChanges(base, next);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].type, STEP43_CHANGE_TYPES.NEW_PRINTING);
  const plan = buildUpdatePlan({ cards:base }, { cards:next });
  assert.deepEqual(plan.affectedOracleIds, []);
  assert.deepEqual(plan.printingOnlyOracleIds, ['o1']);
});

test('Step 43 classifies new Oracle identities and semantic Oracle text changes', () => {
  const next = base.map(card => card.oracleId === 'o1' ? { ...card, oracleText:'Draw two cards.' } : card);
  next.push({ id:'p4', scryfallId:'p4', oracleId:'o4', name:'Delta', oracleText:'Scry 1.', legalities:{ commander:'legal' }, keywords:[] });
  const types = classifyCatalogChanges(base, next).map(change => change.type);
  assert.ok(types.includes(STEP43_CHANGE_TYPES.ORACLE_TEXT));
  assert.ok(types.includes(STEP43_CHANGE_TYPES.NEW_ORACLE));
});

test('Step 43 independently detects legality and newly introduced mechanic indicators', () => {
  const next = base.map(card => card.oracleId === 'o2' ? { ...card, legalities:{ commander:'banned' }, keywords:['Flying','Ward'] } : card);
  const changes = classifyCatalogChanges(base, next);
  assert.ok(changes.some(change => change.type === STEP43_CHANGE_TYPES.LEGALITY));
  const mechanic = changes.find(change => change.type === STEP43_CHANGE_TYPES.MECHANIC_INDICATOR);
  assert.deepEqual(mechanic.addedMechanics, ['Ward']);
});

test('Step 43 affected-test plan targets only changed Oracle implementations', () => {
  const plan = { affectedOracleIds:['o1'], legalityOracleIds:['o2'], printingOnlyOracleIds:['o3'] };
  const support = [
    { cardId:'a', oracleId:'o1', testFiles:['alpha.test.js'], goldenTestCount:1 },
    { cardId:'b', oracleId:'o2', testFiles:['beta.test.js'], goldenTestCount:0 },
    { cardId:'c', oracleId:'o3', testFiles:['gamma.test.js'], goldenTestCount:0 }
  ];
  const tests = buildAffectedTestPlan(plan, support);
  assert.deepEqual(tests.testFiles, ['alpha.test.js','beta.test.js']);
  assert.equal(tests.includeCompilerValidation, true);
  assert.equal(tests.includeGoldenValidation, true);
});

test('Step 43 plan is deterministic for identical catalog snapshots', () => {
  const plan = buildUpdatePlan({ sourceUpdatedAt:'v1', cards:base }, { sourceUpdatedAt:'v1', cards:structuredClone(base) }, { createdAt:'fixed' });
  assert.equal(plan.changeCount, 0);
  assert.equal(plan.requiresImplementationReview, false);
  assert.equal(plan.requiresLegalityRefresh, false);
});
