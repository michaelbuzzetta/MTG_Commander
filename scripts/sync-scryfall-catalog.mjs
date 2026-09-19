import crypto from 'node:crypto';
import fs from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGunzip, gunzipSync } from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = path.join(ROOT, '.cache', 'scryfall');
const CATALOG_FILE = path.join(CACHE_DIR, 'card-catalog.json');
const PRINTING_FILE = path.join(CACHE_DIR, 'printing-catalog.json');
const META_FILE = path.join(CACHE_DIR, 'card-catalog-meta.json');
const LOCAL_CARDS = path.join(ROOT, 'src', 'data', 'generated', 'cards.json');
const BULK_INDEX_URL = 'https://api.scryfall.com/bulk-data';
const ORACLE_BULK_TYPE = 'oracle_cards';
const PRINTING_BULK_TYPE = 'default_cards';
const SCHEMA_VERSION = 3;
const MIN_COMPLETE_CARD_COUNT = 10_000;
const RAW_ARGS = process.argv.slice(2);
const FORCE = RAW_ARGS.includes('--force');
const STRICT = RAW_ARGS.includes('--strict');
const HEADERS = Object.freeze({
  'User-Agent': 'MTGAITrainer/4.0 (+local educational Commander trainer)',
  Accept: 'application/json;q=0.9,*/*;q=0.8'
});

function argValue(name) {
  const prefix = `${name}=`;
  return RAW_ARGS.find(arg => arg.startsWith(prefix))?.slice(prefix.length) || null;
}

const ORACLE_INPUT = argValue('--oracle-file');
const PRINTING_INPUT = argValue('--printing-file');
const SOURCE_UPDATED_AT = argValue('--source-updated-at');

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function jsonBytes(value, pretty = false) {
  return Buffer.from(`${JSON.stringify(value, null, pretty ? 2 : 0)}\n`);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fileSha256(file) {
  try { return sha256(fs.readFileSync(file)); } catch { return null; }
}

function writeJsonAtomic(file, value, pretty = false) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, jsonBytes(value, pretty));
  fs.renameSync(temp, file);
}

function writeCatalogBundle({ oracle, prints, meta }) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const tx = `${process.pid}-${Date.now()}`;
  const entries = [
    { target: CATALOG_FILE, bytes: jsonBytes(oracle), backup: `${CATALOG_FILE}.bak-${tx}` },
    { target: PRINTING_FILE, bytes: jsonBytes(prints), backup: `${PRINTING_FILE}.bak-${tx}` },
    { target: META_FILE, bytes: jsonBytes(meta, true), backup: `${META_FILE}.bak-${tx}` }
  ];
  const staged = [];
  try {
    for (const entry of entries) {
      entry.temp = `${entry.target}.tmp-${tx}`;
      fs.writeFileSync(entry.temp, entry.bytes);
      // Verify staged bytes before touching the last-known-good files.
      if (sha256(fs.readFileSync(entry.temp)) !== sha256(entry.bytes)) throw new Error(`Staged catalog verification failed for ${path.basename(entry.target)}.`);
      staged.push(entry.temp);
    }
    for (const entry of entries) if (fs.existsSync(entry.target)) fs.copyFileSync(entry.target, entry.backup);
    for (const entry of entries) fs.renameSync(entry.temp, entry.target);
    for (const entry of entries) if (fs.existsSync(entry.backup)) fs.rmSync(entry.backup, { force: true });
  } catch (error) {
    for (const entry of entries) {
      try { if (entry.temp && fs.existsSync(entry.temp)) fs.rmSync(entry.temp, { force: true }); } catch {}
      try { if (fs.existsSync(entry.backup)) fs.copyFileSync(entry.backup, entry.target); } catch {}
      try { if (fs.existsSync(entry.backup)) fs.rmSync(entry.backup, { force: true }); } catch {}
    }
    throw error;
  }
}

