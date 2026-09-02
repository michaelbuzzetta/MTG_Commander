import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARCHIDEKT_FILE = path.join(ROOT, 'archidekt-selected-decks.json');
const CATEGORY_FILE = path.join(ROOT, 'archidekt-category-config.json');
const CARDS_FILE = path.join(ROOT, 'src', 'data', 'source', 'cards.json');
const DECKS_FILE = path.join(ROOT, 'src', 'data', 'source', 'decks.json');

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const COLOR = { White: 'W', Blue: 'U', Black: 'B', Red: 'R', Green: 'G' };
const NUMBER_WORD = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const SUPPORTED_KEYWORDS = ['flying','reach','vigilance','trample','lifelink','deathtouch','haste','first strike','double strike','menace','hexproof','indestructible','islandwalk','flash'];

function slug(value) {
  return String(value).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72);
}

function mainDeckCards(cards, categories) {
  return cards.filter(card => {
    const primaryCategory = card.categories?.[0];
    return primaryCategory !== 'Sideboard' && categories?.[primaryCategory]?.includedInDeck !== false;
  });
}

function manaCost(card) {
  if (card.front?.manaCost != null) return card.front.manaCost;
  const parts = card.castingCost || [];
  if (!parts.length) return '';
  return parts.map(part => Array.isArray(part) ? `{${part.join('/')}}` : (/^[A-Z0-9X]+$/.test(String(part)) ? `{${part}}` : '')).join('');
}

function typeLine(card) {
  const face = card.front || card;
  const left = [...(face.superTypes || []), ...(face.types || [])].join(' ');
  const right = (face.subTypes || []).join(' ');
  return right ? `${left} — ${right}` : left;
}

function oracleText(card) {
  if (!card.front) return card.text || 'No additional rules text.';
  const faces = [card.front, card.back].filter(Boolean).map(face => `${face.name}\n${face.text || ''}`.trim());
  return faces.join('\n\n//\n\n') || card.text || 'No additional rules text.';
}

function numericWord(value, fallback = 1) {
  const text = String(value || '').toLowerCase();
  if (/^\d+$/.test(text)) return Number(text);
  return NUMBER_WORD[text] ?? fallback;
}

