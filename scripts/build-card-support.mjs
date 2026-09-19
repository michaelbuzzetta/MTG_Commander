import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_ONLY = process.argv.includes('--check');
const RULES_VERSION = 'mtg-cr-2026-08-07';
const SOURCE_CARDS = path.join(ROOT, 'src/data/source/cards.json');
const SOURCE_DECKS = path.join(ROOT, 'src/data/source/decks.json');
const CERTIFICATIONS = path.join(ROOT, 'src/data/support/certifications.json');
const GOLDEN_MANIFEST = path.join(ROOT, 'tests/golden/step35-golden-cards.json');
const SCRYFALL_SNAPSHOT = path.join(ROOT, 'user-deck-card-data.json');
const PRODUCTION_ORACLE_CATALOG = path.join(ROOT, '.cache', 'scryfall', 'card-catalog.json');
const OUTPUT_DIR = path.join(ROOT, 'src/data/generated');
const SUPPORT_FILE = path.join(OUTPUT_DIR, 'card-support.json');
const ORACLE_REGISTRY_FILE = path.join(OUTPUT_DIR, 'oracle-registry.json');
const DECK_READINESS_FILE = path.join(OUTPUT_DIR, 'deck-readiness.json');
const COVERAGE_FILE = path.join(OUTPUT_DIR, 'coverage-report.json');
const LEGACY_FILE = path.join(OUTPUT_DIR, 'legacy-handler-removal.json');

