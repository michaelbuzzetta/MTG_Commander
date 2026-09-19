#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectExplicitUnsupportedNodes, classifyRemainingCard, STEP45_TRIAGE_CATEGORY } from '../src/support/PracticalCoverageService.js';
import { classifyCatalogCardScope } from '../src/support/CardScopePolicy.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const read = (rel, fallback = null) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch (e) { if (fallback !== null) return fallback; throw e; } };
const stable = value => JSON.stringify(value, (k,v) => ['generatedAt'].includes(k) ? undefined : v);
const write = (rel, value) => { const file=path.join(ROOT,rel); fs.mkdirSync(path.dirname(file),{recursive:true}); const t=`${file}.tmp-${process.pid}`; fs.writeFileSync(t,JSON.stringify(value,null,2)+'\n'); fs.renameSync(t,file); };
const norm = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[’‘]/g, "'").replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
const oracleIdentity = card => card?.oracleId || card?.oracle_id ? `oracle:${card.oracleId || card.oracle_id}` : (card?.id ? `catalog:${card.id}` : `catalog-name:${norm(card?.name)}`);

const cards = read('src/data/source/cards.json', {});
const support = read('src/data/generated/card-support.json', { cards: [] });
const templates = read('src/data/generated/oracle-template-compilation.json', { rows: [] });
const promotions = read('src/data/generated/compiler-promoted-cards.json', { cards: {} });
const update = read('src/data/updates/step43-update-state.json', {});
const catalog = read('.cache/scryfall/card-catalog.json', { cards: [], complete: false });
const templateById = new Map((templates.rows||[]).map(r=>[r.cardId,r]));
const promotionById = new Map(Object.entries(promotions.cards || {}));
const supportByOracleId = new Map();
const supportByIdentity = new Map();
const supportByName = new Map();
const sourceByOracleId = new Map();
const sourceByName = new Map();
for (const row of support.cards || []) {
  if (row.oracleId && !supportByOracleId.has(row.oracleId)) supportByOracleId.set(row.oracleId, row);
  if (row.oracleIdentity && !supportByIdentity.has(row.oracleIdentity)) supportByIdentity.set(row.oracleIdentity, row);
  const key = norm(row.name);
  if (key && !supportByName.has(key)) supportByName.set(key, row);
}
for (const card of Object.values(cards)) {
  if (card.oracleId && !sourceByOracleId.has(card.oracleId)) sourceByOracleId.set(card.oracleId, card);
  const key = norm(card.name);
  if (key && !sourceByName.has(key)) sourceByName.set(key, card);
}

function mechanicsOf(card={}) {
  const out = new Set((card.keywords||[]).map(String));
  for (const a of card.abilities||[]) {
    if (a.type) out.add(`ability:${a.type}`);
    if (a.event) out.add(`event:${a.event}`);
    if (a.effect?.type) out.add(`effect:${a.effect.type}`);
  }
  for (const e of card.spellEffects||[]) if (e?.type) out.add(`effect:${e.type}`);
  return [...out].sort();
}

function rowFromSupport(row, catalogCard = null) {
  const sourceCard = cards[row.cardId]
    || (row.oracleId ? sourceByOracleId.get(row.oracleId) : null)
    || sourceByName.get(norm(row.name))
    || {};
  const template = templateById.get(row.cardId) || null;
  const classification = classifyRemainingCard(row, sourceCard, template);
  const unsupported = collectExplicitUnsupportedNodes(sourceCard);
  return {
    oracleId: catalogCard?.oracleId || catalogCard?.oracle_id || row.oracleId || null,
    oracleIdentity: catalogCard ? oracleIdentity(catalogCard) : row.oracleIdentity,
    cardId: row.cardId,
    catalogCardId: catalogCard?.id || null,
    name: catalogCard?.name || row.name,
    supportLevel: row.supportStatus,
    strictEligible: !!row.strictEligible,
    classification: classification.category,
    classificationReason: classification.reason,
    detectedMechanics: mechanicsOf(catalogCard || sourceCard),
    parserCompilerStatus: template?.status || 'not-run',
    parserCompilerConfidence: template?.confidence || 'none',
    declarativeScriptStatus: (sourceCard.script||sourceCard.cardScript) ? 'present' : ((sourceCard.abilities||[]).length || (sourceCard.spellEffects||[]).length || (sourceCard.keywords||[]).length ? 'legacy-declarative-model' : 'absent'),
    customHookStatus: (row.requiredCustomHooks||[]).length ? 'required' : 'none',
    customHooks: row.requiredCustomHooks || [],
    behavioralTests: { count: Number(row.testCount||0), files: row.testFiles||[], goldenCount: Number(row.goldenTestCount||0) },
    knownCaveats: row.caveats || [],
    explicitUnsupportedNodes: unsupported,
    lastValidatedDatabaseVersion: update.sourceUpdatedAt || null,
    lastValidatedRulesVersion: row.lastValidatedRulesVersion || support.rulesVersion || null,
    implementationPath: row.implementationPath || null,
    catalogMatched: !!catalogCard
  };
}


