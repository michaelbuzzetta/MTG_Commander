#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { buildUpdatePlan, buildAffectedTestPlan } from '../src/database/update/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache', 'scryfall');
const CATALOG = path.join(CACHE, 'card-catalog.json');
const META = path.join(CACHE, 'card-catalog-meta.json');
const PRINTING_CATALOG = path.join(CACHE, 'printing-catalog.json');
const UPDATE_DIR = path.join(ROOT, 'src', 'data', 'updates');
const SNAPSHOT = path.join(UPDATE_DIR, 'step43-catalog-snapshot.json');
const PRINTING_SNAPSHOT = path.join(UPDATE_DIR, 'step43-printing-snapshot.json');
const PLAN_FILE = path.join(UPDATE_DIR, 'step43-update-plan.json');
const REVIEW_FILE = path.join(UPDATE_DIR, 'step43-oracle-diff-queue.json');
const TEST_PLAN_FILE = path.join(UPDATE_DIR, 'step43-affected-test-plan.json');
const STATE_FILE = path.join(UPDATE_DIR, 'step43-update-state.json');
const SUPPORT_FILE = path.join(ROOT, 'src', 'data', 'generated', 'card-support.json');
const args = new Set(process.argv.slice(2));
const CHECK = args.has('--check');
const NO_SYNC = args.has('--no-sync');
const RUN_TESTS = args.has('--run-affected-tests');
const ACKNOWLEDGE_REVIEWED = args.has('--acknowledge-reviewed');

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function writeAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}
function normalizeCatalog(value = {}) {
  return {
    schemaVersion: value.schemaVersion || 1,
    source: value.source || 'unknown',
    sourceType: value.sourceType || 'unknown',
    sourceUpdatedAt: value.sourceUpdatedAt || null,
    complete: !!value.complete,
    count: Number(value.count || value.cards?.length || 0),
    cards: Array.isArray(value.cards) ? value.cards : []
  };
}
function durableOracleSnapshot(catalog) {
  const normalized = normalizeCatalog(catalog);
  return {
    ...normalized,
    cards: normalized.cards.map(card => ({
      id: card.id || null,
      oracleId: oracleIdentity(card),
      scryfallId: card.scryfallId || card.scryfall_id || null,
      name: card.name || '',
      oracleText: card.oracleText || card.oracle_text || '',
      legalities: card.legalities || {},
      keywords: card.keywords || [],
      rulingMetadata: card.rulingMetadata || card.rulings || {}
    })),
    capturedAt: new Date().toISOString()
  };
}
function durablePrintingSnapshot(catalog) {
  const normalized = normalizeCatalog(catalog);
  return {
    ...normalized,
    cards: normalized.cards.map(card => ({
      id: printingIdentity(card),
      scryfallId: card.scryfallId || card.scryfall_id || printingIdentity(card),
      oracleId: oracleIdentity(card),
      name: card.name || ''
    })),
    capturedAt: new Date().toISOString()
  };
}
function printingIdentity(card = {}) { return card.scryfallId || card.scryfall_id || card.id || null; }
function oracleIdentity(card = {}) { return card.oracleId || card.oracle_id || card.oracleIdentity || null; }
function detectNewPrintingChanges(previous = {}, current = {}) {
  const before = new Map();
  for (const card of previous.cards || []) { const oid = oracleIdentity(card); const pid = printingIdentity(card); if (!oid || !pid) continue; if (!before.has(oid)) before.set(oid, new Set()); before.get(oid).add(pid); }
  const added = new Map();
  for (const card of current.cards || []) { const oid = oracleIdentity(card); const pid = printingIdentity(card); if (!oid || !pid || before.get(oid)?.has(pid)) continue; if (!added.has(oid)) added.set(oid, { type:'new_printing_only', oracleId:oid, name:card.name || '', printingIds:[] }); added.get(oid).printingIds.push(pid); }
  return [...added.values()].map(row => ({ ...row, printingIds:[...new Set(row.printingIds)].sort() })).sort((a,b)=>a.oracleId.localeCompare(b.oracleId));
}
function withoutEphemeral(value) {
  if (Array.isArray(value)) return value.map(withoutEphemeral);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['createdAt','capturedAt','generatedAt','lastCheckedAt','lastSuccessfulRefreshAt'].includes(key)).map(([key, child]) => [key, withoutEphemeral(child)]));
}
function sameMeaning(a, b) { return JSON.stringify(withoutEphemeral(a)) === JSON.stringify(withoutEphemeral(b)); }

