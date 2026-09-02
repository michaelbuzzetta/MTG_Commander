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
    const key = normalizeCardName(def?.name || id);
    if (!lookup.has(key) || lookup.get(key).def?.supported === false) lookup.set(key, { id, def });
  }
  return lookup;
}

function stripTcgPlayerSuffix(value) {
  const candidates = [String(value).trim()];
  let current = candidates[0];

  // Common export/mass-entry decorations, e.g. "Sol Ring [CMM] 396"
  // or "Sol Ring (CMM) 396". Exact card-name matching is always tried first.
  for (const pattern of [
    /\s+\[[A-Z0-9]{2,8}\](?:\s+[#A-Z0-9-]+)?\s*$/i,
    /\s+\([A-Z0-9]{2,8}\)(?:\s+[#A-Z0-9-]+)?\s*$/i
  ]) {
    const stripped = current.replace(pattern, '').trim();
    if (stripped && stripped !== current) candidates.push(stripped);
  }
  return candidates;
}

function resolveCard(rawName, lookup) {
  for (const candidate of stripTcgPlayerSuffix(rawName)) {
    const found = lookup.get(normalizeCardName(candidate));
    if (found) return found;
  }
  return null;
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