function sha256FileStreaming(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    while (true) {
      const count = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!count) break;
      hash.update(buffer.subarray(0, count));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function writeLargeCatalogJson(file, catalog) {
  const { cards = [], ...header } = catalog;
  const fd = fs.openSync(file, 'w');
  try {
    const prefix = JSON.stringify(header);
    fs.writeSync(fd, `${prefix.slice(0, -1)},\"cards\":[`);
    let chunk = '';
    for (let i = 0; i < cards.length; i++) {
      chunk += `${i ? ',' : ''}${JSON.stringify(cards[i])}`;
      if (chunk.length >= 4 * 1024 * 1024) {
        fs.writeSync(fd, chunk);
        chunk = '';
      }
    }
    if (chunk) fs.writeSync(fd, chunk);
    fs.writeSync(fd, ']}\n');
  } finally {
    fs.closeSync(fd);
  }
}

function writeProductionCatalogBundle({ oracle, prints, metaBase }) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const tx = `${process.pid}-${Date.now()}`;
  const oracleTemp = `${CATALOG_FILE}.tmp-${tx}`;
  const printingTemp = `${PRINTING_FILE}.tmp-${tx}`;
  const metaTemp = `${META_FILE}.tmp-${tx}`;
  const entries = [
    { target: CATALOG_FILE, temp: oracleTemp, backup: `${CATALOG_FILE}.bak-${tx}` },
    { target: PRINTING_FILE, temp: printingTemp, backup: `${PRINTING_FILE}.bak-${tx}` },
    { target: META_FILE, temp: metaTemp, backup: `${META_FILE}.bak-${tx}` }
  ];
  try {
    writeLargeCatalogJson(oracleTemp, oracle);
    const oracleCatalogSha256 = sha256FileStreaming(oracleTemp);
    writeLargeCatalogJson(printingTemp, prints);
    const printingCatalogSha256 = sha256FileStreaming(printingTemp);
    const meta = { ...metaBase, oracleCatalogSha256, printingCatalogSha256 };
    fs.writeFileSync(metaTemp, `${JSON.stringify(meta, null, 2)}\n`);

    // All candidates are complete and hashed before replacing the last-known-good bundle.
    for (const entry of entries) if (fs.existsSync(entry.target)) fs.copyFileSync(entry.target, entry.backup);
    for (const entry of entries) fs.renameSync(entry.temp, entry.target);
    for (const entry of entries) if (fs.existsSync(entry.backup)) fs.rmSync(entry.backup, { force: true });
    return { meta, oracleCatalogSha256, printingCatalogSha256 };
  } catch (error) {
    for (const entry of entries) {
      try { if (fs.existsSync(entry.temp)) fs.rmSync(entry.temp, { force: true }); } catch {}
      try { if (fs.existsSync(entry.backup)) fs.copyFileSync(entry.backup, entry.target); } catch {}
      try { if (fs.existsSync(entry.backup)) fs.rmSync(entry.backup, { force: true }); } catch {}
    }
    throw error;
  }
}

