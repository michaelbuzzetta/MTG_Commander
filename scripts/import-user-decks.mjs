import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USER_DECKS = path.join(ROOT, 'user-decks.json');
const CAPTURE = path.join(ROOT, 'user-deck-card-data.json');
const CARDS = path.join(ROOT, 'src/data/source/cards.json');
const DECKS = path.join(ROOT, 'src/data/source/decks.json');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const slug = value => String(value).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 76);
const NUMBER = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const supportedKeywords = new Set(['flying','reach','vigilance','trample','lifelink','deathtouch','haste','first strike','double strike','menace','hexproof','indestructible','islandwalk','flash']);

function amount(word, fallback = 1) {
  if (/^\d+$/.test(String(word))) return Number(word);
  return NUMBER[String(word).toLowerCase()] ?? fallback;
}

async function refreshCapture(decks) {
  const names = [...new Set(decks.flatMap(deck => deck.cards))];
  const cards = [];
  for (let index = 0; index < names.length; index += 75) {
    const identifiers = names.slice(index, index + 75).map(name => ({ name: name.split(' // ')[0] }));
    const response = await fetch('https://api.scryfall.com/cards/collection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'MTGAdvancedAI/1.0' },
      body: JSON.stringify({ identifiers })
    });
    if (!response.ok) throw new Error(`Scryfall collection request failed: ${response.status}`);
    const payload = await response.json();
    cards.push(...payload.data);
    if (payload.not_found?.length) throw new Error(`Cards not found: ${payload.not_found.map(item => item.name).join(', ')}`);
    if (index + 75 < names.length) await new Promise(resolve => setTimeout(resolve, 120));
  }
  write(CAPTURE, { capturedAt: new Date().toISOString(), source: 'Scryfall cards/collection API', cards });
}

function faces(card) { return card.card_faces?.length ? card.card_faces : [card]; }
function fullOracle(card) { return faces(card).map(face => face.oracle_text || '').filter(Boolean).join('\n//\n'); }
function front(card) { return faces(card)[0]; }
function numericStat(value) { return /^-?\d+$/.test(String(value ?? '')) ? Number(value) : null; }