const PATHS = Object.freeze({
  AUTO_TEMPLATE: 'auto-template-candidate',
  DECLARATIVE: 'declarative-scripted',
  COMPLEX: 'complex-scripted',
  CUSTOM_HOOK: 'custom-hook-required',
  NON_DIGITAL: 'non-digital-unsupported'
});
const STATUS = Object.freeze({ FULL: 'fully_supported', PARTIAL: 'partially_supported', UNSUPPORTED: 'unsupported' });

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) {
    if (fallback !== null) return fallback;
    throw new Error(`Could not read ${path.relative(ROOT, file)}: ${error.message}`);
  }
}
function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temp, file);
}
function normalizeName(value = '') {
  return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[’‘]/g, "'").replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
}
function fingerprint(value = '') { return crypto.createHash('sha256').update(String(value).replace(/\r\n/g, '\n').trim()).digest('hex').slice(0, 16); }
function pct(value, total) { return total ? Number(((value / total) * 100).toFixed(2)) : 0; }
function countBy(rows, field) {
  const out = {};
  for (const row of rows) out[row[field]] = (out[row[field]] || 0) + 1;
  return Object.fromEntries(Object.entries(out).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function buildScryfallIndex() {
  const production = readJson(PRODUCTION_ORACLE_CATALOG, { cards: [], complete: false });
  const snapshot = readJson(SCRYFALL_SNAPSHOT, { cards: [] });
  const primary = production?.complete === true || !(snapshot?.cards?.length) ? production : snapshot;
  const byId = new Map();
  const byName = new Map();
  for (const raw of primary.cards || []) {
    const ids = [raw?.id, raw?.scryfallId, raw?.scryfall_id].filter(Boolean);
    for (const id of ids) if (!byId.has(id)) byId.set(id, raw);
    const names = [raw?.name, ...(raw?.aliases || []), ...((raw?.cardFaces || raw?.card_faces || []).map(face => face?.name))].filter(Boolean);
    for (const name of names) {
      const key = normalizeName(name);
      if (key && !byName.has(key)) byName.set(key, raw);
    }
  }
  return {
    byId,
    byName,
    sourceCount: (primary.cards || []).length,
    capturedAt: primary.generatedAt || primary.capturedAt || null,
    productionComplete: production.complete === true,
    sourceType: primary === production ? production.sourceType || 'scryfall-catalog' : 'legacy-user-snapshot'
  };
}

function resolveOracleMetadata(card, index) {
  const raw = (card.scryfallId && index.byId.get(card.scryfallId)) || index.byName.get(normalizeName(card.name));
  const oracleId = card.oracleId || raw?.oracleId || raw?.oracle_id || null;
  const scryfallId = card.scryfallId || raw?.scryfallId || raw?.scryfall_id || (String(raw?.id || '').startsWith('catalog-') ? null : raw?.id) || null;
  return {
    oracleId,
    scryfallId,
    oracleIdentity: oracleId ? `oracle:${oracleId}` : `local-name:${normalizeName(card.name || card.id)}`,
    identitySource: oracleId ? (card.oracleId ? 'card-oracle-id' : index.productionComplete ? 'production-catalog-oracle-id' : 'cached-scryfall-oracle-id') : 'local-name-fallback',
    authoritativeCatalog: index.productionComplete === true,
    authoritativeOracleText: index.productionComplete ? (raw?.oracleText ?? raw?.oracle_text ?? null) : null
  };
}

function scanTests(cards) {
  const dir = path.join(ROOT, 'tests');
  const testFiles = fs.readdirSync(dir).filter(file => file.endsWith('.test.js') && file !== 'step17-card-library-support.test.js').sort();
  const content = testFiles.map(file => [file, fs.readFileSync(path.join(dir, file), 'utf8')]);
  const result = {};
  for (const [cardId] of Object.entries(cards)) {
    const matches = [];
    for (const [file, text] of content) {
      if (text.includes(`'${cardId}'`) || text.includes(`\"${cardId}\"`) || text.includes('`' + cardId + '`')) matches.push(file);
    }
    result[cardId] = matches;
  }
  return result;
}

function recursiveHooks(value, found = new Map()) {
  if (Array.isArray(value)) { for (const child of value) recursiveHooks(child, found); return found; }
  if (!value || typeof value !== 'object') return found;
  const op = value.op || value.primitive || value.type;
  if (op === 'customHook') {
    const id = value.hookId || value.hook || 'unknown';
    found.set(id, String(value.version || 'unversioned'));
  }
  for (const child of Object.values(value)) recursiveHooks(child, found);
  return found;
}

const SIMPLE_ABILITY_TYPES = new Set(['mana', 'activated', 'triggered', 'static', 'replacement']);
const SIMPLE_EFFECT_TYPES = new Set(['draw','damage','gainLife','loseLife','destroy','exile','returnToHand','counterSpell','pump','proliferate','searchBasic','cultivate','sequence','replaceWithToken','returnAttackers']);

function implementationPath(card) {
  if (card.supported === false) return PATHS.NON_DIGITAL;
  const script = card.script || card.cardScript;
  const hooks = recursiveHooks(script);
  if (hooks.size) return PATHS.CUSTOM_HOOK;
  if (script) {
    const text = JSON.stringify(script);
    return /"op":"(?:if|forEach|repeat|customHook)"/.test(text) || (script.abilities || []).length > 2 ? PATHS.COMPLEX : PATHS.DECLARATIVE;
  }
  const abilities = card.abilities || [];
  const effects = card.spellEffects || [];
  const simple = abilities.every(item => SIMPLE_ABILITY_TYPES.has(item?.type)) && effects.every(item => SIMPLE_EFFECT_TYPES.has(item?.type));
  if (abilities.length || effects.length || (card.keywords || []).length || /\bBasic Land\b/i.test(card.typeLine || '')) {
    return simple ? PATHS.DECLARATIVE : PATHS.COMPLEX;
  }
  return PATHS.AUTO_TEMPLATE;
}

function hasExecutableDefinition(card) {
  if (card.script || card.cardScript) return true;
  if ((card.abilities || []).length || (card.spellEffects || []).length || (card.keywords || []).length) return true;
  // Vanilla creatures/permanents are executable from base characteristics even
  // though their ability lists are intentionally empty.
  if (/\bCreature\b/i.test(card.typeLine || '') && Number.isFinite(Number(card.power)) && Number.isFinite(Number(card.toughness))) return true;
  return false;
}

function supportRecord(card, oracle, tests, certification, goldenContract = null, goldenManifest = null) {
  const pathKind = implementationPath(card);
  const hooks = [...recursiveHooks(card.script || card.cardScript).entries()].map(([id, version]) => ({ id, version }));
  const executable = hasExecutableDefinition(card);
  const certified = !!certification;
  const implementationOracleTextFingerprint = fingerprint(card.oracleText || '');
  const authoritativeOracleTextFingerprint = oracle.authoritativeCatalog && oracle.authoritativeOracleText != null ? fingerprint(oracle.authoritativeOracleText) : null;
  const oracleTextCurrent = !authoritativeOracleTextFingerprint || implementationOracleTextFingerprint === authoritativeOracleTextFingerprint;
  const expectedFingerprint = authoritativeOracleTextFingerprint || implementationOracleTextFingerprint;
  const goldenCases = Array.isArray(goldenContract?.cases) ? goldenContract.cases : [];
  const goldenValid = !!goldenContract
    && goldenCases.length > 0
    && goldenContract.oracleTextFingerprint === expectedFingerprint
    && goldenContract.supportRulesVersion === RULES_VERSION;
  const caveats = [];
  let supportStatus = STATUS.PARTIAL;
  if (card.supported === false || pathKind === PATHS.NON_DIGITAL) {
    supportStatus = STATUS.UNSUPPORTED;
    caveats.push(card.unsupportedReason || 'Card is explicitly outside the currently supported digital rules surface.');
  } else if (certified && executable && tests.length > 0 && hooks.length === 0 && goldenValid && oracleTextCurrent) {
    supportStatus = STATUS.FULL;
  } else {
    if (!oracleTextCurrent) caveats.push('Authoritative production Oracle text differs from the local implementation snapshot; certification is invalid until the implementation and golden behavior contract are reviewed against current Oracle text.');
    if (!executable) caveats.push('No complete machine-readable behavior is registered yet; this card is queued for template compilation or manual scripting.');
    if (tests.length === 0) caveats.push('No card-specific behavioral regression test currently certifies this implementation.');
    if (!certified) caveats.push('Step 17 has not yet granted full-support certification for every material behavior of this card.');
    if (certified && !goldenContract) caveats.push('Step 35 golden behavior contract is missing; full support is gated on a per-card golden fixture.');
    else if (certified && goldenCases.length === 0) caveats.push('Step 35 golden behavior contract has no executable cases.');
    else if (certified && goldenContract?.oracleTextFingerprint !== expectedFingerprint) caveats.push('Step 35 golden behavior contract is stale because Oracle text changed and requires review.');
    else if (certified && goldenContract?.supportRulesVersion !== RULES_VERSION) caveats.push('Step 35 golden behavior contract targets a different support rules version and requires review.');
    if (hooks.length) caveats.push('One or more custom hooks require explicit registration/versioned conformance coverage.');
  }

  return {
    cardId: card.id,
    name: card.name,
    oracleId: oracle.oracleId,
    scryfallId: oracle.scryfallId,
    oracleIdentity: oracle.oracleIdentity,
    identitySource: oracle.identitySource,
    implementationPath: pathKind,
    supportStatus,
    strictEligible: supportStatus === STATUS.FULL && caveats.length === 0,
    caveats,
    identityWarnings: oracle.oracleId ? [] : ['Authoritative Oracle ID is not cached for this local definition; a stable normalized-name identity is used until the next metadata refresh.'],
    testCount: tests.length,
    testFiles: tests,
    goldenTestCount: goldenCases.length,
    goldenContractVersion: goldenManifest?.contractVersion || null,
    goldenFixtureFile: goldenContract ? 'tests/golden/step35-golden-cards.json' : null,
    goldenOracleTextFingerprint: goldenContract?.oracleTextFingerprint || null,
    implementationOracleTextFingerprint,
    authoritativeOracleTextFingerprint,
    oracleTextCurrent,
    requiredCustomHooks: hooks,
    certification: certification ? { ...certification } : null,
    lastValidatedRulesVersion: RULES_VERSION
  };
}

function buildOracleRegistry(cards, supportRows) {
  const byCard = Object.fromEntries(supportRows.map(row => [row.cardId, row]));
  const baseGroups = new Map();
  for (const card of Object.values(cards)) {
    const row = byCard[card.id];
    if (!baseGroups.has(row.oracleIdentity)) baseGroups.set(row.oracleIdentity, []);
    baseGroups.get(row.oracleIdentity).push(card);
  }
  const implementations = [];
  const printingToImplementation = {};
  for (const [baseIdentity, group] of baseGroups) {
    const byText = new Map();
    for (const card of group) {
      const fp = fingerprint(card.oracleText || '');
      if (!byText.has(fp)) byText.set(fp, []);
      byText.get(fp).push(card);
    }
    const oracleId = byCard[group[0].id].oracleId;
    const divergent = !!oracleId && byText.size > 1;
    for (const [fp, variants] of byText) {
      const implementationId = divergent ? `${baseIdentity}@${fp.slice(0, 8)}` : baseIdentity;
      const sorted = [...variants].sort((a, b) => {
        const ar = byCard[a.id], br = byCard[b.id];
        const rank = row => row.supportStatus === STATUS.FULL ? 3 : row.supportStatus === STATUS.PARTIAL ? 2 : 1;
        return rank(br) - rank(ar) || br.testCount - ar.testCount || String(a.id).localeCompare(String(b.id));
      });
      const canonical = sorted[0];
      implementations.push({
        implementationId,
        oracleId,
        oracleTextFingerprint: fp,
        canonicalCardId: canonical.id,
        name: canonical.name,
        cardIds: variants.map(card => card.id).sort(),
        printings: variants.map(card => ({ cardId: card.id, scryfallId: byCard[card.id].scryfallId || card.scryfallId || null, set: card.set || null, collectorNumber: card.collectorNumber || null })).sort((a,b)=>a.cardId.localeCompare(b.cardId))
      });
      for (const card of variants) printingToImplementation[card.id] = implementationId;
    }
  }
  return { schemaVersion: 1, rulesVersion: RULES_VERSION, implementationCount: implementations.length, implementations: implementations.sort((a,b)=>a.implementationId.localeCompare(b.implementationId)), printingToImplementation };
}

function buildDeckReadiness(decks, cards, rowsById) {
  return decks.map(deck => {
    const statusCounts = { fully_supported: 0, partially_supported: 0, unsupported: 0, missing: 0 };
    const blockers = [];
    for (const entry of deck.cards || []) {
      const quantity = Number(entry.quantity || 1);
      const card = cards[entry.id];
      const row = rowsById[entry.id];
      if (!card || !row) {
        statusCounts.missing += quantity;
        blockers.push({ cardId: entry.id, reason: 'Missing card/support record.' });
        continue;
      }
      statusCounts[row.supportStatus] += quantity;
      if (!row.strictEligible) blockers.push({ cardId: entry.id, name: card.name, status: row.supportStatus, caveats: row.caveats });
    }
    const cardCount = (deck.cards || []).reduce((sum, entry) => sum + Number(entry.quantity || 1), 0);
    return {
      deckId: deck.id,
      name: deck.name,
      cardCount,
      uniqueCardDefinitions: new Set((deck.cards || []).map(entry => entry.id)).size,
      mappedSupportRecords: (deck.cards || []).filter(entry => rowsById[entry.id]).length,
      statusCounts,
      strictReady: blockers.length === 0,
      silentUnsupportedCount: 0,
      blockerCount: blockers.length,
      blockerCardIds: blockers.map(row => row.cardId)
    };
  });
}

function scanLegacyHandlers(cards) {
  const candidates = new Map();
  const add = (cardId, reference, reason) => {
    if (!cards[cardId]) return;
    if (!candidates.has(cardId)) candidates.set(cardId, { cardId, name: cards[cardId].name, status: 'review-required', reasons: new Set(), references: [] });
    const row = candidates.get(cardId);
    row.reasons.add(reason);
    row.references.push(reference);
  };

  // 1) Literal card-id comparisons in production rules code are the clearest
  // one-off compatibility handlers.
  const files = [];
  const walk = dir => {
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name);
      const stat = fs.statSync(file);
      if (stat.isDirectory()) {
        if (name === 'data' || (name === 'support' && file.includes(`${path.sep}cards${path.sep}`))) continue;
        walk(file);
      } else if (/\.(?:js|jsx)$/.test(name)) files.push(file);
    }
  };
  walk(path.join(ROOT, 'src'));
  const directPattern = /(?:\bcardId|\.cardId)\s*(?:===|==|!==|!=)\s*['"`]([a-z0-9][a-z0-9-]{2,})['"`]|['"`]([a-z0-9][a-z0-9-]{2,})['"`]\s*(?:===|==|!==|!=)\s*(?:\bcardId|[^\n;]*\.cardId)/gi;
  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const match of line.matchAll(directPattern)) {
        const cardId = match[1] || match[2];
        add(cardId, { file: path.relative(ROOT, file).replaceAll('\\','/'), line: index + 1, snippet: line.trim().slice(0, 220) }, 'direct-card-id-condition');
      }
    });
  }

  // 2) A legacy EffectEngine case used by exactly one card definition is a
  // strong migration candidate even when the case name is not the card id.
  const effectUsers = new Map();
  const visitEffect = (value, cardId) => {
    if (Array.isArray(value)) { for (const child of value) visitEffect(child, cardId); return; }
    if (!value || typeof value !== 'object') return;
    if (typeof value.type === 'string') {
      if (!effectUsers.has(value.type)) effectUsers.set(value.type, new Set());
      effectUsers.get(value.type).add(cardId);
    }
    for (const child of Object.values(value)) visitEffect(child, cardId);
  };
  for (const card of Object.values(cards)) {
    for (const ability of card.abilities || []) visitEffect(ability.effect, card.id);
    for (const effect of card.spellEffects || []) visitEffect(effect, card.id);
  }
  const effectFile = path.join(ROOT, 'src/engine/EffectEngine.js');
  const effectLines = fs.readFileSync(effectFile, 'utf8').split(/\r?\n/);
  effectLines.forEach((line, index) => {
    const match = line.match(/\bcase\s+['"`]([^'"`]+)['"`]\s*:/);
    if (!match) return;
    const users = effectUsers.get(match[1]);
    if (!users || users.size !== 1) return;
    const cardId = [...users][0];
    add(cardId, { file: 'src/engine/EffectEngine.js', line: index + 1, effectType: match[1], snippet: line.trim() }, 'single-card-effect-handler');
  });

  const rows = [...candidates.values()].map(row => ({ ...row, reasons: [...row.reasons].sort(), references: row.references }));
  rows.sort((a,b)=>a.cardId.localeCompare(b.cardId));
  return {
    schemaVersion: 1,
    generatedForRulesVersion: RULES_VERSION,
    policy: 'Review direct card-id rules branches and single-card EffectEngine cases. Remove a handler only after an equivalent Step 16 script/shared mechanic is behaviorally certified.',
    candidateCardCount: rows.length,
    candidates: rows
  };
}

function validateOutputs(cards, decks, supportPayload, registry, readiness, coverage) {
  const errors = [];
  const rows = supportPayload.cards || [];
  const byId = Object.fromEntries(rows.map(row => [row.cardId, row]));
  const cardIds = Object.keys(cards);
  if (rows.length !== cardIds.length) errors.push(`Support database has ${rows.length} rows for ${cardIds.length} cards.`);
  for (const id of cardIds) {
    const row = byId[id];
    if (!row) { errors.push(`Missing support row for ${id}.`); continue; }
    if (!registry.printingToImplementation[id]) errors.push(`Missing Oracle implementation mapping for ${id}.`);
    if (row.supportStatus === STATUS.FULL) {
      if (!(row.testCount > 0)) errors.push(`Fully supported card ${id} has no behavioral test.`);
      if (!(row.goldenTestCount > 0)) errors.push(`Fully supported card ${id} has no Step 35 golden behavior test.`);
      if ((row.caveats || []).length) errors.push(`Fully supported card ${id} has caveats.`);
      if (!row.strictEligible) errors.push(`Fully supported card ${id} is not strict eligible.`);
    }
  }
  if (readiness.length !== decks.length) errors.push('Deck readiness output does not cover every current deck.');
  for (const row of readiness) {
    if (row.cardCount !== 100) errors.push(`Deck ${row.deckId} readiness count is ${row.cardCount}, expected 100.`);
    if (row.mappedSupportRecords !== decks.find(deck => deck.id === row.deckId)?.cards.length) errors.push(`Deck ${row.deckId} has support-record gaps.`);
    if (row.silentUnsupportedCount !== 0) errors.push(`Deck ${row.deckId} has silent unsupported cards.`);
  }
  const sum = Object.values(coverage.statusCounts || {}).reduce((a,b)=>a+b,0);
  if (sum !== cardIds.length) errors.push(`Coverage status total ${sum} does not equal card count ${cardIds.length}.`);
  if (errors.length) throw new Error(`Step 17 support validation failed:\n- ${errors.join('\n- ')}`);
}

function main() {
  const cards = readJson(SOURCE_CARDS);
  const decks = readJson(SOURCE_DECKS);
  const certifications = readJson(CERTIFICATIONS, { cards: {} }).cards || {};
  const goldenManifest = readJson(GOLDEN_MANIFEST, { cards: {}, contractVersion: null });
  const goldenContracts = goldenManifest.cards || {};
  const scryfall = buildScryfallIndex();
  const tests = scanTests(cards);
  const rows = Object.values(cards).map(card => supportRecord(
    card,
    resolveOracleMetadata(card, scryfall),
    tests[card.id] || [],
    certifications[card.id] || null,
    goldenContracts[card.id] || null,
    goldenManifest
  ));
  rows.sort((a,b)=>a.cardId.localeCompare(b.cardId));
  const byId = Object.fromEntries(rows.map(row => [row.cardId, row]));
  const registry = buildOracleRegistry(cards, rows);
  const readiness = buildDeckReadiness(decks, cards, byId);
  const legacy = scanLegacyHandlers(cards);
  const statusCounts = countBy(rows, 'supportStatus');
  const pathCounts = countBy(rows, 'implementationPath');
  const trueOracleIds = rows.filter(row => row.oracleId).length;
  const coverage = {
    schemaVersion: 1,
    rulesVersion: RULES_VERSION,
    generatedAt: new Date().toISOString(),
    cardCount: rows.length,
    oracleImplementationCount: registry.implementationCount,
    identityCoverage: {
      cardsWithOracleId: trueOracleIds,
      cardsUsingLocalNameFallback: rows.length - trueOracleIds,
      oracleIdPercent: pct(trueOracleIds, rows.length),
      cachedScryfallSnapshotCards: scryfall.sourceCount,
      cachedScryfallCapturedAt: scryfall.capturedAt
    },
    statusCounts,
    statusPercent: Object.fromEntries(Object.entries(statusCounts).map(([key,value])=>[key,pct(value,rows.length)])),
    implementationPathCounts: pathCounts,
    cardsWithCardSpecificTests: rows.filter(row => row.testCount > 0).length,
    cardsWithGoldenBehaviorTests: rows.filter(row => row.goldenTestCount > 0).length,
    goldenBehaviorCaseCount: rows.reduce((sum, row) => sum + Number(row.goldenTestCount || 0), 0),
    cardsWithFullCertification: rows.filter(row => row.supportStatus === STATUS.FULL).length,
    currentDecks: {
      count: readiness.length,
      allCardsMapped: readiness.every(row => row.mappedSupportRecords === decks.find(deck => deck.id === row.deckId)?.cards.length),
      silentlyUnsupportedCards: readiness.reduce((sum,row)=>sum+row.silentUnsupportedCount,0),
      strictReadyDecks: readiness.filter(row=>row.strictReady).map(row=>row.deckId)
    },
    metricPolicy: 'Coverage is computed exclusively from card-support records. Full support requires explicit Step 17 certification, at least one repository behavioral test, at least one current Step 35 golden behavior contract locked to Oracle text/rules version, executable machine-readable behavior, and zero tracked caveats.'
  };
  const supportPayload = { schemaVersion: 1, rulesVersion: RULES_VERSION, generatedAt: coverage.generatedAt, cards: rows };
  validateOutputs(cards, decks, supportPayload, registry, readiness, coverage);

  if (CHECK_ONLY) {
    // All committed/generated Step 17 artifacts must match the current source
    // state. generatedAt is intentionally ignored because it is diagnostic, not
    // semantic support state.
    const withoutGeneratedAt = payload => {
      if (payload == null || typeof payload !== 'object') return payload;
      if (Array.isArray(payload)) return payload.map(withoutGeneratedAt);
      return Object.fromEntries(Object.entries(payload)
        .filter(([key]) => key !== 'generatedAt')
        .map(([key, value]) => [key, withoutGeneratedAt(value)]));
    };
    const expectedArtifacts = [
      [SUPPORT_FILE, supportPayload, 'card-support.json'],
      [ORACLE_REGISTRY_FILE, registry, 'oracle-registry.json'],
      [DECK_READINESS_FILE, { schemaVersion: 1, rulesVersion: RULES_VERSION, generatedAt: coverage.generatedAt, decks: readiness }, 'deck-readiness.json'],
      [COVERAGE_FILE, coverage, 'coverage-report.json'],
      [LEGACY_FILE, legacy, 'legacy-handler-removal.json']
    ];
    for (const [file, expected, label] of expectedArtifacts) {
      const existing = readJson(file, null);
      if (!existing) throw new Error(`Generated Step 17 artifact ${label} is missing; run npm run build-support.`);
      if (JSON.stringify(withoutGeneratedAt(existing)) !== JSON.stringify(withoutGeneratedAt(expected))) {
        throw new Error(`Generated ${label} is stale; run npm run build-support.`);
      }
    }
    console.log(`Validated Step 17 support data for ${rows.length} cards / ${decks.length} decks (${statusCounts.fully_supported || 0} fully supported, ${statusCounts.partially_supported || 0} partial, ${statusCounts.unsupported || 0} unsupported).`);
    return;
  }

  writeJsonAtomic(SUPPORT_FILE, supportPayload);
  writeJsonAtomic(ORACLE_REGISTRY_FILE, registry);
  writeJsonAtomic(DECK_READINESS_FILE, { schemaVersion: 1, rulesVersion: RULES_VERSION, generatedAt: coverage.generatedAt, decks: readiness });
  writeJsonAtomic(COVERAGE_FILE, coverage);
  writeJsonAtomic(LEGACY_FILE, legacy);
  console.log(`Built Step 17 support data for ${rows.length} cards / ${decks.length} decks.`);
  console.log(`Coverage: ${statusCounts.fully_supported || 0} fully supported, ${statusCounts.partially_supported || 0} partial, ${statusCounts.unsupported || 0} unsupported; ${trueOracleIds} cards have cached Oracle IDs.`);
}

main();