function tokenFromText(text) {
  const match = text.match(/create (?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(\d+)\/(\d+)\s+([^.;\n]+?) creature token/i);
  if (!match) return null;
  const countWord = text.match(/create (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+\d+\/\d+/i)?.[1] || 'a';
  const descriptor = match[3].replace(/(?:white|blue|black|red|green|colorless)\s+/ig, '').trim();
  const subtype = descriptor.split(/\s+/).at(-1).replace(/[^A-Za-z'-]/g, '') || 'Creature';
  return {
    type: 'createToken',
    amount: numericWord(countWord),
    token: { name: `${subtype} Token`, typeLine: `Token Creature — ${subtype}`, subtypes: [subtype], power: Number(match[1]), toughness: Number(match[2]), keywords: [], abilities: [] }
  };
}

function simpleEffects(text, { spell = false } = {}) {
  const effects = [];
  const lower = String(text || '').toLowerCase();
  const draw = text.match(/draw (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?/i);
  if (draw) effects.push({ type: 'draw', amount: numericWord(draw[1]) });
  if (/\bproliferate\b/i.test(text)) effects.push({ type: 'proliferate' });
  const gain = text.match(/(?:you )?gain (\d+) life/i);
  if (gain) effects.push({ type: 'gainLife', amount: Number(gain[1]) });
  if (spell && /counter target .*spell/i.test(text)) effects.push({ type: 'counterSpell' });
  if (spell && /destroy target/i.test(text)) effects.push({ type: 'destroy' });
  if (spell && /exile target/i.test(text)) effects.push({ type: 'exile' });
  if (spell && /return target .* to (?:its|their) owner'?s hand/i.test(text)) effects.push({ type: 'returnToHand' });
  const damage = text.match(/deals? (\d+) damage to (?:any|target)/i);
  if (spell && damage) effects.push({ type: 'damage', amount: Number(damage[1]) });
  const pump = text.match(/target creature (?:you control )?gets? \+(\d+)\/\+(\d+)/i);
  if (spell && pump) effects.push({ type: 'pump', power: Number(pump[1]), toughness: Number(pump[2]) });
  const token = tokenFromText(text);
  if (token) effects.push(token);
  if (spell && /search your library for (?:a|up to two) basic land/i.test(lower)) effects.push(/up to two|two basic lands/i.test(lower) ? { type: 'cultivate' } : { type: 'searchBasic', destination: /onto the battlefield/i.test(lower) ? 'battlefield' : 'hand' });
  if (/manifest dread/i.test(text)) effects.push({ type: 'manifestDread' });
  return effects;
}

function targetSpec(text, effects) {
  if (effects.some(effect => effect.type === 'counterSpell')) return { kind: 'spell', zone: 'stack' };
  if (!effects.some(effect => ['destroy','exile','returnToHand','damage','pump'].includes(effect.type))) return null;
  if (/any target/i.test(text)) return { kind: 'playerOrPermanent' };
  if (/target (?:nonland )?permanent/i.test(text)) return { kind: 'permanent', ...( /nonland permanent/i.test(text) ? { nonland: true } : {} ) };
  const types = [];
  if (/target .*creature/i.test(text)) types.push('Creature');
  if (/target .*planeswalker/i.test(text)) types.push('Planeswalker');
  if (/target .*artifact/i.test(text)) types.push('Artifact');
  if (/target .*enchantment/i.test(text)) types.push('Enchantment');
  return { kind: 'permanent', ...(types.length === 1 ? { type: types[0] } : types.length ? { types } : {}) };
}

function inferredAbilities(card, text, cardTypeLine) {
  const abilities = [];
  const production = Object.fromEntries(Object.entries(card.manaProduction || {}).filter(([, amount]) => Number(amount) > 0));
  const colored = Object.entries(production).filter(([color]) => color !== 'C');
  const colorless = Number(production.C || 0);
  if (colorless) abilities.push({ type: 'mana', mana: { C: colorless } });
  if (colored.length) {
    const maximum = Math.max(...colored.map(([, amount]) => Number(amount)));
    abilities.push({ type: 'mana', anyColor: true, colors: colored.map(([color]) => color), amount: maximum });
  }

  if (/you have no maximum hand size/i.test(text)) abilities.push({ type: 'static', effect: { noMaximumHandSize: true } });
  const anthem = text.match(/(?:other )?creatures you control get \+(\d+)\/\+(\d+)/i);
  if (anthem) abilities.push({ type: 'static', filter: { controller: 'you', type: 'Creature', ...( /^other/i.test(anthem[0]) ? { other: true } : {} ) }, effect: { power: Number(anthem[1]), toughness: Number(anthem[2]) } });
  const equipped = text.match(/equipped creature gets \+(\d+)\/\+(\d+)/i);
  if (equipped) abilities.push({ type: 'static', filter: { attachedToSource: true }, effect: { power: Number(equipped[1]), toughness: Number(equipped[2]) } });
  const enchanted = text.match(/enchanted creature (?:gets|has) \+(\d+)\/\+(\d+)/i);
  if (enchanted) abilities.push({ type: 'static', filter: { attachedToSource: true }, effect: { power: Number(enchanted[1]), toughness: Number(enchanted[2]) } });
  const equipCost = text.match(/equip\s+((?:\{[^}]+\})+)/i);
  if (equipCost) abilities.push({ type: 'activated', cost: { mana: equipCost[1] }, sorcerySpeed: true, targets: { kind: 'permanent', type: 'Creature', controller: 'you' }, effect: { type: 'attachEquipment' } });

  const enters = text.match(/when (?:this (?:creature|artifact|enchantment)|[^\n.]+) enters,?\s*([^\n]+)/i);
  if (enters) {
    const effects = simpleEffects(enters[1]);
    if (effects.length) abilities.push({ type: 'triggered', event: 'ENTER_BATTLEFIELD', condition: { sourceEvent: true }, effect: effects.length === 1 ? effects[0] : { type: 'sequence', effects } });
  }
  const attack = text.match(/whenever (?:this creature|[^\n.]+) attacks,?\s*([^\n]+)/i);
  if (attack) {
    const effects = simpleEffects(attack[1]);
    if (effects.length) abilities.push({ type: 'triggered', event: 'CREATURE_ATTACKED', condition: { sourceEvent: true }, effect: effects.length === 1 ? effects[0] : { type: 'sequence', effects } });
  }
  const combatDraw = /whenever (?:this creature|[^\n.]+) deals combat damage to a player[^\n]*draw a card/i.test(text);
  if (combatDraw) abilities.push({ type: 'triggered', event: 'COMBAT_DAMAGE_PLAYER', condition: { sourceEvent: true }, effect: { type: 'draw', amount: 1 } });
  const anotherEnters = text.match(/whenever another [^\n.]* enters,?\s*([^\n]+)/i);
  if (anotherEnters) {
    const effects = simpleEffects(anotherEnters[1]);
    if (effects.length) abilities.push({ type: 'triggered', event: 'ENTER_BATTLEFIELD', condition: { controllerEvent: true, notSelfEvent: true }, effect: effects.length === 1 ? effects[0] : { type: 'sequence', effects } });
  }
  const upkeep = text.match(/at the beginning of your upkeep,?\s*([^\n]+)/i);
  if (upkeep) {
    const effects = simpleEffects(upkeep[1]);
    if (effects.length) abilities.push({ type: 'triggered', event: 'PHASE_BEGIN', condition: { controllerEvent: true, phase: 'UPKEEP' }, effect: effects.length === 1 ? effects[0] : { type: 'sequence', effects } });
  }
  const endStep = text.match(/at the beginning of your end step,?\s*([^\n]+)/i);
  if (endStep) {
    const effects = simpleEffects(endStep[1]);
    if (effects.length) abilities.push({ type: 'triggered', event: 'END_STEP', condition: { controllerEvent: true }, effect: effects.length === 1 ? effects[0] : { type: 'sequence', effects } });
  }

  if (/Basic Land/i.test(cardTypeLine) && !abilities.some(ability => ability.type === 'mana')) {
    const symbol = cardTypeLine.match(/Plains|Island|Swamp|Mountain|Forest/i)?.[0]?.toLowerCase();
    const basicColor = { plains: 'W', island: 'U', swamp: 'B', mountain: 'R', forest: 'G' }[symbol];
    if (basicColor) abilities.push({ type: 'mana', mana: { [basicColor]: 1 } });
  }
  if ((card.keywords || []).some(keyword => String(keyword).toLowerCase() === 'myriad') || /\bmyriad\b/i.test(text)) {
    abilities.push({ type: 'triggered', event: 'CREATURE_ATTACKED', condition: { sourceEvent: true }, effect: { type: 'myriad' } });
  }
  if (/twice that many (?:of those )?tokens|creates? twice that many/i.test(text)) abilities.push({ type: 'replacement', event: 'TOKEN_CREATED', effect: 'double' });
  if (/put that many plus one of each of those kinds of counters/i.test(text)) abilities.push({ type: 'replacement', event: 'COUNTERS_ADDED', effect: 'addOne', filter: { controller: 'you' } });

  for (const lineText of text.split('\n')) {
    const activated = lineText.match(/^((?:\{[^}]+\}(?:, )?)+):\s*(.+)$/);
    if (!activated || /add \{?[WUBRGC]/i.test(activated[2])) continue;
    const effects = simpleEffects(activated[2]);
    if (!effects.length) continue;
    const symbols = [...activated[1].matchAll(/\{([^}]+)\}/g)].map(match => match[1]);
    const tap = symbols.includes('T');
    const costSymbols = symbols.filter(symbol => symbol !== 'T').map(symbol => `{${symbol}}`).join('');
    abilities.push({ type: 'activated', ...(costSymbols ? { cost: { mana: costSymbols } } : {}), ...(tap ? { tap: true } : {}), effect: effects.length === 1 ? effects[0] : { type: 'sequence', effects } });
  }
  return abilities;
}

function applyCommanderRules(definition) {
  if (definition.name === 'Ertai Resurrected') {
    definition.targets = { kind: 'spellOrPermanent' };
    definition.minTargets = 0;
    definition.maxTargets = 1;
    definition.onEnterEffects = [{ type: 'ertaiCounterOrDestroy' }];
  }
  if (definition.name === 'Myojin of Blooming Dawn') {
    definition.entersWithCounters = { counter: 'indestructible', amount: 1 };
    definition.abilities = [
      { type: 'static', filter: { self: true }, when: { sourceCounterMin: 1, counterType: 'indestructible' }, effect: { keyword: 'indestructible' } },
      { type: 'activated', cost: { removeCounterSelf: { counter: 'indestructible', amount: 1 } }, effect: { type: 'createSpiritsPerPermanent' } }
    ];
  }
  if (definition.name === 'Stangg, Echo Warrior') {
    definition.abilities.push({ type: 'triggered', event: 'CREATURE_ATTACKED', condition: { sourceEvent: true }, effect: { type: 'stanggTwin' } });
  }
  if (definition.name === 'Inspirit, Flagship Vessel') {
    definition.creatureAtCounter = { counter: 'charge', amount: 8 };
    definition.power = 8;
    definition.toughness = 8;
    definition.abilities = [
      { type: 'activated', sorcerySpeed: true, selection: { count: 1, other: true, type: 'Creature' }, effect: { type: 'stationCharge' } },
      { type: 'triggered', event: 'BEGIN_COMBAT', condition: { controllerEvent: true, sourceCounterAtLeast: { counter: 'charge', amount: 1 } }, targets: { kind: 'permanent', type: 'Artifact', controller: 'you' }, minTargets: 0, maxTargets: 1, effect: { type: 'addCounter', counter: 'charge', amount: 2 } },
      { type: 'static', filter: { self: true }, when: { sourceCounterMin: 8, counterType: 'charge' }, effect: { keyword: 'flying' } },
      { type: 'static', filter: { controller: 'you', other: true, type: 'Artifact' }, when: { sourceCounterMin: 8, counterType: 'charge' }, effect: { keywords: ['hexproof','indestructible'] } }
    ];
  }
  if (definition.name === 'The Beamtown Bullies') {
    definition.abilities = [
      { type: 'activated', tap: true, targets: [
        { kind: 'player', controller: 'opponent' },
        { kind: 'card', zone: 'graveyard', type: 'Creature', ownerFromTargetIndex: 0 }
      ], effect: { type: 'bulliesDonate' } }
    ];
  }
}

function normalizeCard(card, id) {
  const face = card.front || card;
  const text = oracleText(card);
  const line = typeLine(card);
  const permanent = !/\b(?:Instant|Sorcery)\b/i.test(line);
  const spellEffects = permanent ? [] : simpleEffects(text, { spell: true });
  const definition = {
    id,
    name: card.name,
    typeLine: line,
    manaCost: manaCost(card),
    manaValue: Number(card.front ? card.front.castingCost?.filter?.(part => part !== '/').length || card.cmc : card.cmc || 0),
    power: face.power === '' || face.power == null || Number.isNaN(Number(face.power)) ? null : Number(face.power),
    toughness: face.toughness === '' || face.toughness == null || Number.isNaN(Number(face.toughness)) ? null : Number(face.toughness),
    subtypes: [...(face.subTypes || [])],
    keywords: [...new Set((card.keywords || []).map(keyword => String(keyword).toLowerCase()).filter(keyword => SUPPORTED_KEYWORDS.includes(keyword)))],
    abilities: inferredAbilities(card, text, line),
    spellEffects,
    producedMana: null,
    colorIdentity: (card.colorIdentity || []).map(color => COLOR[color]).filter(Boolean),
    oracleText: text,
    image: card.uid ? `https://cards.scryfall.io/normal/front/${card.uid[0]}/${card.uid[1]}/${card.uid}.jpg` : '',
    scryfallId: card.uid || null,
    legalities: { commander: 'legal' },
    supported: true,
    source: `Archidekt printing ${card.setCode || ''} ${card.collectorNumber || ''}`.trim()
  };
  const targets = targetSpec(text, spellEffects);
  if (targets) definition.targets = targets;
  if (/— Aura\b/i.test(line) && /enchant (?:creature|permanent)/i.test(text)) {
    definition.targets = { kind: 'permanent', ...( /enchant creature/i.test(text) ? { type: 'Creature' } : {}), ...( /you control/i.test(text.split('\n')[0]) ? { controller: 'you' } : {} ) };
  }
  if (/enters tapped\./i.test(text)) definition.entersTapped = true;
  const entryCounters = text.match(/enters with (\d+|one|two|three|four|five|six|seven|eight|nine|ten) \+1\/\+1 counters?/i);
  if (entryCounters) definition.entersWithCounters = { counter: '+1/+1', amount: numericWord(entryCounters[1]) };
  applyCommanderRules(definition);
  return definition;
}

const selected = readJson(ARCHIDEKT_FILE);
const categoryConfig = readJson(CATEGORY_FILE);
const cards = readJson(CARDS_FILE);
const decks = readJson(DECKS_FILE).filter(deck => !selected.some(item => item.slug === deck.id));
const nameToId = new Map(Object.values(cards).map(card => [card.name.toLowerCase(), card.id]));

for (const item of selected) {
  const main = mainDeckCards(item.payload.cards, categoryConfig[item.slug]);
  const total = main.reduce((sum, card) => sum + Number(card.qty || 0), 0);
  if (total !== 100) throw new Error(`${item.payload.name} has ${total} main-deck cards after excluding sideboard/maybeboard entries.`);
  const commanderCards = main.filter(card => (card.categories || []).includes('Commander'));
  if (commanderCards.length !== 1) throw new Error(`${item.payload.name} must have exactly one commander; found ${commanderCards.map(card => card.name).join(', ')}.`);

  const entryQuantities = new Map();
  for (const card of main) {
    let id = nameToId.get(card.name.toLowerCase());
    if (!id) {
      id = `arch-${slug(card.name)}`;
      let suffix = 2;
      while (cards[id] && cards[id].name !== card.name) id = `arch-${slug(card.name)}-${suffix++}`;
      cards[id] = normalizeCard(card, id);
      nameToId.set(card.name.toLowerCase(), id);
    } else if (id.startsWith('arch-')) {
      cards[id] = normalizeCard(card, id);
    } else if (['Ertai Resurrected','Myojin of Blooming Dawn','Stangg, Echo Warrior','Inspirit, Flagship Vessel','The Beamtown Bullies'].includes(card.name)) {
      applyCommanderRules(cards[id]);
    }
    entryQuantities.set(id, (entryQuantities.get(id) || 0) + Number(card.qty));
  }

  const commanderId = nameToId.get(commanderCards[0].name.toLowerCase());
  const identity = cards[commanderId].colorIdentity;
  decks.push({
    id: item.slug,
    name: item.payload.name,
    format: 'Commander',
    commander: commanderId,
    colorIdentity: identity,
    playable: true,
    cardCount: 100,
    source: item.url,
    notes: `Imported from Archidekt. Creator: ${item.payload.owner}. Public deck ${item.payload.id}; bracket ${item.payload.bracket ?? 'unrated'}. Main deck is exact as retrieved; sideboard and maybeboard entries are excluded.`,
    cards: [...entryQuantities].map(([id, quantity]) => ({ id, quantity }))
  });
}

writeJson(CARDS_FILE, cards);
writeJson(DECKS_FILE, decks);
console.log(`Imported ${selected.length} Archidekt decks. Card database now contains ${Object.keys(cards).length} cards; deck database contains ${decks.length} decks.`);