function finiteNumber(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function faceText(raw) { return Array.isArray(raw.card_faces) && raw.card_faces.length ? raw.card_faces.map(f => f.oracle_text || '').filter(Boolean).join('\n//\n') : raw.oracle_text || ''; }
function faceImages(raw) { const face = raw.card_faces?.find(x => x?.image_uris) || raw.card_faces?.[0] || {}; const u = raw.image_uris || face.image_uris || {}; return { image: u.normal || u.large || u.small || '', imageSmall: u.small || u.normal || '', artCrop: u.art_crop || '' }; }
function normalizeFace(face = {}) { const u = face.image_uris || {}; return { name: face.name || '', manaCost: face.mana_cost || '', typeLine: face.type_line || '', oracleText: face.oracle_text || '', power: finiteNumber(face.power), toughness: finiteNumber(face.toughness), loyalty: finiteNumber(face.loyalty), defense: finiteNumber(face.defense), colors: Array.isArray(face.colors) ? face.colors : [], image: u.normal || u.large || u.small || '', imageSmall: u.small || u.normal || '', artCrop: u.art_crop || '' }; }
function normalizeCommon(raw) { const images = faceImages(raw); const faces = Array.isArray(raw.card_faces) ? raw.card_faces.map(normalizeFace) : []; const first = faces[0] || {}; return { name: raw.name || '', aliases: [...new Set([raw.name, ...faces.map(f => f.name)].filter(Boolean))], layout: raw.layout || 'normal', typeLine: raw.type_line || first.typeLine || '', manaCost: raw.mana_cost || first.manaCost || '', manaValue: finiteNumber(raw.cmc) ?? 0, power: finiteNumber(raw.power) ?? first.power ?? null, toughness: finiteNumber(raw.toughness) ?? first.toughness ?? null, loyalty: finiteNumber(raw.loyalty) ?? first.loyalty ?? null, defense: finiteNumber(raw.defense) ?? first.defense ?? null, colors: Array.isArray(raw.colors) ? raw.colors : (first.colors || []), colorIdentity: Array.isArray(raw.color_identity) ? raw.color_identity : [], keywords: [...new Set((raw.keywords || []).map(v => String(v).toLowerCase()))], producedMana: Array.isArray(raw.produced_mana) ? raw.produced_mana : [], oracleText: faceText(raw), legalities: raw.legalities || {}, games: Array.isArray(raw.games) ? raw.games : [], reserved: !!raw.reserved, cardFaces: faces, ...images, scryfallId: raw.id || null, oracleId: raw.oracle_id || null }; }
function normalizeOracleCard(raw) { if (!raw?.name) return null; const c = normalizeCommon(raw); const stable = raw.oracle_id || raw.id; return { id: `catalog-${stable}`, ...c, set: raw.set || '', setName: raw.set_name || '', collectorNumber: raw.collector_number || '', rarity: raw.rarity || '', edhrecRank: finiteNumber(raw.edhrec_rank), pennyRank: finiteNumber(raw.penny_rank), catalogCard: true, supported: false, source: 'Scryfall oracle_cards bulk catalog' }; }
function normalizePrinting(raw) {
  if (!raw?.id || !raw?.name) return null;
  const images = faceImages(raw);
  return {
    id: raw.id,
    scryfallId: raw.id,
    oracleId: raw.oracle_id || null,
    name: raw.name || '',
    layout: raw.layout || 'normal',
    set: raw.set || '',
    setName: raw.set_name || '',
    collectorNumber: raw.collector_number || '',
    rarity: raw.rarity || '',
    releasedAt: raw.released_at || null,
    lang: raw.lang || 'en',
    digital: !!raw.digital,
    promo: !!raw.promo,
    reprint: !!raw.reprint,
    finishes: raw.finishes || [],
    frame: raw.frame || null,
    fullArt: !!raw.full_art,
    textless: !!raw.textless,
    ...images,
    source: 'Scryfall default_cards printing catalog'
  };
}

function seedFromLocal(previousMeta = {}) {
  const local = readJson(LOCAL_CARDS, {});
  const cards = Object.values(local).map(card => ({ ...card, catalogCard: false, source: card.source || 'Local trainer database' }));
  const now = new Date().toISOString();
  const oracle = { schemaVersion: SCHEMA_VERSION, source: 'local-fallback', sourceType: 'trainer_seed', sourceUpdatedAt: null, generatedAt: now, complete: false, count: cards.length, cards };
  const prints = { schemaVersion: SCHEMA_VERSION, source: 'local-fallback', sourceType: 'trainer_seed_printings', sourceUpdatedAt: null, generatedAt: now, complete: false, count: cards.length, cards: cards.map(c => ({ id: c.scryfallId || `local-${c.id}`, oracleId: c.oracleId || null, scryfallId: c.scryfallId || null, name: c.name, set: c.set || '', setName: c.setName || '', collectorNumber: c.collectorNumber || '', lang: 'en', digital: false, source: 'Local trainer database' })) };
  const oracleBytes = jsonBytes(oracle);
  const printingBytes = jsonBytes(prints);
  const meta = {
    ...previousMeta,
    schemaVersion: SCHEMA_VERSION,
    status: 'offline-fallback',
    complete: false,
    sourceType: 'trainer_seed',
    sourceUpdatedAt: null,
    oracleSourceUpdatedAt: null,
    printingSourceUpdatedAt: null,
    lastCheckedAt: now,
    oracleCount: cards.length,
    printingCount: cards.length,
    oracleCatalogSha256: sha256(oracleBytes),
    printingCatalogSha256: sha256(printingBytes)
  };
  writeCatalogBundle({ oracle, prints, meta });
  return { oracle, prints, meta };
}

async function fetchJson(url, timeoutMs) {
  const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${url}`);
  return r.json();
}

export function parseBulkBuffer(buffer, url = '') {
  let bytes = Buffer.from(buffer);
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);
  const text = bytes.toString('utf8').trim();
  if (!text) return [];
  if (text.startsWith('[')) return JSON.parse(text);
  try { const parsed = JSON.parse(text); if (Array.isArray(parsed)) return parsed; } catch {}
  if (/\.jsonl(?:\.gz)?(?:$|\?)/i.test(url) || text.includes('\n')) return text.split(/\r?\n/).filter(Boolean).map((line, i) => { try { return JSON.parse(line); } catch (error) { throw new Error(`Invalid JSONL at line ${i + 1}: ${error.message}`); } });
  throw new Error('Unrecognized Scryfall bulk-data encoding.');
}

export async function readBulkFile(file, normalizeKind = null) {
  const resolved = path.resolve(process.cwd(), file);
  const stat = fs.statSync(resolved);
  const compressedBytes = fs.readFileSync(resolved);
  const digest = sha256(compressedBytes);

  // Official Scryfall JSONL snapshots can exceed Node's maximum string length once
  // decompressed (default_cards is hundreds of MB). Parse JSONL incrementally. For
  // production imports, normalize each row immediately so the rich raw payload is
  // never retained for all 100k+ records at once.
  if (/\.jsonl(?:\.gz)?$/i.test(resolved)) {
    const fileStream = fs.createReadStream(resolved);
    const input = /\.gz$/i.test(resolved) ? fileStream.pipe(createGunzip()) : fileStream;
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    const cards = [];
    const identities = new Set();
    let lineNumber = 0;
    let withOracleId = 0;

    for await (const line of lines) {
      lineNumber++;
      const trimmed = line.trim();
      if (!trimmed) continue;
      let raw;
      try { raw = JSON.parse(trimmed); }
      catch (error) { throw new Error(`Invalid JSONL at line ${lineNumber} in ${path.basename(resolved)}: ${error.message}`); }

      if (normalizeKind === 'oracle') {
        if (!raw?.id || !raw?.oracle_id || !raw?.name) throw new Error(`Oracle bulk input has a malformed record at line ${lineNumber}.`);
        if (identities.has(raw.oracle_id)) throw new Error(`Oracle bulk input contains duplicate Oracle identity ${raw.oracle_id}.`);
        identities.add(raw.oracle_id);
        const normalized = normalizeOracleCard(raw);
        if (!normalized) throw new Error(`Oracle normalization failed at line ${lineNumber}.`);
        cards.push(normalized);
      } else if (normalizeKind === 'printing') {
        if (!raw?.id || !raw?.name) throw new Error(`Printing bulk input has a malformed record at line ${lineNumber}.`);
        if (identities.has(raw.id)) throw new Error(`Printing bulk input contains duplicate Scryfall printing ID ${raw.id}.`);
        identities.add(raw.id);
        if (raw.oracle_id) withOracleId++;
        const normalized = normalizePrinting(raw);
        if (!normalized) throw new Error(`Printing normalization failed at line ${lineNumber}.`);
        cards.push(normalized);
      } else {
        cards.push(raw);
      }
    }

    if (normalizeKind === 'oracle' && cards.length < MIN_COMPLETE_CARD_COUNT) throw new Error(`Oracle bulk input was incomplete (${cards.length} records; expected at least ${MIN_COMPLETE_CARD_COUNT}).`);
    if (normalizeKind === 'printing') {
      if (cards.length < MIN_COMPLETE_CARD_COUNT) throw new Error(`Printing bulk input was incomplete (${cards.length} records; expected at least ${MIN_COMPLETE_CARD_COUNT}).`);
      if (withOracleId < Math.floor(cards.length * 0.95)) throw new Error(`Printing bulk input does not look like Scryfall default_cards (${withOracleId}/${cards.length} records have Oracle IDs).`);
    }

    return { cards, normalized: !!normalizeKind, sha256: digest, byteLength: stat.size, source: path.basename(resolved), mtime: stat.mtime.toISOString() };
  }

  const rawCards = parseBulkBuffer(compressedBytes, resolved);
  if (normalizeKind) {
    validateBulk(normalizeKind === 'oracle' ? rawCards : Array.from({ length: MIN_COMPLETE_CARD_COUNT }, (_, i) => ({ id: `fixture-${i}`, oracle_id: `fixture-${i}`, name: `Fixture ${i}` })), normalizeKind === 'printing' ? rawCards : Array.from({ length: MIN_COMPLETE_CARD_COUNT }, (_, i) => ({ id: `fixture-print-${i}`, oracle_id: `fixture-${i}`, name: `Fixture ${i}` })));
    const cards = rawCards.map(normalizeKind === 'oracle' ? normalizeOracleCard : normalizePrinting).filter(Boolean);
    return { cards, normalized: true, sha256: digest, byteLength: stat.size, source: path.basename(resolved), mtime: stat.mtime.toISOString() };
  }
  return { cards: rawCards, normalized: false, sha256: digest, byteLength: stat.size, source: path.basename(resolved), mtime: stat.mtime.toISOString() };
}

async function fetchBulkCards(bulk) {
  const url = bulk.jsonl_download_uri || bulk.download_uri;
  if (!url) throw new Error(`Scryfall ${bulk.type} bulk record did not include a download URI.`);
  const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(180000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${url}`);
  const bytes = Buffer.from(await r.arrayBuffer());
  return { cards: parseBulkBuffer(bytes, url), sha256: sha256(bytes), byteLength: bytes.length, source: url };
}