if (!NO_SYNC && !CHECK) {
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'sync-scryfall-catalog.mjs')], { cwd: ROOT, stdio: 'inherit', timeout: 210000 });
  } catch (error) {
    console.warn(`Step 43 sync command did not complete cleanly (${error.message}); evaluating the last-known-good catalog instead.`);
  }
}

const current = normalizeCatalog(readJson(CATALOG, { cards: [] }));
const currentPrintings = normalizeCatalog(readJson(PRINTING_CATALOG, { cards: [] }));
if (!current.cards.length) throw new Error('Step 43 cannot run because no local Oracle card catalog is available.');
if (!currentPrintings.cards.length) throw new Error('Step 43 cannot run because no local printing catalog is available.');
const currentOracleCatalogSha256 = sha256File(CATALOG);
const currentPrintingCatalogSha256 = sha256File(PRINTING_CATALOG);
const meta = readJson(META, {});
const support = readJson(SUPPORT_FILE, { cards: [] });
const existingState = readJson(STATE_FILE);
const existingPlan = readJson(PLAN_FILE);
const existingArtifactsPresent = [PLAN_FILE, REVIEW_FILE, TEST_PLAN_FILE, STATE_FILE].every(file => fs.existsSync(file));
if (!CHECK && !ACKNOWLEDGE_REVIEWED && existingArtifactsPresent && existingState?.oracleCatalogSha256 === currentOracleCatalogSha256 && existingState?.printingCatalogSha256 === currentPrintingCatalogSha256 && existingPlan?.candidateCatalogSha256 === currentOracleCatalogSha256 && existingPlan?.candidatePrintingCatalogSha256 === currentPrintingCatalogSha256) {
  const refreshedTests = buildAffectedTestPlan(existingPlan, support.cards || []);
  const existingTests = readJson(TEST_PLAN_FILE);
  if (!sameMeaning(existingTests, refreshedTests)) writeAtomic(TEST_PLAN_FILE, refreshedTests);
  console.log(`Step 43 catalog is unchanged since the last classified update; preserving the existing ${Number(existingState.changeCount || 0)}-change review queue.`);
  process.exit(0);
}
if (ACKNOWLEDGE_REVIEWED && existingArtifactsPresent) {
  const historyDir = path.join(UPDATE_DIR, 'history');
  fs.mkdirSync(historyDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  writeAtomic(path.join(historyDir, `${stamp}-reviewed-update.json`), {
    schemaVersion: 1,
    acknowledgedAt: new Date().toISOString(),
    plan: readJson(PLAN_FILE),
    review: readJson(REVIEW_FILE),
    affectedTests: readJson(TEST_PLAN_FILE),
    state: existingState
  });
}
const previous = normalizeCatalog(readJson(SNAPSHOT, current));
const previousPrintings = normalizeCatalog(readJson(PRINTING_SNAPSHOT, currentPrintings));
const plan = buildUpdatePlan(previous, current);
const printingChanges = detectNewPrintingChanges(previousPrintings, currentPrintings);
const existingPrintingKeys = new Set((plan.changes || []).filter(row => row.type === 'new_printing_only').map(row => row.oracleId));
for (const change of printingChanges) if (!existingPrintingKeys.has(change.oracleId)) plan.changes.push(change);
plan.changes.sort((a,b)=>a.oracleId.localeCompare(b.oracleId)||a.type.localeCompare(b.type));
plan.changeCount = plan.changes.length;
plan.printingOnlyOracleIds = [...new Set(plan.changes.filter(row => row.type === 'new_printing_only').map(row => row.oracleId))].sort();
plan.candidateCatalogSha256 = currentOracleCatalogSha256;
plan.candidatePrintingCatalogSha256 = currentPrintingCatalogSha256;
const testPlan = buildAffectedTestPlan(plan, support.cards || []);
const review = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  sourceVersion: current.sourceUpdatedAt,
  changeCount: plan.changes.length,
  requiresReviewCount: plan.changes.filter(change => ['new_oracle_card','oracle_text_change','new_keyword_mechanic_indicator','ruling_metadata_change'].includes(change.type)).length,
  changes: plan.changes,
  policy: 'New printings reuse an existing Oracle implementation. New/changed Oracle identities, semantic text changes, ruling metadata, and new mechanic indicators require review before full support is granted.'
};
const state = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  status: meta.status || (current.complete ? 'current' : 'offline-fallback'),
  catalogComplete: current.complete && currentPrintings.complete,
  catalogCount: current.cards.length,
  oracleCatalogComplete: current.complete,
  printingCatalogComplete: currentPrintings.complete,
  printingCatalogCount: currentPrintings.cards.length,
  sourceUpdatedAt: current.sourceUpdatedAt,
  lastSuccessfulRefreshAt: meta.downloadedAt || previous.capturedAt || null,
  lastCheckAt: meta.lastCheckedAt || null,
  etag: meta.etag || null,
  sourceType: `${current.sourceType}+${currentPrintings.sourceType}`,
  oracleCatalogSha256: currentOracleCatalogSha256,
  printingCatalogSha256: currentPrintingCatalogSha256,
  oracleBulkSha256: meta.oracleBulkSha256 || null,
  printingBulkSha256: meta.printingBulkSha256 || null,
  oracleBulkBytes: meta.oracleBulkBytes || null,
  printingBulkBytes: meta.printingBulkBytes || null,
  printingSourceUpdatedAt: currentPrintings.sourceUpdatedAt,
  changeCount: plan.changeCount,
  pendingImplementationReview: plan.affectedOracleIds.length,
  pendingLegalityRefresh: plan.legalityOracleIds.length,
  atomicUpdatePolicy: 'Candidate artifacts are written to temporary files and renamed only after validation; the prior catalog/snapshot remains usable if refresh or validation fails.'
};