function rowFromFormatExcludedCatalogCard(card) {
  const scope = classifyCatalogCardScope(card);
  return {
    oracleId: card.oracleId || card.oracle_id || null,
    oracleIdentity: oracleIdentity(card),
    cardId: card.id || oracleIdentity(card),
    catalogCardId: card.id || null,
    name: card.name || oracleIdentity(card),
    supportLevel: 'excluded',
    strictEligible: false,
    classification: STEP45_TRIAGE_CATEGORY.FORMAT_SCOPE,
    classificationReason: scope.reason,
    detectedMechanics: mechanicsOf(card),
    parserCompilerStatus: 'not-required-out-of-scope',
    parserCompilerConfidence: 'none',
    declarativeScriptStatus: 'not-required-out-of-scope',
    customHookStatus: 'none',
    customHooks: [],
    behavioralTests: { count: 0, files: [], goldenCount: 0 },
    knownCaveats: [],
    explicitUnsupportedNodes: [],
    lastValidatedDatabaseVersion: update.sourceUpdatedAt || null,
    lastValidatedRulesVersion: support.rulesVersion || null,
    implementationPath: 'format-scope-excluded',
    commanderLegality: scope.commanderLegality,
    catalogMatched: true
  };
}

function rowFromUnimplementedCatalogCard(card) {
  const template = templateById.get(card.id) || null;
  const promotion = promotionById.get(card.id) || null;
  const compilerReady = template?.autoAccepted === true && template?.status === 'compiled' && template?.confidence === 'high';
  if (promotion) return {
    oracleId: card.oracleId || card.oracle_id || promotion.oracleId || null,
    oracleIdentity: oracleIdentity(card),
    cardId: card.id || oracleIdentity(card),
    catalogCardId: card.id || null,
    name: card.name || oracleIdentity(card),
    supportLevel: 'partial',
    strictEligible: false,
    classification: STEP45_TRIAGE_CATEGORY.CERTIFICATION,
    classificationReason: 'Exact high-confidence compiler behavior has been promoted into the authoritative runtime database, but card-specific behavioral/golden certification has not yet passed.',
    detectedMechanics: mechanicsOf(card),
    parserCompilerStatus: template?.status || 'compiled',
    parserCompilerConfidence: template?.confidence || 'high',
    declarativeScriptStatus: 'compiler-promoted-runtime-partial',
    customHookStatus: 'none', customHooks: [],
    behavioralTests: { count: 0, files: [], goldenCount: 0 },
    knownCaveats: ['Compiler-promoted runtime behavior is strict-ineligible until independent behavioral and golden certification passes.'],
    explicitUnsupportedNodes: [],
    lastValidatedDatabaseVersion: update.sourceUpdatedAt || null,
    lastValidatedRulesVersion: support.rulesVersion || null,
    implementationPath: 'compiler-promoted-runtime',
    catalogMatched: true
  };
  return {
    oracleId: card.oracleId || card.oracle_id || null,
    oracleIdentity: oracleIdentity(card),
    cardId: card.id || oracleIdentity(card),
    catalogCardId: card.id || null,
    name: card.name || oracleIdentity(card),
    supportLevel: 'partial',
    strictEligible: false,
    classification: STEP45_TRIAGE_CATEGORY.SCRIPT,
    classificationReason: compilerReady
      ? 'Production Oracle identity has an exact high-confidence compiler result, but that generated behavior is not yet promoted into the authoritative implementation registry and certified.'
      : 'Production Oracle identity is present in the complete catalog but has no registered machine-readable implementation/support record.',
    detectedMechanics: mechanicsOf(card),
    parserCompilerStatus: template?.status || 'not-run',
    parserCompilerConfidence: template?.confidence || 'none',
    declarativeScriptStatus: compilerReady ? 'compiler-output-unregistered' : 'absent',
    customHookStatus: 'none',
    customHooks: [],
    behavioralTests: { count: 0, files: [], goldenCount: 0 },
    knownCaveats: [
      'No implementation/support record is registered for this production-catalog Oracle identity.',
      ...(compilerReady ? ['Exact compiler output exists but is not yet runtime-authoritative or behaviorally certified.'] : [])
    ],
    explicitUnsupportedNodes: [],
    lastValidatedDatabaseVersion: update.sourceUpdatedAt || null,
    lastValidatedRulesVersion: support.rulesVersion || null,
    implementationPath: compilerReady ? 'compiler-promotion-candidate' : 'auto-template-candidate',
    catalogMatched: true
  };
}

