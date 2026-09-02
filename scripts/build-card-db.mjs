import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const argValue = name => rawArgs.find(arg => arg.startsWith(`${name}=`))?.slice(name.length + 1) || null;
const resolveCliPath = (value, fallback) => value ? path.resolve(ROOT, value) : fallback;
const SOURCE_DIR = resolveCliPath(argValue('--source-dir'), path.join(ROOT, 'src', 'data', 'source'));
const GENERATED_DIR = resolveCliPath(argValue('--output-dir'), path.join(ROOT, 'src', 'data', 'generated'));
const SOURCE_CARDS = path.join(SOURCE_DIR, 'cards.json');
const SOURCE_DECKS = path.join(SOURCE_DIR, 'decks.json');
const GENERATED_CARDS = path.join(GENERATED_DIR, 'cards.json');
const GENERATED_DECKS = path.join(GENERATED_DIR, 'decks.json');

const CHECK_ONLY = args.has('--check');
const REFRESH_SCRYFALL = args.has('--refresh-scryfall');

const SCRYFALL_HEADERS = Object.freeze({
  'User-Agent': 'MTGAITrainer/3.0 (+local educational deck trainer)',
  'Accept': 'application/json'
});

class ScryfallHttpError extends Error {
  constructor(message, status, body = '') {
    super(message);
    this.name = 'ScryfallHttpError';
    this.status = status;
    this.body = body;
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read valid JSON from ${path.relative(ROOT, file)}: ${error.message}`);
  }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temp, file);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function loadSourceDecks() {
  const decks = readJson(SOURCE_DECKS);
  assert(Array.isArray(decks) && decks.length > 0, 'src/data/source/decks.json must be a non-empty array.');
  return decks.map((deck, index) => ({ file: `decks.json[${index}]`, deck }));
}

function validateCardDatabase(cards) {
  assert(cards && typeof cards === 'object' && !Array.isArray(cards), 'Card database must be an object keyed by card id.');
  const ids = Object.keys(cards);
  assert(ids.length > 0, 'Card database is empty.');

  for (const id of ids) {
    const card = cards[id];
    assert(card && typeof card === 'object' && !Array.isArray(card), `Card ${id} must be an object.`);
    assert(card.id === id, `Card database key ${id} does not match card.id ${JSON.stringify(card.id)}.`);
    assert(typeof card.name === 'string' && card.name.trim(), `Card ${id} is missing a non-empty name.`);
    assert(typeof card.typeLine === 'string', `Card ${id} is missing typeLine.`);
    assert(Array.isArray(card.keywords), `Card ${id} keywords must be an array.`);
    assert(Array.isArray(card.abilities), `Card ${id} abilities must be an array.`);
    assert(Array.isArray(card.spellEffects), `Card ${id} spellEffects must be an array.`);
    assert(Array.isArray(card.colorIdentity), `Card ${id} colorIdentity must be an array.`);
    assert(card.colorIdentity.every(color => ['W','U','B','R','G'].includes(color)), `Card ${id} has an invalid color identity.`);
    if (card.supported !== false) assert(typeof card.oracleText === 'string' && card.oracleText.trim(), `Supported card ${id} is missing readable rules text.`);
  }
}

function isBasicLand(card) {
  return /(^|\s)Basic Land(?:\s|—|-|$)/i.test(card?.typeLine || '');
}

function sameColorIdentity(a = [], b = []) {
  const left = [...new Set(a)].sort();
  const right = [...new Set(b)].sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validateDecks(deckEntries, cards) {
  const seenIds = new Set();
  for (const { file, deck } of deckEntries) {
    const label = `Deck ${file}`;
    assert(deck && typeof deck === 'object' && !Array.isArray(deck), `${label} must be an object.`);
    assert(typeof deck.id === 'string' && deck.id.trim(), `${label} is missing id.`);
    assert(!seenIds.has(deck.id), `Duplicate deck id ${deck.id}.`);
    seenIds.add(deck.id);
    assert(typeof deck.name === 'string' && deck.name.trim(), `${label} is missing name.`);
    assert(deck.format === 'Commander', `${label} must declare format Commander.`);
    assert(typeof deck.commander === 'string' && deck.commander.trim(), `${label} is missing commander id.`);
    assert(cards[deck.commander], `${label} references unresolved commander ${deck.commander}.`);
    assert(Array.isArray(deck.colorIdentity), `${label} colorIdentity must be an array.`);
    assert(deck.colorIdentity.every(color => ['W','U','B','R','G'].includes(color)), `${label} has an invalid color identity.`);
    assert(Array.isArray(deck.cards) && deck.cards.length > 0, `${label} must contain a cards array.`);

    const commander = cards[deck.commander];
    assert(/Legendary/i.test(commander.typeLine || '') && (/Creature/i.test(commander.typeLine || '') || commander.creatureAtCounter), `${label} commander ${deck.commander} must be a legendary creature or a supported creature-transforming commander in the current trainer rules.`);
    assert(sameColorIdentity(deck.colorIdentity, commander.colorIdentity), `${label} color identity must exactly match commander ${deck.commander}.`);

    let total = 0;
    let commanderQuantity = 0;
    const entryIds = new Set();
    const deckIdentity = new Set(deck.colorIdentity);
    for (const entry of deck.cards) {
      assert(entry && typeof entry === 'object', `${label} contains an invalid card entry.`);
      assert(typeof entry.id === 'string' && entry.id.trim(), `${label} has a card entry without id.`);
      assert(!entryIds.has(entry.id), `${label} contains duplicate entries for ${entry.id}; combine quantities into one entry.`);
      entryIds.add(entry.id);
      const card = cards[entry.id];
      assert(card, `${label} references unresolved card ${entry.id}.`);
      assert(Number.isInteger(entry.quantity) && entry.quantity > 0, `${label} has invalid quantity for ${entry.id}.`);
      assert(isBasicLand(card) || entry.quantity === 1, `${label} violates Commander singleton construction with ${entry.quantity} copies of ${card.name}.`);
      assert(card.colorIdentity.every(color => deckIdentity.has(color)), `${label} contains off-color card ${card.name} (${card.colorIdentity.join('') || 'colorless'}) outside commander identity ${deck.colorIdentity.join('') || 'colorless'}.`);
      if (deck.playable !== false) assert(card.supported !== false, `${label} is playable but contains unsupported card ${card.name}.`);
      total += entry.quantity;
      if (entry.id === deck.commander) commanderQuantity += entry.quantity;
    }

    assert(commanderQuantity === 1, `${label} must contain exactly one copy of its commander entry; found ${commanderQuantity}.`);
    assert(total === 100, `${label} must contain exactly 100 cards including its commander; found ${total}.`);
    if (deck.cardCount != null) assert(deck.cardCount === total, `${label} cardCount=${deck.cardCount} does not match actual total ${total}.`);
  }
}

async function scryfallFetch(url, options = {}) {
  const headers = { ...SCRYFALL_HEADERS, ...(options.headers || {}) };
  let response;
  try {
    response = await fetch(url, { ...options, headers });
  } catch (error) {
    throw new ScryfallHttpError(`Scryfall request failed before receiving an HTTP response: ${error.message}`, 0);
  }

  if (!response.ok && response.status !== 404) {
    let body = '';
    try { body = await response.text(); } catch {}
    throw new ScryfallHttpError(`Scryfall request failed with HTTP ${response.status}.`, response.status, body);
  }
  return response;
}

function normalizeScryfallMetadata(raw) {
  const face = raw.card_faces?.[0] || raw;
  return {
    scryfallId: raw.id || null,
    oracleId: raw.oracle_id || null,
    image: raw.image_uris?.normal || raw.card_faces?.[0]?.image_uris?.normal || '',
    artCrop: raw.image_uris?.art_crop || raw.card_faces?.[0]?.image_uris?.art_crop || '',
    oracleText: face.oracle_text || raw.oracle_text || '',
    colorIdentity: Array.isArray(raw.color_identity) ? raw.color_identity : [],
    legalities: raw.legalities || {}
  };
}

async function lookupNamed(name) {
  const candidates = [name];
  if (name.includes(' // ')) candidates.push(name.split(' // ')[0]);
  for (const candidate of candidates) {
    const response = await scryfallFetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(candidate)}`);
    if (response.ok) return normalizeScryfallMetadata(await response.json());
    await sleep(60);
  }
  return null;
}

