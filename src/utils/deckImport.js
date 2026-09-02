const SECTION_LABELS = new Set(['deck', 'main deck', 'maindeck', 'commander', 'sideboard']);

export function normalizeCardName(value = '') {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function cardLookup(db) {
  const lookup = new Map();
  for (const [id, def] of Object.entries(db || {})) {
    for (const displayName of [def?.name || id, ...(def?.aliases || [])]) {
      const key = normalizeCardName(displayName);
      if (!lookup.has(key) || lookup.get(key).def?.supported === false) lookup.set(key, { id, def });
    }
  }
  return lookup;
}

export function cardNameCandidates(value) {
  const candidates = [String(value).trim()];
  const add = candidate => {
    const normalized = String(candidate || '').trim();
    if (normalized && !candidates.includes(normalized)) candidates.push(normalized);
  };

  // Common export/mass-entry decorations, e.g. "Sol Ring [CMM] 396"
  // or Archidekt's "Sol Ring (cmm) 396 [Ramp]". Exact matching remains first.
  for (const current of [...candidates]) add(current.replace(/\s+\[[^\]\r\n]+\]\s*$/, ''));
  for (const current of [...candidates]) {
    add(current.replace(/\s+\[[A-Z0-9]{2,8}\](?:\s+[#A-Z0-9-]+)?\s*$/i, ''));
    add(current.replace(/\s+\([A-Z0-9]{2,8}\)(?:\s+[#A-Z0-9-]+)?\s*$/i, ''));
  }
  return candidates;
}

function resolveCard(rawName, lookup) {
  for (const candidate of cardNameCandidates(rawName)) {
    const found = lookup.get(normalizeCardName(candidate));
    if (found) return found;
  }
  return null;
}

export function importableCardName(rawName) {
  return cardNameCandidates(String(rawName || '').trim().replace(/^\d+\s*x?\s+/i, '')).at(-1) || '';
}

export function parseMassEntry(text) {
  const entries = [];
  const errors = [];

  String(text || '').split(/\r?\n/).forEach((sourceLine, index) => {
    const line = sourceLine.trim();
    if (!line || SECTION_LABELS.has(normalizeCardName(line))) return;

    const match = line.match(/^(\d+)\s*x?\s+(.+?)\s*$/i);
    if (!match) {
      errors.push(`Line ${index + 1}: use the format “1 Card Name”.`);
      return;
    }

    const quantity = Number(match[1]);
    const name = match[2].trim();
    if (!Number.isInteger(quantity) || quantity < 1) errors.push(`Line ${index + 1}: quantity must be at least 1.`);
    else if (!name) errors.push(`Line ${index + 1}: card name is missing.`);
    else entries.push({ quantity, name, line: index + 1 });
  });

  return { entries, errors, count: entries.reduce((total, entry) => total + entry.quantity, 0) };
}

const SUPPORTED_KEYWORDS = ['flying','reach','vigilance','trample','lifelink','deathtouch','haste','first strike','double strike','menace','hexproof','indestructible','islandwalk','flash'];
const NUMBER_WORD = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

function numericWord(value, fallback = 1) {
  if (/^\d+$/.test(String(value))) return Number(value);
  return NUMBER_WORD[String(value || '').toLowerCase()] ?? fallback;
}

function fetchedFaces(card) { return card.card_faces?.length ? card.card_faces : [card]; }
function fetchedOracle(card) { return fetchedFaces(card).map(face => face.oracle_text || '').filter(Boolean).join('\n//\n'); }

function keywordList(text) {
  const lower = String(text || '').toLowerCase();
  return SUPPORTED_KEYWORDS.filter(keyword => new RegExp(`\\b${keyword.replace(' ', '\\s+')}\\b`, 'i').test(lower));
}

function fetchedTokenEffect(text) {
  const match = String(text).match(/create (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) (\d+)\/(\d+) ([^.;]+?) creature tokens?/i);
  if (!match) return null;
  const descriptor = match[4].replace(/\b(?:white|blue|black|red|green|colorless)\b/ig, '').trim();
  const subtype = descriptor.split(/\s+/).at(-1)?.replace(/[^A-Za-z'-]/g, '') || 'Creature';
  return { type: 'createToken', amount: numericWord(match[1]), token: { name: `${subtype} Token`, typeLine: `Token Creature — ${subtype}`, subtypes: [subtype], power: Number(match[2]), toughness: Number(match[3]), keywords: [], abilities: [] } };
}

function fetchedEffects(text, { spell = false } = {}) {
  const effects = [];
  const draw = String(text).match(/draw (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?/i);
  if (draw) effects.push({ type: 'draw', amount: numericWord(draw[1]) });
  const gain = String(text).match(/you gain (\d+) life/i);
  if (gain) effects.push({ type: 'gainLife', amount: Number(gain[1]) });
  const token = fetchedTokenEffect(text);
  if (token) effects.push(token);
  if (/\bproliferate\b/i.test(text)) effects.push({ type: 'proliferate' });
  if (spell && /counter target .*spell/i.test(text)) effects.push({ type: 'counterSpell' });
  if (spell && /destroy target/i.test(text)) effects.push({ type: 'destroy' });
  if (spell && /exile target/i.test(text)) effects.push({ type: 'exile' });
  if (spell && /return target .* to (?:its|their) owner'?s hand/i.test(text)) effects.push({ type: 'returnToHand' });
  const damage = String(text).match(/deals? (\d+) damage to (?:any|target)/i);
  if (spell && damage) effects.push({ type: 'damage', amount: Number(damage[1]) });
  if (/search your library for (?:a|up to one) basic land/i.test(text)) effects.push({ type: 'searchBasic', destination: /onto the battlefield/i.test(text) ? 'battlefield' : 'hand' });
  const teamKeywords = String(text).match(/creatures you control (?:gain|have) ([^.]+?)(?: until end of turn)?\./i);
  if (spell && teamKeywords) {
    const keywords = keywordList(teamKeywords[1]);
    if (keywords.length) effects.push({ type: 'pump', filter: { controller: 'you', type: 'Creature' }, keywords });
  }
  return effects;
}

function fetchedTarget(text, effects) {
  if (effects.some(effect => effect.type === 'counterSpell')) return { kind: 'spell', zone: 'stack' };
  if (!effects.some(effect => ['destroy','exile','returnToHand','damage'].includes(effect.type))) return null;
  if (/any target/i.test(text)) return { kind: 'playerOrPermanent' };
  if (/target (?:nonland )?permanent/i.test(text)) return { kind: 'permanent', ...(/target nonland/i.test(text) ? { nonland: true } : {}) };
  const type = ['creature','artifact','enchantment','planeswalker'].find(value => new RegExp(`target [^.;]*${value}`, 'i').test(text));
  return { kind: 'permanent', ...(type ? { type: type[0].toUpperCase() + type.slice(1) } : {}) };
}

function fetchedManaAbilities(card, text, typeLine) {
  const basic = typeLine.match(/Basic Land — (Plains|Island|Swamp|Mountain|Forest)/i)?.[1]?.toLowerCase();
  const basicColor = { plains: 'W', island: 'U', swamp: 'B', mountain: 'R', forest: 'G' }[basic];
  if (basicColor) return [{ type: 'mana', mana: { [basicColor]: 1 } }];
  if (/add one mana of any color/i.test(text)) return [{ type: 'mana', anyColor: true, colors: ['W','U','B','R','G'], amount: 1 }];
  const symbols = [...String(text).matchAll(/Add ((?:\{[WUBRGC]\})+)/g)].flatMap(match => [...match[1].matchAll(/\{([WUBRGC])\}/g)].map(part => part[1]));
  if (symbols.length) {
    const colors = [...new Set(symbols)];
    if (colors.length > 1) return [{ type: 'mana', anyColor: true, colors, amount: 1 }];
    return [{ type: 'mana', mana: { [colors[0]]: symbols.length } }];
  }
  if (/\bLand\b/i.test(typeLine)) {
    const colors = card.color_identity || [];
    return [colors.length ? { type: 'mana', anyColor: true, colors, amount: 1 } : { type: 'mana', mana: { C: 1 } }];
  }
  return [];
}

function fetchedAbilities(card, text, typeLine) {
  const abilities = fetchedManaAbilities(card, text, typeLine);
  if (/you have no maximum hand size/i.test(text)) abilities.push({ type: 'static', effect: { noMaximumHandSize: true } });
  for (const sentence of String(text).split(/(?<=\.)\s+|\n/)) {
    const global = sentence.match(/^(Other )?creatures you control (?:have|gain) (.+?)(?:\.| until end of turn)/i);
    if (global && !/until end of turn/i.test(sentence)) {
      const keywords = keywordList(global[2]);
      if (keywords.length) abilities.push({ type: 'static', filter: { controller: 'you', type: 'Creature', ...(global[1] ? { other: true } : {}) }, effect: { keywords } });
    }
  }
  const anthem = String(text).match(/(?:other )?creatures you control get \+(\d+)\/\+(\d+)/i);
  if (anthem) abilities.push({ type: 'static', filter: { controller: 'you', type: 'Creature', ...(/^other/i.test(anthem[0]) ? { other: true } : {}) }, effect: { power: Number(anthem[1]), toughness: Number(anthem[2]) } });
  const enters = String(text).match(/when (?:this [^,.]+|[^\n.]+) enters,?\s*([^\n]+)/i);
  if (enters) {
    const effects = fetchedEffects(enters[1]);
    if (effects.length) abilities.push({ type: 'triggered', event: 'ENTER_BATTLEFIELD', condition: { sourceEvent: true }, effect: effects.length === 1 ? effects[0] : { type: 'sequence', effects } });
  }
  return abilities;
}

function customCardId(card) {
  const slug = String(card.name || 'card').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  return `custom-scryfall-${slug}-${String(card.oracle_id || card.id || '').slice(0, 8)}`;
}

export function normalizeFetchedCard(card, requestedName = card?.name) {
  const face = fetchedFaces(card)[0] || card;
  const text = fetchedOracle(card);
  const typeLine = card.type_line || face.type_line || '';
  const id = customCardId(card);
  const permanent = !/\b(?:Instant|Sorcery)\b/i.test(typeLine);
  const spellEffects = permanent ? [] : fetchedEffects(text, { spell: true });
  const definition = {
    id, name: card.name, aliases: [...new Set([requestedName, ...(card.card_faces || []).map(item => item.name)].filter(Boolean))],
    typeLine, manaCost: card.mana_cost || face.mana_cost || '', manaValue: Number(card.cmc || 0),
    power: /^-?\d+$/.test(String(face.power ?? '')) ? Number(face.power) : null,
    toughness: /^-?\d+$/.test(String(face.toughness ?? '')) ? Number(face.toughness) : null,
    subtypes: typeLine.split('—')[1]?.split('//')[0]?.trim().split(/\s+/).filter(Boolean) || [],
    colors: [...(card.colors || face.colors || [])], colorIdentity: [...(card.color_identity || [])],
    keywords: [...new Set((card.keywords || []).map(value => String(value).toLowerCase()).filter(value => SUPPORTED_KEYWORDS.includes(value)))],
    abilities: fetchedAbilities(card, text, typeLine), spellEffects, oracleText: text,
    image: card.image_uris?.normal || face.image_uris?.normal || '', scryfallId: card.id || null,
    legalities: card.legalities || {}, supported: true, genericImported: true, source: 'Scryfall custom-deck import'
  };
  const target = fetchedTarget(text, spellEffects);
  if (target) definition.targets = target;
  if (/enters tapped/i.test(text)) definition.entersTapped = true;
  return definition;
}

export async function fetchMissingCardDefinitions(rawNames, db, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('Card lookup is unavailable in this browser.');
  const lookup = cardLookup(db);
  const missing = [...new Set(rawNames.map(importableCardName).filter(name => name && !resolveCard(name, lookup)))];
  if (!missing.length) return {};
  const definitions = {};
  const foundNames = new Set();
  for (let index = 0; index < missing.length; index += 75) {
    const requested = missing.slice(index, index + 75);
    let response;
    try {
      response = await fetchImpl('https://api.scryfall.com/cards/collection', {
        method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'MTGAITrainer/3.0 (+local educational deck trainer)' },
        body: JSON.stringify({ identifiers: requested.map(name => ({ name: name.split(' // ')[0] })) })
      });
    } catch (error) {
      throw new Error(`Could not download missing card data. Check your internet connection and try again. (${error.message})`);
    }
    if (!response.ok) throw new Error(`Card lookup failed with HTTP ${response.status}. Please try again.`);
    const payload = await response.json();
    for (const card of payload.data || []) {
      const aliases = [card.name, ...(card.card_faces || []).map(face => face.name)];
      const requestedName = requested.find(name => aliases.some(alias => normalizeCardName(alias) === normalizeCardName(name))) || card.name;
      const definition = normalizeFetchedCard(card, requestedName);
      definitions[definition.id] = definition;
      for (const alias of definition.aliases) foundNames.add(normalizeCardName(alias));
      foundNames.add(normalizeCardName(definition.name));
    }
    for (const notFound of payload.not_found || []) foundNames.delete(normalizeCardName(notFound.name));
  }
  const resolvedLookup = cardLookup({ ...db, ...definitions });
  const unresolved = missing.filter(name => !resolveCard(name, resolvedLookup));
  if (unresolved.length) throw new Error(`These card names could not be found:\n${unresolved.slice(0, 8).join('\n')}${unresolved.length > 8 ? `\n…and ${unresolved.length - 8} more` : ''}`);
  return definitions;
}

function maxCommanderCopies(def) {
  if (/\bbasic land\b/i.test(def?.typeLine || '')) return Infinity;
  const text = def?.oracleText || '';
  if (/deck can have any number of cards named/i.test(text)) return Infinity;
  const numeric = text.match(/deck can have up to (\d+) cards named/i);
  if (numeric) return Number(numeric[1]);
  return 1;
}

export function buildCustomDeck({ name, commander, list }, db, existingDecks = []) {
  const deckName = String(name || '').trim();
  if (!deckName) throw new Error('Enter a deck name.');

  const lookup = cardLookup(db);
  const commanderText = String(commander || '').trim().replace(/^\d+\s*x?\s+/i, '');
  if (!commanderText) throw new Error('Enter your commander.');
  const commanderCard = resolveCard(commanderText, lookup);
  if (!commanderCard) throw new Error(`Commander not found in the local card database: ${commanderText}`);
  if (commanderCard.def?.supported === false) throw new Error(`${commanderCard.def.name} is in the database, but its mechanics are not yet supported by the trainer.`);

  const parsed = parseMassEntry(list);
  if (parsed.errors.length) throw new Error(parsed.errors.slice(0, 5).join('\n'));
  if (parsed.count !== 99) throw new Error(`The main deck must contain exactly 99 cards. Your pasted list contains ${parsed.count}.`);

  const combined = new Map();
  const unknown = [];
  const unsupported = [];
  for (const entry of parsed.entries) {
    const found = resolveCard(entry.name, lookup);
    if (!found) {
      unknown.push(`${entry.name} (line ${entry.line})`);
      continue;
    }
    if (found.def?.supported === false) {
      unsupported.push(found.def.name);
      continue;
    }
    const current = combined.get(found.id) || { id: found.id, quantity: 0, def: found.def };
    current.quantity += entry.quantity;
    combined.set(found.id, current);
  }

  if (unknown.length) throw new Error(`These cards are not in the local card database:\n${unknown.slice(0, 8).join('\n')}${unknown.length > 8 ? `\n…and ${unknown.length - 8} more` : ''}`);
  if (unsupported.length) throw new Error(`These cards are not yet supported by the trainer:\n${[...new Set(unsupported)].slice(0, 8).join('\n')}`);
  if (combined.has(commanderCard.id)) throw new Error('Do not include the commander in the 99-card main-deck list.');

  const duplicateErrors = [];
  for (const entry of combined.values()) {
    const max = maxCommanderCopies(entry.def);
    if (entry.quantity > max) duplicateErrors.push(`${entry.def.name}: ${entry.quantity} copies`);
  }
  if (duplicateErrors.length) throw new Error(`Commander decks normally allow one copy of each nonbasic card:\n${duplicateErrors.slice(0, 8).join('\n')}`);

  const commanderColors = new Set(commanderCard.def?.colorIdentity || []);
  const offColor = [...combined.values()].filter(entry => (entry.def?.colorIdentity || []).some(color => !commanderColors.has(color)));
  if (offColor.length) throw new Error(`These cards are outside ${commanderCard.def.name}’s color identity:\n${offColor.slice(0, 8).map(x => x.def.name).join('\n')}`);

  const cards = [{ id: commanderCard.id, quantity: 1 }, ...[...combined.values()].map(({ id, quantity }) => ({ id, quantity }))];
  const slug = deckName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 36) || 'deck';
  const existingIds = new Set(existingDecks.map(deck => deck.id));
  let id = `custom-${slug}`;
  let suffix = 2;
  while (existingIds.has(id)) id = `custom-${slug}-${suffix++}`;

  return {
    id,
    name: deckName,
    format: 'Commander',
    commander: commanderCard.id,
    colorIdentity: [...commanderColors],
    playable: true,
    custom: true,
    cards,
    cardCount: 100,
    notes: 'User-imported deck saved in this browser.'
  };
}