const useProductionCatalog = catalog.complete === true && Array.isArray(catalog.cards) && catalog.cards.length > 0;
const matchedSupportCardIds = new Set();
let rows;
if (useProductionCatalog) {
  rows = catalog.cards.map(card => {
    const scope = classifyCatalogCardScope(card);
    if (!scope.inScope) return rowFromFormatExcludedCatalogCard(card);
    const oid = card.oracleId || card.oracle_id || null;
    const identity = oracleIdentity(card);
    const supportRow = (oid && supportByOracleId.get(oid)) || supportByIdentity.get(identity) || supportByName.get(norm(card.name));
    if (!supportRow) return rowFromUnimplementedCatalogCard(card);
    matchedSupportCardIds.add(supportRow.cardId);
    return rowFromSupport(supportRow, card);
  });
} else {
  rows = (support.cards||[]).map(row => rowFromSupport(row));
  for (const row of support.cards || []) matchedSupportCardIds.add(row.cardId);
}
rows.sort((a,b)=>String(a.oracleIdentity).localeCompare(String(b.oracleIdentity)) || String(a.cardId).localeCompare(String(b.cardId)));

const orphanImplementations = useProductionCatalog
  ? (support.cards || []).filter(row => !matchedSupportCardIds.has(row.cardId)).map(row => ({ cardId: row.cardId, name: row.name, oracleId: row.oracleId || null, oracleIdentity: row.oracleIdentity || null }))
  : [];
const byClass = rows.reduce((a,r)=>(a[r.classification]=(a[r.classification]||0)+1,a),{});
const declaredCount = Number(update.catalogCount || catalog.count || rows.length);
const payload = {
  schema:'mtg-commander-oracle-support-census', schemaVersion:2, generatedAt:new Date().toISOString(),
  rulesVersion:support.rulesVersion||null, databaseVersion:update.sourceUpdatedAt||null,
  catalog:{
    complete:update.catalogComplete===true,
    sourceType:update.sourceType||catalog.sourceType||null,
    declaredCount,
    reviewedRows:rows.length,
    productionUniverseEnumerated:useProductionCatalog,
    coverageCountMatchesDeclared:rows.length===declaredCount,
    orphanImplementationCount:orphanImplementations.length,
    orphanImplementations
  },
  summary:{
    totalReviewed:rows.length,
    inScopeReviewed:rows.filter(r=>r.classification!==STEP45_TRIAGE_CATEGORY.FORMAT_SCOPE).length,
    formatScopeExcluded:rows.filter(r=>r.classification===STEP45_TRIAGE_CATEGORY.FORMAT_SCOPE).length,
    strictEligible:rows.filter(r=>r.strictEligible).length,
    unclassified:rows.filter(r=>!r.classification).length,
    missingImplementationRecords:rows.filter(r=>r.classification===STEP45_TRIAGE_CATEGORY.SCRIPT && r.knownCaveats?.some(x=>/No implementation\/support record/i.test(x))).length,
    byClassification:byClass
  },
  cards:rows
};
const rel='src/data/generated/oracle-support-census.json';
if (CHECK) {
  const old=read(rel,null);
  if(!old || stable(old)!==stable(payload)) throw new Error('Oracle support census is stale; run npm run build:census.');
  if (payload.catalog.complete && (!payload.catalog.productionUniverseEnumerated || !payload.catalog.coverageCountMatchesDeclared)) throw new Error('Oracle support census does not enumerate the complete declared production catalog.');
  console.log(`Oracle support census current: ${rows.length} rows, ${payload.summary.strictEligible} strict eligible, ${payload.summary.missingImplementationRecords} missing implementation records.`);
} else {
  write(rel,payload);
  console.log(`Built Oracle support census: ${rows.length} rows; ${payload.summary.strictEligible} strict eligible; ${payload.summary.unclassified} unclassified; ${payload.summary.missingImplementationRecords} missing implementation records.`);
}