export function validateBulk(oracleRaw, printingRaw) {
  if (!Array.isArray(oracleRaw) || oracleRaw.length < MIN_COMPLETE_CARD_COUNT) throw new Error(`Oracle bulk input was incomplete (${Array.isArray(oracleRaw) ? oracleRaw.length : 0} records; expected at least ${MIN_COMPLETE_CARD_COUNT}).`);
  if (!Array.isArray(printingRaw) || printingRaw.length < MIN_COMPLETE_CARD_COUNT) throw new Error(`Printing bulk input was incomplete (${Array.isArray(printingRaw) ? printingRaw.length : 0} records; expected at least ${MIN_COMPLETE_CARD_COUNT}).`);

  const oracleIds = new Set();
  let malformedOracle = 0;
  for (const raw of oracleRaw) {
    if (!raw?.id || !raw?.oracle_id || !raw?.name) { malformedOracle++; continue; }
    oracleIds.add(raw.oracle_id);
  }
  if (malformedOracle) throw new Error(`Oracle bulk input contains ${malformedOracle} malformed records without id/oracle_id/name.`);
  if (oracleIds.size !== oracleRaw.length) throw new Error(`Oracle bulk input is not one-record-per-Oracle-ID (${oracleIds.size} unique Oracle IDs across ${oracleRaw.length} records).`);

  const printingIds = new Set();
  let malformedPrintings = 0;
  let printingWithOracleId = 0;
  for (const raw of printingRaw) {
    if (!raw?.id || !raw?.name) { malformedPrintings++; continue; }
    printingIds.add(raw.id);
    if (raw.oracle_id) printingWithOracleId++;
  }
  if (malformedPrintings) throw new Error(`Printing bulk input contains ${malformedPrintings} malformed records without id/name.`);
  if (printingIds.size !== printingRaw.length) throw new Error(`Printing bulk input contains duplicate Scryfall printing IDs (${printingIds.size} unique IDs across ${printingRaw.length} records).`);
  if (printingWithOracleId < Math.floor(printingRaw.length * 0.95)) throw new Error(`Printing bulk input does not look like Scryfall default_cards (${printingWithOracleId}/${printingRaw.length} records have Oracle IDs).`);
}

