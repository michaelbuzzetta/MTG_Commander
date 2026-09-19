import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  OracleTemplateCompiler,
  ORACLE_PARSER_VERSION,
  diffCompilerSnapshots,
  oracleFingerprint
} from '../src/cards/compiler/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_ONLY = process.argv.includes('--check');
const ACCEPT_CHANGES = process.argv.includes('--accept-changes');
const SOURCE_CARDS = path.join(ROOT, 'src/data/source/cards.json');
const PRODUCTION_CATALOG = path.join(ROOT, '.cache', 'scryfall', 'card-catalog.json');
const SUPPORT_FILE = path.join(ROOT, 'src/data/generated/card-support.json');
const OUT = path.join(ROOT, 'src/data/generated');
const HISTORY_DIR = path.join(OUT, 'oracle-template-history');
const COMPILE_FILE = path.join(OUT, 'oracle-template-compilation.json');
const REVIEW_FILE = path.join(OUT, 'oracle-template-review-queue.json');
const COVERAGE_FILE = path.join(OUT, 'oracle-template-coverage.json');
const SNAPSHOT_FILE = path.join(OUT, 'oracle-template-snapshot.json');
const DIFF_FILE = path.join(OUT, 'oracle-change-diff.json');

const NO_FALLBACK = Symbol('no-fallback');
function readJson(file, fallback = NO_FALLBACK) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (fallback !== NO_FALLBACK) return fallback; throw error; }
}

// These artifacts become tens of megabytes against the production Oracle
// catalog. Pretty-printing them roughly doubles disk I/O and transient string
// memory without making them meaningfully reviewable. Keep small summaries
// readable and write large machine artifacts compactly.
function writeJson(file, value, { pretty = false } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  const body = pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
  fs.writeFileSync(tmp, `${body}\n`);
  fs.renameSync(tmp, file);
}

function sameIgnoringTopLevelGeneratedAt(current, expected) {
  if (!current || !expected) return false;
  const normalized = { ...expected, generatedAt: current.generatedAt };
  return JSON.stringify(current) === JSON.stringify(normalized);
}
function pct(value, total) { return total ? Number(((value / total) * 100).toFixed(2)) : 0; }
function safeStamp(iso) { return String(iso).replace(/[:.]/g, '-'); }

const sourceCards = readJson(SOURCE_CARDS);
const productionCatalog = readJson(PRODUCTION_CATALOG, { cards: [], complete: false });
const useProductionCatalog = productionCatalog.complete === true && Array.isArray(productionCatalog.cards) && productionCatalog.cards.length > 0;
const cards = useProductionCatalog
  ? Object.fromEntries(productionCatalog.cards.map(card => [card.id, card]))
  : sourceCards;
const support = readJson(SUPPORT_FILE, { cards: [] });
const supportById = Object.fromEntries((support.cards || []).map(row => [row.cardId, row]));
const supportByOracleId = new Map((support.cards || []).filter(row => row.oracleId).map(row => [row.oracleId, row]));
const normalizeName = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[’‘]/g, "'").replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
const supportByName = new Map((support.cards || []).map(row => [normalizeName(row.name), row]));
const compiler = new OracleTemplateCompiler();

const startedAt = Date.now();
const rows = compiler.compileDatabase(cards).map(row => {
  const card = cards[row.cardId] || {};
  const supportRow = supportById[row.cardId]
    || (card.oracleId ? supportByOracleId.get(card.oracleId) : null)
    || supportByName.get(normalizeName(card.name));
  return {
    ...row,
    oracleId: card.oracleId || supportRow?.oracleId || null,
    oracleIdentity: card.oracleId ? `oracle:${card.oracleId}` : supportRow?.oracleIdentity || null,
    implementationCardId: supportRow?.cardId || null,
    implementationPath: supportRow?.implementationPath || null,
    productionCatalogCard: useProductionCatalog
  };
}).sort((a,b)=>a.cardId.localeCompare(b.cardId));
const compiledMs = Date.now() - startedAt;

const auto = rows.filter(row => row.autoAccepted);
const review = rows.filter(row => !row.autoAccepted).map(row => ({
  cardId: row.cardId,
  name: row.name,
  oracleIdentity: row.oracleIdentity,
  implementationPath: row.implementationPath,
  oracleFingerprint: row.oracleFingerprint,
  confidence: row.confidence,
  matchedTemplates: row.matchedTemplates,
  diagnostics: row.diagnostics,
  priority: row.implementationPath === 'auto-template-candidate' ? 'high' : 'normal'
}));

const byTemplate = {};
for (const row of auto) for (const id of row.matchedTemplates) byTemplate[id] = (byTemplate[id] || 0) + 1;
const generatedAt = new Date().toISOString();
const compilationPayload = {
  schemaVersion: 1,
  parserVersion: ORACLE_PARSER_VERSION,
  generatedAt,
  policy: compiler.capabilities().policy,
  rows
};
const reviewPayload = {
  schemaVersion: 1,
  parserVersion: ORACLE_PARSER_VERSION,
  generatedAt,
  reviewCount: review.length,
  highPriorityCount: review.filter(row => row.priority === 'high').length,
  cards: review
};
const coveragePayload = {
  schemaVersion: 1,
  parserVersion: ORACLE_PARSER_VERSION,
  generatedAt,
  cardCount: rows.length,
  productionCatalogUniverse: useProductionCatalog,
  catalogComplete: productionCatalog.complete === true,
  exactHighConfidenceCompilations: auto.length,
  exactHighConfidencePercent: pct(auto.length, rows.length),
  reviewRequired: review.length,
  highPriorityTemplateQueue: review.filter(row => row.priority === 'high').length,
  templateCounts: Object.fromEntries(Object.entries(byTemplate).sort((a,b)=>a[0].localeCompare(b[0]))),
  availableTemplates: compiler.capabilities().templates,
  metricPolicy: 'Only unique exact full-text high-confidence matches count as auto-compiled. Unknown, partial, or ambiguous Oracle text remains review-required.'
};