function tokenEffect(text) {
  const match = text.match(/create (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) (\d+)\/(\d+) ([^.;]+?) creature tokens?/i);
  if (!match) return null;
  const descriptor = match[4].replace(/\b(?:white|blue|black|red|green|colorless)\b/ig, '').trim();
  const subtype = descriptor.split(/\s+/).at(-1).replace(/[^A-Za-z'-]/g, '') || 'Creature';
  return { type: 'createToken', amount: amount(match[1]), token: { name: `${subtype} Token`, typeLine: `Token Creature — ${subtype}`, subtypes: [subtype], power: Number(match[2]), toughness: Number(match[3]), keywords: [], abilities: [] } };
}

function effectsFor(text, { spell = false } = {}) {
  const effects = [];
  const draw = text.match(/draw (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?/i);
  if (draw) effects.push({ type: 'draw', amount: amount(draw[1]) });
  const life = text.match(/you gain (\d+) life/i);
  if (life) effects.push({ type: 'gainLife', amount: Number(life[1]) });
  const token = tokenEffect(text);
  if (token) effects.push(token);
  if (/\bproliferate\b/i.test(text)) effects.push({ type: 'proliferate' });
  if (spell && /counter target .*spell/i.test(text)) effects.push({ type: 'counterSpell' });
  if (spell && /destroy target/i.test(text)) effects.push({ type: 'destroy' });
  if (spell && /exile target/i.test(text)) effects.push({ type: 'exile' });
  if (spell && /return target .* to (?:its|their) owner'?s hand/i.test(text)) effects.push({ type: 'returnToHand' });
  const damage = text.match(/deals? (\d+) damage to (?:any|target)/i);
  if (spell && damage) effects.push({ type: 'damage', amount: Number(damage[1]) });
  if (/search your library for (?:a|up to one) basic land/i.test(text)) effects.push({ type: 'searchBasic', destination: /onto the battlefield/i.test(text) ? 'battlefield' : 'hand' });
  return effects;
}

function targetFor(text, effects) {
  if (effects.some(effect => effect.type === 'counterSpell')) return { kind: 'spell', zone: 'stack' };
  if (!effects.some(effect => ['destroy','exile','returnToHand','damage'].includes(effect.type))) return null;
  if (/any target/i.test(text)) return { kind: 'playerOrPermanent' };
  const types = [];
  for (const type of ['creature','artifact','enchantment','planeswalker']) if (new RegExp(`target [^.;]*${type}`, 'i').test(text)) types.push(type[0].toUpperCase() + type.slice(1));
  if (/target (?:nonland )?permanent/i.test(text)) return { kind: 'permanent', ...(/nonland/i.test(text) ? { nonland: true } : {}) };
  return { kind: 'permanent', ...(types.length === 1 ? { type: types[0] } : types.length ? { types } : {}) };
}

function manaAbilities(card, text, typeLine) {
  const abilities = [];
  const basic = typeLine.match(/Basic Land — (Plains|Island|Swamp|Mountain|Forest)/i)?.[1]?.toLowerCase();
  const basicColor = { plains: 'W', island: 'U', swamp: 'B', mountain: 'R', forest: 'G' }[basic];
  if (basicColor) return [{ type: 'mana', mana: { [basicColor]: 1 } }];
  const addAny = /add one mana of any color|add (?:two|three) mana in any combination of colors/i.test(text);
  if (addAny) abilities.push({ type: 'mana', anyColor: true, colors: ['W','U','B','R','G'], amount: /add three/i.test(text) ? 3 : /add two/i.test(text) ? 2 : 1 });
  const symbols = [...text.matchAll(/Add ((?:\{[WUBRGC]\})+)/g)].flatMap(match => [...match[1].matchAll(/\{([WUBRGC])\}/g)].map(part => part[1]));
  if (symbols.length && !addAny) {
    const mana = {};
    for (const symbol of symbols) mana[symbol] = Math.max(mana[symbol] || 0, symbols.filter(value => value === symbol).length);
    abilities.push({ type: 'mana', ...(Object.keys(mana).length > 1 ? { anyColor: true, colors: Object.keys(mana), amount: 1 } : { mana }) });
  }
  if (/\bLand\b/.test(typeLine) && !abilities.length) {
    const colors = card.color_identity || [];
    abilities.push(colors.length ? { type: 'mana', anyColor: true, colors, amount: 1 } : { type: 'mana', mana: { C: 1 } });
  }
  return abilities;
}

function roman(value) {
  const map = { I: 1, V: 5, X: 10 };
  let total = 0, prior = 0;
  for (const char of [...value].reverse()) { const n = map[char] || 0; total += n < prior ? -n : n; prior = Math.max(prior, n); }
  return total;
}

function sagaChapters(text) {
  const chapters = [];
  for (const line of text.split('\n')) {
    const match = line.match(/^([IVX]+(?:,\s*[IVX]+)*)\s*[—-]\s*(.+)$/);
    if (!match) continue;
    const parsed = effectsFor(match[2], { spell: true });
    const chapterEffect = parsed.length === 1 ? parsed[0] : { type: 'sequence', effects: parsed };
    const targets = targetFor(match[2], parsed);
    for (const label of match[1].split(',').map(item => item.trim())) chapters.push({ number: roman(label), text: match[2], effect: chapterEffect, ...(targets ? { targets } : {}) });
  }
  return chapters.sort((a, b) => a.number - b.number);
}

function genericAbilities(card, text, typeLine) {
  const abilities = manaAbilities(card, text, typeLine);
  if (/you have no maximum hand size/i.test(text)) abilities.push({ type: 'static', effect: { noMaximumHandSize: true } });
  const enters = text.match(/when (?:this [^,.]+|[^\n.]+) enters,?\s*([^\n]+)/i);
  if (enters) {
    const effects = effectsFor(enters[1]);
    if (effects.length) abilities.push({ type: 'triggered', event: 'ENTER_BATTLEFIELD', condition: { sourceEvent: true }, effect: effects.length === 1 ? effects[0] : { type: 'sequence', effects } });
  }
  const upkeep = text.match(/at the beginning of your upkeep,?\s*([^\n]+)/i);
  if (upkeep) {
    const effects = effectsFor(upkeep[1]);
    if (effects.length) abilities.push({ type: 'triggered', event: 'PHASE_BEGIN', condition: { controllerEvent: true, phase: 'UPKEEP' }, effect: effects.length === 1 ? effects[0] : { type: 'sequence', effects } });
  }
  return abilities;
}

function normalize(card, id) {
  const face = front(card);
  const text = fullOracle(card);
  const typeLine = card.type_line || face.type_line || '';
  const permanent = !/\b(?:Instant|Sorcery)\b/i.test(typeLine);
  const spellEffects = permanent ? [] : effectsFor(text, { spell: true });
  const definition = {
    id, name: card.name, typeLine, manaCost: card.mana_cost || face.mana_cost || '', manaValue: Number(card.cmc || 0),
    power: numericStat(face.power), toughness: numericStat(face.toughness),
    subtypes: typeLine.split('—')[1]?.split('//')[0]?.trim().split(/\s+/).filter(Boolean) || [],
    colors: [...(card.colors || face.colors || [])], colorIdentity: [...(card.color_identity || [])],
    keywords: [...new Set((card.keywords || []).map(value => value.toLowerCase()).filter(value => supportedKeywords.has(value)))],
    abilities: genericAbilities(card, text, typeLine), spellEffects, oracleText: text,
    image: card.image_uris?.normal || face.image_uris?.normal || '', scryfallId: card.id, legalities: card.legalities || { commander: 'legal' },
    supported: true, source: `Scryfall oracle capture ${card.set?.toUpperCase() || ''} ${card.collector_number || ''}`.trim()
  };
  const target = targetFor(text, spellEffects);
  if (target) definition.targets = target;
  if (/enters tapped/i.test(text)) definition.entersTapped = true;
  if (/\bSaga\b/.test(typeLine)) {
    definition.entersWithCounters = { counter: 'lore', amount: 1 };
    definition.sagaChapters = sagaChapters(text);
  }
  return definition;
}

function applyCoreRules(definition) {
  const name = definition.name;
  if (name === 'Jhoira of the Ghitu') definition.abilities = [{ type: 'activated', cost: { mana: '{2}' }, tap: true, targets: { kind: 'card', zone: 'hand', owner: 'you', nonland: true }, effect: { type: 'jhoiraSuspend', counters: 4 } }];
  if (['Ancestral Vision','Wheel of Fate'].includes(name)) definition.castOnlyFromSuspend = true;
  if (name === "Jhoira's Timebug") definition.abilities.push({ type: 'activated', tap: true, targets: { kind: 'card', zone: 'exile', owner: 'you', hasCounter: 'time' }, effect: { type: 'adjustTimeCounters', amount: -1 } });
  if (name === 'Rift Elemental') definition.abilities.push({ type: 'activated', cost: { mana: '{1}{R}' }, targets: { kind: 'card', zone: 'exile', owner: 'you', hasCounter: 'time' }, effect: { type: 'adjustTimeCounters', amount: -1 } });
  if (['Clockspinning','Timecrafting'].includes(name)) {
    definition.targets = { kind: 'card', zone: 'exile', owner: 'you', hasCounter: 'time' };
    definition.spellEffects = [{ type: 'adjustTimeCounters', amount: -1 }];
  }
  if (name === 'Fury Charm') {
    definition.targets = { kind: 'card', zone: 'exile', owner: 'you', hasCounter: 'time' };
    definition.spellEffects = [{ type: 'adjustTimeCounters', amount: -2 }];
  }
  if (['Time Stretch','Temporal Mastery','Temporal Trespass','Nexus of Fate','Beacon of Tomorrows'].includes(name)) {
    definition.targets = undefined;
    definition.spellEffects = [{ type: 'extraTurn', amount: name === 'Time Stretch' ? 2 : 1 }];
  }
  if (name === 'Tom Bombadil') definition.abilities = [
    { type: 'static', filter: { self: true }, when: { controllerSagaLoreMin: 4 }, effect: { keywords: ['hexproof','indestructible'] } },
    { type: 'triggered', event: 'SAGA_FINAL_RESOLVED', condition: { controllerEvent: true }, effect: { type: 'tomBombadilCascade' } }
  ];
  if (name === 'Barbara Wright') definition.abilities.push({ type: 'replacement', event: 'COUNTERS_ADDED', counterType: 'lore', filter: { controller: 'you', subtype: 'Saga' }, effect: 'addOne' });
}

const requestedDecks = read(USER_DECKS);
for (const deck of requestedDecks) if (deck.cards.length !== 100) throw new Error(`${deck.name} contains ${deck.cards.length} cards, not 100.`);
if (process.argv.includes('--refresh') || !fs.existsSync(CAPTURE)) await refreshCapture(requestedDecks);

const capture = read(CAPTURE);
const captureByName = new Map();
for (const card of capture.cards) {
  captureByName.set(card.name.toLowerCase(), card);
  for (const face of card.card_faces || []) captureByName.set(face.name.toLowerCase(), card);
}
const cards = read(CARDS);
const nameToId = new Map(Object.values(cards).map(card => [card.name.toLowerCase(), card.id]));
let decks = read(DECKS).filter(deck => !requestedDecks.some(requested => requested.id === deck.id));

for (const requested of requestedDecks) {
  const quantities = new Map();
  for (const name of requested.cards) {
    const metadata = captureByName.get(name.toLowerCase());
    if (!metadata) throw new Error(`No captured card data for ${name}`);
    let id = nameToId.get(name.toLowerCase());
    if (!id) {
      id = `user-${slug(name)}`;
      cards[id] = normalize(metadata, id);
      nameToId.set(name.toLowerCase(), id);
    } else if (id.startsWith('arch-') || id.startsWith('user-')) {
      cards[id] = normalize(metadata, id);
    } else if (/\bSaga\b/.test(metadata.type_line || '')) {
      cards[id].entersWithCounters = { counter: 'lore', amount: 1 };
      cards[id].sagaChapters = sagaChapters(fullOracle(metadata));
    }
    applyCoreRules(cards[id]);
    quantities.set(id, (quantities.get(id) || 0) + 1);
  }
  const commanderId = nameToId.get(requested.commander.toLowerCase());
  decks.push({
    id: requested.id, name: requested.name, format: 'Commander', commander: commanderId,
    colorIdentity: [...(cards[commanderId].colorIdentity || [])], playable: true, cardCount: 100,
    source: 'User-supplied Commander deck list', notes: requested.description,
    cards: [...quantities].map(([id, quantity]) => ({ id, quantity }))
  });
}

write(CARDS, cards);
write(DECKS, decks);
console.log(`Imported ${requestedDecks.length} user decks. Card database now contains ${Object.keys(cards).length} cards; deck database contains ${decks.length} decks.`);