function buildAndCommit({ oracleInput, printingInput, oracleUpdatedAt, printingUpdatedAt, sourceType, startedAt }) {
  const inputsNormalized = oracleInput.normalized === true && printingInput.normalized === true;
  if (!inputsNormalized) validateBulk(oracleInput.cards, printingInput.cards);
  const oracleCards = inputsNormalized ? oracleInput.cards : oracleInput.cards.map(normalizeOracleCard).filter(Boolean);
  const printingCards = inputsNormalized ? printingInput.cards : printingInput.cards.map(normalizePrinting).filter(Boolean);
  if (oracleCards.length < MIN_COMPLETE_CARD_COUNT || printingCards.length < MIN_COMPLETE_CARD_COUNT) throw new Error('Normalization unexpectedly removed too many cards; refusing to replace the last-known-good catalog.');
  const now = new Date().toISOString();
  const oracle = { schemaVersion: SCHEMA_VERSION, source: 'Scryfall', sourceType: ORACLE_BULK_TYPE, sourceUpdatedAt: oracleUpdatedAt || null, generatedAt: now, complete: true, count: oracleCards.length, cards: oracleCards };
  const prints = { schemaVersion: SCHEMA_VERSION, source: 'Scryfall', sourceType: PRINTING_BULK_TYPE, sourceUpdatedAt: printingUpdatedAt || null, generatedAt: now, complete: true, count: printingCards.length, cards: printingCards };
  const metaBase = {
    schemaVersion: SCHEMA_VERSION,
    status: 'current',
    complete: true,
    sourceType,
    sourceUpdatedAt: oracleUpdatedAt || null,
    oracleSourceUpdatedAt: oracleUpdatedAt || null,
    printingSourceUpdatedAt: printingUpdatedAt || null,
    lastCheckedAt: startedAt,
    downloadedAt: now,
    oracleCount: oracleCards.length,
    printingCount: printingCards.length,
    oracleBulkSha256: oracleInput.sha256,
    printingBulkSha256: printingInput.sha256,
    oracleBulkBytes: oracleInput.byteLength,
    printingBulkBytes: printingInput.byteLength,
    oracleInputSource: oracleInput.source,
    printingInputSource: printingInput.source
  };
  const { meta } = writeProductionCatalogBundle({ oracle, prints, metaBase });
  return { oracle, prints, meta };
}