const rowById = new Map(rows.map(row => [row.cardId, row]));
const snapshotCards = Object.fromEntries(Object.values(cards).map(card => [card.id, {
  id: card.id,
  name: card.name,
  oracleId: card.oracleId || supportById[card.id]?.oracleId || supportByName.get(normalizeName(card.name))?.oracleId || null,
  oracleFingerprint: oracleFingerprint(card.oracleText || ''),
  behaviorFingerprint: rowById.get(card.id)?.behaviorFingerprint || null,
  parserVersion: ORACLE_PARSER_VERSION
}]));
const snapshotPayload = { schemaVersion: 2, parserVersion: ORACLE_PARSER_VERSION, generatedAt, cards: snapshotCards };

const existingSnapshot = readJson(SNAPSHOT_FILE, null);
const compilerDiff = existingSnapshot
  ? diffCompilerSnapshots(existingSnapshot, snapshotPayload)
  : { schemaVersion: 1, changeCount: Object.keys(snapshotCards).length, behaviorChangeCount: auto.length, parserVersionChangeCount: Object.keys(snapshotCards).length, changes: [] };

const diffPayload = {
  ...compilerDiff,
  schemaVersion: 2,
  parserVersion: ORACLE_PARSER_VERSION,
  generatedAt,
  baselineParserVersion: existingSnapshot?.parserVersion || null,
  baselinePresent: !!existingSnapshot,
  accepted: false,
  policy: 'Parser-version, Oracle-text, or generated-behavior changes are reviewable semantic diffs; executable behavior changes are never silently accepted.'
};

const expected = [
  [COMPILE_FILE, compilationPayload, 'oracle-template-compilation.json'],
  [REVIEW_FILE, reviewPayload, 'oracle-template-review-queue.json'],
  [COVERAGE_FILE, coveragePayload, 'oracle-template-coverage.json'],
  [SNAPSHOT_FILE, snapshotPayload, 'oracle-template-snapshot.json']
];

if (CHECK_ONLY) {
  for (const [file, payload, label] of expected) {
    const current = readJson(file, null);
    if (!current) throw new Error(`Missing Step 18 artifact ${label}; run npm run build-oracle-templates.`);
    if (!sameIgnoringTopLevelGeneratedAt(current, payload)) throw new Error(`Stale Step 18 artifact ${label}; run npm run build-oracle-templates.`);
  }
  const currentDiff = readJson(DIFF_FILE, null);
  if (!currentDiff) throw new Error('Missing Step 18 artifact oracle-change-diff.json.');
  if (currentDiff.parserVersion !== ORACLE_PARSER_VERSION) throw new Error('Committed Oracle diff uses a stale parser version.');
  if (Number(currentDiff.changeCount || 0) !== 0) throw new Error('Committed Oracle/compiler diff is not clean; review the semantic changes and rebuild with --accept-changes.');
  if (diffCompilerSnapshots(snapshotPayload, snapshotPayload).changeCount !== 0) throw new Error('Step 18 self-diff was not deterministic.');
  console.log(`Validated Step 18 Oracle compiler for ${rows.length} cards (${auto.length} exact high-confidence auto-compilations, ${review.length} review-required) in ${compiledMs}ms.`);
} else {
  writeJson(COMPILE_FILE, compilationPayload);
  writeJson(REVIEW_FILE, reviewPayload);
  writeJson(COVERAGE_FILE, coveragePayload, { pretty: true });

  if (ACCEPT_CHANGES) {
    if (existingSnapshot && compilerDiff.changeCount > 0) {
      fs.mkdirSync(HISTORY_DIR, { recursive: true });
      writeJson(path.join(HISTORY_DIR, `${safeStamp(generatedAt)}-accepted-compiler-diff.json`), {
        ...diffPayload,
        accepted: true,
        acceptedAt: generatedAt
      });
    }
    writeJson(SNAPSHOT_FILE, snapshotPayload);
    writeJson(DIFF_FILE, {
      schemaVersion: 2,
      parserVersion: ORACLE_PARSER_VERSION,
      generatedAt,
      baselineParserVersion: ORACLE_PARSER_VERSION,
      baselinePresent: true,
      accepted: true,
      changeCount: 0,
      behaviorChangeCount: 0,
      parserVersionChangeCount: 0,
      changes: [],
      policy: diffPayload.policy
    }, { pretty: true });
  } else {
    // Preserve the existing baseline while exposing changes for review. If no
    // baseline exists, write the first snapshot because there is nothing to
    // compare against yet.
    if (!existingSnapshot) writeJson(SNAPSHOT_FILE, snapshotPayload);
    writeJson(DIFF_FILE, diffPayload);
  }

  console.log(`Built Step 18 Oracle compiler artifacts for ${rows.length} cards in ${compiledMs}ms.`);
  console.log(`Exact high-confidence: ${auto.length}; review-required: ${review.length}; high-priority template queue: ${review.filter(row=>row.priority==='high').length}.`);
  if (!ACCEPT_CHANGES && compilerDiff.changeCount > 0) {
    console.log(`Review required: ${compilerDiff.changeCount} compiler snapshot changes (${compilerDiff.behaviorChangeCount} generated-behavior changes). Re-run with --accept-changes after tests/review.`);
  }
}

// This command is fully synchronous; force a clean CLI exit after large full-catalog
// builds so V8 does not spend the release-runner budget in post-build heap teardown.
process.exit(0);