if (CHECK) {
  const committedPlan = readJson(PLAN_FILE);
  const committedReview = readJson(REVIEW_FILE);
  const committedTests = readJson(TEST_PLAN_FILE);
  const committedState = readJson(STATE_FILE);
  if (!committedPlan || !committedReview || !committedTests || !committedState) throw new Error('Step 43 generated artifacts are missing; run npm run update:step43.');
  if (committedPlan.candidateCatalogSha256 !== currentOracleCatalogSha256 || committedPlan.candidatePrintingCatalogSha256 !== currentPrintingCatalogSha256 || committedPlan.candidateCount !== current.cards.length) throw new Error('Step 43 update plan does not target the current catalog bytes.');
  const expectedTests = buildAffectedTestPlan(committedPlan, support.cards || []);
  const expectedReview = { ...review, changeCount: committedPlan.changes.length, requiresReviewCount: committedPlan.changes.filter(change => ['new_oracle_card','oracle_text_change','new_keyword_mechanic_indicator','ruling_metadata_change'].includes(change.type)).length, changes: committedPlan.changes };
  if (!sameMeaning(committedReview, expectedReview)) throw new Error('Step 43 Oracle diff queue is stale.');
  if (!sameMeaning(committedTests, expectedTests)) throw new Error('Step 43 affected-test plan is stale.');
  if (committedState.catalogCount !== state.catalogCount || committedState.printingCatalogCount !== state.printingCatalogCount || committedState.sourceUpdatedAt !== state.sourceUpdatedAt || committedState.printingSourceUpdatedAt !== state.printingSourceUpdatedAt || committedState.catalogComplete !== state.catalogComplete || committedState.oracleCatalogSha256 !== state.oracleCatalogSha256 || committedState.printingCatalogSha256 !== state.printingCatalogSha256 || committedState.oracleBulkSha256 !== state.oracleBulkSha256 || committedState.printingBulkSha256 !== state.printingBulkSha256 || committedState.changeCount !== committedPlan.changeCount || committedState.pendingImplementationReview !== committedPlan.affectedOracleIds.length || committedState.pendingLegalityRefresh !== committedPlan.legalityOracleIds.length) throw new Error('Step 43 update state is stale.');
  console.log(`Step 43 artifacts are current: ${current.cards.length} catalog cards, ${committedPlan.changeCount} pending changes.`);
  process.exit(0);
}

writeAtomic(PLAN_FILE, plan);
writeAtomic(REVIEW_FILE, review);
writeAtomic(TEST_PLAN_FILE, testPlan);
writeAtomic(STATE_FILE, state);
writeAtomic(SNAPSHOT, durableOracleSnapshot(current));
writeAtomic(PRINTING_SNAPSHOT, durablePrintingSnapshot(currentPrintings));

if (RUN_TESTS) {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'run-step43-affected-tests.mjs')], { cwd: ROOT, stdio: 'inherit', timeout: 180000 });
}
console.log(`Step 43 update pipeline complete: ${current.cards.length} catalog cards, ${plan.changeCount} classified changes, ${plan.affectedOracleIds.length} implementation-review identities.`);