async function fetchMetadataByName(names) {
  const unique = [...new Set(names.filter(Boolean))];
  const byName = new Map();

  for (let i = 0; i < unique.length; i += 75) {
    const batch = unique.slice(i, i + 75);
    const response = await scryfallFetch('https://api.scryfall.com/cards/collection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers: batch.map(name => ({ name: name.includes(' // ') ? name.split(' // ')[0] : name })) })
    });

    if (response.ok) {
      const payload = await response.json();
      for (const raw of payload.data || []) {
        const metadata = normalizeScryfallMetadata(raw);
        byName.set(raw.name, metadata);
        byName.set(raw.name.split(' // ')[0], metadata);
      }
    }

    for (const name of batch) {
      if (byName.has(name) || byName.has(name.split(' // ')[0])) continue;
      const metadata = await lookupNamed(name);
      if (metadata) byName.set(name, metadata);
      else console.warn(`Scryfall has no exact card record for ${JSON.stringify(name)}; preserving the local runtime definition without Scryfall metadata.`);
      await sleep(60);
    }
    await sleep(90);
  }
  return byName;
}

async function build() {
  const sourceCards = readJson(SOURCE_CARDS);
  const deckEntries = loadSourceDecks();

  validateCardDatabase(sourceCards);
  validateDecks(deckEntries, sourceCards);

  let generatedCards = structuredClone(sourceCards);
  if (REFRESH_SCRYFALL) {
    const metadata = await fetchMetadataByName(Object.values(sourceCards).map(card => card.name));
    generatedCards = Object.fromEntries(Object.entries(sourceCards).map(([id, card]) => {
      const extra = metadata.get(card.name) || metadata.get(card.name.split(' // ')[0]) || {};
      // Runtime rules fields remain authoritative locally. Scryfall refresh only adds descriptive metadata.
      return [id, { ...card, ...extra, id, abilities: card.abilities, spellEffects: card.spellEffects }];
    }));
  }

  const generatedDecks = deckEntries.map(({ deck }) => structuredClone(deck));
  validateCardDatabase(generatedCards);
  validateDecks(deckEntries, generatedCards);

  if (!CHECK_ONLY) {
    writeJsonAtomic(GENERATED_CARDS, generatedCards);
    writeJsonAtomic(GENERATED_DECKS, generatedDecks);
  }

  console.log(`${CHECK_ONLY ? 'Validated' : 'Built'} ${Object.keys(generatedCards).length} cards and ${generatedDecks.length} decks from the authoritative src/data/source schema${REFRESH_SCRYFALL ? ' with Scryfall metadata refresh' : ''}.`);
}

build().catch(error => {
  if (error instanceof ScryfallHttpError) {
    console.error(`${error.name}: ${error.message}${error.status ? ` Status=${error.status}.` : ''}`);
    if (error.body) console.error(error.body.slice(0, 1000));
  } else {
    console.error(error.stack || error.message || String(error));
  }
  process.exit(1);
});