async function main() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const previousMeta = readJson(META_FILE, {});
  let previousOracle = readJson(CATALOG_FILE, null);
  let previousPrints = readJson(PRINTING_FILE, null);
  const startedAt = new Date().toISOString();

  try {
    if (Boolean(ORACLE_INPUT) !== Boolean(PRINTING_INPUT)) throw new Error('Offline bulk import requires both --oracle-file=<path> and --printing-file=<path>.');

    if (ORACLE_INPUT && PRINTING_INPUT) {
      console.log('Importing supplied Scryfall Oracle and printing bulk files...');
      const oracleInput = await readBulkFile(ORACLE_INPUT, 'oracle');
      const printingInput = await readBulkFile(PRINTING_INPUT, 'printing');
      const inferredUpdatedAt = SOURCE_UPDATED_AT || [oracleInput.mtime, printingInput.mtime].sort().at(-1);
      const result = buildAndCommit({ oracleInput, printingInput, oracleUpdatedAt: inferredUpdatedAt, printingUpdatedAt: inferredUpdatedAt, sourceType: `${ORACLE_BULK_TYPE}+${PRINTING_BULK_TYPE}:offline-import`, startedAt });
      console.log(`Imported ${result.oracle.count} Oracle identities and ${result.prints.count} printings from supplied bulk files.`);
      return;
    }

    console.log('Checking Scryfall for Oracle and printing catalogs...');
    const index = await fetchJson(BULK_INDEX_URL, 20000);
    const oracleBulk = (index.data || []).find(x => x.type === ORACLE_BULK_TYPE);
    const printBulk = (index.data || []).find(x => x.type === PRINTING_BULK_TYPE);
    if (!oracleBulk || !printBulk) throw new Error('Scryfall bulk index did not contain both oracle_cards and default_cards snapshots.');

    const current = !FORCE && previousOracle?.complete === true && previousPrints?.complete === true && previousOracle?.sourceUpdatedAt === oracleBulk.updated_at && previousPrints?.sourceUpdatedAt === printBulk.updated_at;
    if (current) {
      writeJsonAtomic(META_FILE, {
        ...previousMeta,
        schemaVersion: SCHEMA_VERSION,
        status: 'current',
        complete: true,
        oracleSourceUpdatedAt: oracleBulk.updated_at,
        printingSourceUpdatedAt: printBulk.updated_at,
        sourceUpdatedAt: oracleBulk.updated_at,
        lastCheckedAt: startedAt,
        oracleCount: previousOracle.count || previousOracle.cards?.length || 0,
        printingCount: previousPrints.count || previousPrints.cards?.length || 0,
        oracleCatalogSha256: fileSha256(CATALOG_FILE),
        printingCatalogSha256: fileSha256(PRINTING_FILE)
      }, true);
      console.log(`Catalogs are current (${previousOracle.count} Oracle identities / ${previousPrints.count} printings).`);
      return;
    }

    const [oracleInput, printingInput] = await Promise.all([fetchBulkCards(oracleBulk), fetchBulkCards(printBulk)]);
    const result = buildAndCommit({ oracleInput, printingInput, oracleUpdatedAt: oracleBulk.updated_at || null, printingUpdatedAt: printBulk.updated_at || null, sourceType: `${ORACLE_BULK_TYPE}+${PRINTING_BULK_TYPE}`, startedAt });
    console.log(`Updated ${result.oracle.count} Oracle identities and ${result.prints.count} printings.`);
  } catch (error) {
    if (!previousOracle?.cards?.length || !previousPrints?.cards?.length) {
      const seeded = seedFromLocal(previousMeta);
      previousOracle = seeded.oracle;
      previousPrints = seeded.prints;
    }
    const complete = previousOracle?.complete === true && previousPrints?.complete === true;
    writeJsonAtomic(META_FILE, {
      ...previousMeta,
      schemaVersion: SCHEMA_VERSION,
      status: complete ? 'stale' : 'offline-fallback',
      complete,
      sourceType: complete ? 'cached-scryfall' : 'trainer_seed',
      sourceUpdatedAt: previousOracle?.sourceUpdatedAt || null,
      oracleSourceUpdatedAt: previousOracle?.sourceUpdatedAt || null,
      printingSourceUpdatedAt: previousPrints?.sourceUpdatedAt || null,
      lastCheckedAt: startedAt,
      oracleCount: previousOracle?.cards?.length || 0,
      printingCount: previousPrints?.cards?.length || 0,
      oracleCatalogSha256: fileSha256(CATALOG_FILE),
      printingCatalogSha256: fileSha256(PRINTING_FILE),
      lastError: error.message
    }, true);
    console.warn(`Scryfall catalog refresh unavailable: ${error.message}`);
    console.warn(complete ? 'Continuing with cached full Oracle and printing catalogs.' : 'Continuing with the local trainer seed; practical-100 certification remains fail-closed.');
    if (STRICT) process.exitCode = 1;
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
