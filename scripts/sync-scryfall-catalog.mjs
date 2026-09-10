import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = path.join(ROOT, '.cache', 'scryfall');
const CATALOG_FILE = path.join(CACHE_DIR, 'card-catalog.json');
const META_FILE = path.join(CACHE_DIR, 'card-catalog-meta.json');
const LOCAL_CARDS = path.join(ROOT, 'src', 'data', 'generated', 'cards.json');
const BULK_INDEX_URL = 'https://api.scryfall.com/bulk-data';
const BULK_TYPE = 'oracle_cards';
const SCHEMA_VERSION = 1;
const FORCE = process.argv.includes('--force');
const STRICT = process.argv.includes('--strict');

const HEADERS = Object.freeze({
  'User-Agent': 'MTGAITrainer/4.0 (+local educational Commander trainer)',
  'Accept': 'application/json;q=0.9,*/*;q=0.8'
});

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

function writeJsonAtomic(file, value, pretty = false) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`);
  fs.renameSync(temp, file);
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function faceText(raw) {
  if (Array.isArray(raw.card_faces) && raw.card_faces.length) {
    return raw.card_faces.map(face => face.oracle_text || '').filter(Boolean).join('\n//\n');
  }
  return raw.oracle_text || '';
}

function faceImages(raw) {
  const face = raw.card_faces?.find(item => item?.image_uris) || raw.card_faces?.[0] || {};
  const imageUris = raw.image_uris || face.image_uris || {};
  return {
    image: imageUris.normal || imageUris.large || imageUris.small || '',
    imageSmall: imageUris.small || imageUris.normal || '',
    artCrop: imageUris.art_crop || ''
  };
}

function normalizeFace(face = {}) {
  const images = face.image_uris || {};
  return {
    name: face.name || '',
    manaCost: face.mana_cost || '',
    typeLine: face.type_line || '',
    oracleText: face.oracle_text || '',
    power: finiteNumber(face.power),
    toughness: finiteNumber(face.toughness),
    loyalty: finiteNumber(face.loyalty),
    defense: finiteNumber(face.defense),
    colors: Array.isArray(face.colors) ? face.colors : [],
    image: images.normal || images.large || images.small || '',
    imageSmall: images.small || images.normal || '',
    artCrop: images.art_crop || ''
  };
}

function normalizeCard(raw) {
  if (!raw?.name) return null;
  const images = faceImages(raw);
  const faces = Array.isArray(raw.card_faces) ? raw.card_faces.map(normalizeFace) : [];
  const firstFace = faces[0] || {};
  const stable = raw.oracle_id || raw.id;
  return {
    id: `catalog-${stable}`,
    name: raw.name,
    aliases: [...new Set([raw.name, ...faces.map(face => face.name)].filter(Boolean))],
    layout: raw.layout || 'normal',
    typeLine: raw.type_line || firstFace.typeLine || '',
    manaCost: raw.mana_cost || firstFace.manaCost || '',
    manaValue: finiteNumber(raw.cmc) ?? 0,
    power: finiteNumber(raw.power) ?? firstFace.power ?? null,
    toughness: finiteNumber(raw.toughness) ?? firstFace.toughness ?? null,
    loyalty: finiteNumber(raw.loyalty) ?? firstFace.loyalty ?? null,
    defense: finiteNumber(raw.defense) ?? firstFace.defense ?? null,
    colors: Array.isArray(raw.colors) ? raw.colors : (firstFace.colors || []),
    colorIdentity: Array.isArray(raw.color_identity) ? raw.color_identity : [],
    keywords: [...new Set((raw.keywords || []).map(value => String(value).toLowerCase()))],
    producedMana: Array.isArray(raw.produced_mana) ? raw.produced_mana : [],
    oracleText: faceText(raw),
    abilities: [],
    spellEffects: [],
    legalities: raw.legalities || {},
    games: Array.isArray(raw.games) ? raw.games : [],
    reserved: !!raw.reserved,
    set: raw.set || '',
    setName: raw.set_name || '',
    collectorNumber: raw.collector_number || '',
    rarity: raw.rarity || '',
    edhrecRank: finiteNumber(raw.edhrec_rank),
    pennyRank: finiteNumber(raw.penny_rank),
    image: images.image,
    imageSmall: images.imageSmall,
    artCrop: images.artCrop,
    cardFaces: faces,
    scryfallId: raw.id || null,
    oracleId: raw.oracle_id || null,
    catalogCard: true,
    supported: false,
    source: 'Scryfall oracle_cards bulk catalog'
  };
}

function seedFromLocal() {
  const local = readJson(LOCAL_CARDS, {});
  const cards = Object.values(local).map(card => ({ ...card, catalogCard: false, source: card.source || 'Local trainer database' }));
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    source: 'local-fallback',
    sourceType: 'trainer_seed',
    sourceUpdatedAt: null,
    generatedAt: new Date().toISOString(),
    complete: false,
    count: cards.length,
    cards
  };
  writeJsonAtomic(CATALOG_FILE, payload);
  return payload;
}

async function fetchJson(url, timeoutMs) {
  const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return response.json();
}

function parseBulkBuffer(buffer, url = '') {
  let bytes = Buffer.from(buffer);
  // data.scryfall.io may publish the modern bulk snapshot as .jsonl.gz.
  // Undici normally decompresses HTTP Content-Encoding automatically, but the
  // magic-byte check also handles a literal gzip payload safely.
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);
  const text = bytes.toString('utf8').trim();
  if (!text) return [];
  if (text.startsWith('[')) return JSON.parse(text);
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
  } catch {}
  if (/\.jsonl(?:\.gz)?(?:$|\?)/i.test(url) || text.includes('\n')) {
    return text.split(/\r?\n/).filter(Boolean).map((line, index) => {
      try { return JSON.parse(line); }
      catch (error) { throw new Error(`Invalid JSONL at line ${index + 1}: ${error.message}`); }
    });
  }
  throw new Error('Unrecognized Scryfall bulk-data encoding.');
}

async function fetchBulkCards(bulk) {
  const url = bulk.jsonl_download_uri || bulk.download_uri;
  if (!url) throw new Error(`Scryfall ${BULK_TYPE} bulk record did not include a download URI.`);
  const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return parseBulkBuffer(await response.arrayBuffer(), url);
}

async function main() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const previousMeta = readJson(META_FILE, {});
  const previousCatalog = readJson(CATALOG_FILE, null);
  const startedAt = new Date().toISOString();

  try {
    console.log('Checking Scryfall for the latest complete Oracle card catalog...');
    const index = await fetchJson(BULK_INDEX_URL, 20000);
    const bulk = (index.data || []).find(item => item.type === BULK_TYPE);
    if (!bulk || (!bulk.download_uri && !bulk.jsonl_download_uri)) throw new Error(`Scryfall bulk index did not contain a downloadable ${BULK_TYPE} snapshot.`);

    const alreadyCurrent = !FORCE
      && previousCatalog?.complete === true
      && previousCatalog?.schemaVersion === SCHEMA_VERSION
      && previousCatalog?.sourceUpdatedAt === bulk.updated_at
      && fs.existsSync(CATALOG_FILE);

    if (alreadyCurrent) {
      const meta = {
        ...previousMeta,
        schemaVersion: SCHEMA_VERSION,
        status: 'current',
        complete: true,
        sourceType: BULK_TYPE,
        sourceUpdatedAt: bulk.updated_at,
        lastCheckedAt: startedAt,
        count: previousCatalog.count || previousCatalog.cards?.length || 0
      };
      writeJsonAtomic(META_FILE, meta, true);
      console.log(`Card catalog is current (${meta.count.toLocaleString()} unique Oracle cards).`);
      return;
    }

    console.log(`Downloading Scryfall ${BULK_TYPE} bulk data${previousCatalog?.complete ? ' (a newer snapshot is available)' : ''}...`);
    const rawCards = await fetchBulkCards(bulk);
    if (!Array.isArray(rawCards) || rawCards.length < 10000) throw new Error('Scryfall bulk download did not look like a complete card array.');

    const cards = rawCards.map(normalizeCard).filter(Boolean);
    const payload = {
      schemaVersion: SCHEMA_VERSION,
      source: 'Scryfall',
      sourceType: BULK_TYPE,
      sourceUpdatedAt: bulk.updated_at || null,
      generatedAt: new Date().toISOString(),
      complete: true,
      count: cards.length,
      cards
    };
    writeJsonAtomic(CATALOG_FILE, payload);
    writeJsonAtomic(META_FILE, {
      schemaVersion: SCHEMA_VERSION,
      status: 'current',
      complete: true,
      sourceType: BULK_TYPE,
      sourceUpdatedAt: bulk.updated_at || null,
      lastCheckedAt: startedAt,
      downloadedAt: payload.generatedAt,
      count: cards.length,
      bulkSize: bulk.size || null,
      bulkContentType: bulk.content_type || null
    }, true);
    console.log(`Updated full card catalog: ${cards.length.toLocaleString()} unique Oracle cards.`);
  } catch (error) {
    let catalog = previousCatalog;
    if (!catalog?.cards?.length) catalog = seedFromLocal();
    const meta = {
      ...previousMeta,
      schemaVersion: SCHEMA_VERSION,
      status: catalog?.complete ? 'stale' : 'offline-fallback',
      complete: !!catalog?.complete,
      sourceType: catalog?.sourceType || 'trainer_seed',
      sourceUpdatedAt: catalog?.sourceUpdatedAt || previousMeta?.sourceUpdatedAt || null,
      lastCheckedAt: startedAt,
      count: catalog?.count || catalog?.cards?.length || 0,
      lastError: error.message
    };
    writeJsonAtomic(META_FILE, meta, true);
    console.warn(`Scryfall catalog refresh unavailable: ${error.message}`);
    console.warn(catalog?.complete
      ? `Continuing with the most recent cached full catalog (${meta.count.toLocaleString()} cards).`
      : `Continuing with the local trainer seed (${meta.count.toLocaleString()} cards). The full catalog will be downloaded on the next successful app launch.`);
    if (STRICT) process.exitCode = 1;
  }
}

main();
