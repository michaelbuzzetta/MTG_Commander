const COLORS = Object.freeze(['W', 'U', 'B', 'R', 'G']);

function cleanText(value = '') { return String(value || '').replace(/\r/g, '').trim(); }
function lower(value = '') { return cleanText(value).toLowerCase(); }
function unique(values = []) { return [...new Set(values.filter(Boolean))]; }

export function normalizeCommanderIds(deck = {}) {
  const fromPair = Array.isArray(deck.commanders) ? deck.commanders : [];
  const ids = fromPair.length ? fromPair : (deck.commander ? [deck.commander] : []);
  return unique(ids.map(value => typeof value === 'string' ? value : value?.id));
}

export function combinedCommanderColorIdentity(definitions = []) {
  const colors = new Set();
  for (const definition of definitions.filter(Boolean)) {
    for (const color of definition.colorIdentity || []) if (COLORS.includes(color)) colors.add(color);
  }
  return COLORS.filter(color => colors.has(color));
}

export function isLegendary(definition = {}) {
  return /(^|\s)Legendary(?:\s|—|-|$)/i.test(definition.typeLine || '');
}

export function isCreature(definition = {}) {
  return /(^|\s)Creature(?:\s|—|-|$)/i.test(definition.typeLine || '') || !!definition.creatureAtCounter;
}

export function isBackground(definition = {}) {
  return isLegendary(definition) && /(?:—|-|\s)\s*Background\b/i.test(definition.typeLine || '');
}

export function isDoctor(definition = {}) {
  if (!isLegendary(definition) || !isCreature(definition)) return false;
  const typeLine = definition.typeLine || '';
  const subtypePart = typeLine.split(/—| - /).slice(1).join(' ');
  return /\bDoctor\b/i.test(subtypePart);
}

export function isStandaloneCommanderDefinition(definition = {}) {
  const oracle = definition.oracleText || '';
  return /can be your commander/i.test(oracle) || (isLegendary(definition) && isCreature(definition));
}

function parsePartnerWith(definition = {}) {
  const explicit = definition.commanderPairing?.partnerWith || definition.partnerWith || null;
  if (explicit) return cleanText(explicit);
  const match = cleanText(definition.oracleText).match(/\bPartner with\s+([^\n(]+)/i);
  return match ? cleanText(match[1]).replace(/[.,;:]$/, '') : null;
}

function hasStandalonePartner(definition = {}) {
  if (definition.commanderPairing?.kind === 'partner') return true;
  const text = cleanText(definition.oracleText);
  // Strip Partner-with clauses before testing the standalone keyword.
  return /(^|\n)\s*Partner(?:\s*\(|\s*$)/im.test(text.replace(/Partner with[^\n]*/gi, ''));
}

function hasFriendsForever(definition = {}) {
  return definition.commanderPairing?.kind === 'friends-forever' || /\bFriends forever\b/i.test(definition.oracleText || '');
}

function choosesBackground(definition = {}) {
  return definition.commanderPairing?.kind === 'choose-background' || /\bChoose a Background\b/i.test(definition.oracleText || '');
}

function hasDoctorsCompanion(definition = {}) {
  return definition.commanderPairing?.kind === 'doctors-companion' || /\bDoctor['’]?s companion\b/i.test(definition.oracleText || '');
}

function pairingTags(definition = {}) {
  const tags = [
    ...(Array.isArray(definition.commanderPairing?.tags) ? definition.commanderPairing.tags : []),
    ...(Array.isArray(definition.pairingTags) ? definition.pairingTags : [])
  ];
  return unique(tags.map(value => lower(value)));
}

export function commanderPairingProfile(definition = {}) {
  return Object.freeze({
    name: cleanText(definition.name),
    standalonePartner: hasStandalonePartner(definition),
    partnerWith: parsePartnerWith(definition),
    friendsForever: hasFriendsForever(definition),
    chooseBackground: choosesBackground(definition),
    background: isBackground(definition),
    doctorsCompanion: hasDoctorsCompanion(definition),
    doctor: isDoctor(definition),
    tags: pairingTags(definition)
  });
}

export function validateCommanderPair(first = {}, second = {}) {
  const a = commanderPairingProfile(first);
  const b = commanderPairingProfile(second);
  const errors = [];
  let mechanic = null;

  if (a.standalonePartner && b.standalonePartner) mechanic = 'Partner';
  else if (a.partnerWith && b.partnerWith && lower(a.partnerWith) === lower(b.name) && lower(b.partnerWith) === lower(a.name)) mechanic = 'Partner with';
  else if (a.friendsForever && b.friendsForever) mechanic = 'Friends Forever';
  else if ((a.chooseBackground && b.background) || (b.chooseBackground && a.background)) mechanic = 'Choose a Background';
  else if ((a.doctorsCompanion && b.doctor) || (b.doctorsCompanion && a.doctor)) mechanic = "Doctor's companion";
  else {
    const sharedTag = a.tags.find(tag => b.tags.includes(tag));
    if (sharedTag) mechanic = `tag:${sharedTag}`;
  }

  if (!mechanic) errors.push(`${a.name || 'First commander'} and ${b.name || 'second commander'} do not have a supported paired-commander relationship.`);
  return Object.freeze({ ok: errors.length === 0, mechanic, errors, profiles: Object.freeze([a, b]) });
}

export function validateCommanderSelection(deck = {}, db = {}, { throwOnError = false, requireColorIdentityMatch = true } = {}) {
  const commanderIds = normalizeCommanderIds(deck);
  const errors = [];
  if (commanderIds.length < 1 || commanderIds.length > 2) errors.push(`Commander decks must designate one commander or one legal pair; found ${commanderIds.length}.`);
  const definitions = commanderIds.map(id => db[id] || null);
  commanderIds.forEach((id, index) => { if (!definitions[index]) errors.push(`Unresolved commander ${id}.`); });

  let pairing = null;
  if (!errors.length && commanderIds.length === 1 && !isStandaloneCommanderDefinition(definitions[0])) {
    errors.push(`${definitions[0].name || commanderIds[0]} is not a supported standalone commander.`);
  }
  if (!errors.length && commanderIds.length === 2) {
    pairing = validateCommanderPair(definitions[0], definitions[1]);
    if (!pairing.ok) errors.push(...pairing.errors);
  }

  const colorIdentity = combinedCommanderColorIdentity(definitions);
  if (requireColorIdentityMatch && Array.isArray(deck.colorIdentity)) {
    const supplied = COLORS.filter(color => new Set(deck.colorIdentity).has(color));
    if (supplied.length !== colorIdentity.length || supplied.some((color, index) => color !== colorIdentity[index])) {
      errors.push(`Deck color identity ${supplied.join('') || 'colorless'} must exactly match commander identity ${colorIdentity.join('') || 'colorless'}.`);
    }
  }

  const result = Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors), commanderIds: Object.freeze(commanderIds), definitions: Object.freeze(definitions), colorIdentity: Object.freeze(colorIdentity), pairing });
  if (throwOnError && errors.length) throw new Error(`Invalid Commander designation:\n- ${errors.join('\n- ')}`);
  return result;
}

export function commanderIdentityFor(card) {
  if (!card?.isCommander) return null;
  return card.commanderIdentity || card.instanceId || card.gameObjectId || null;
}

export class CommanderRulesService {
  constructor(engine) { this.engine = engine; this.ensureAllPlayers(); }

  ensureAllPlayers() {
    for (const playerId of this.engine.playerIds()) this.ensurePlayer(playerId);
  }

  ensurePlayer(playerId) {
    const player = this.engine.state.players[playerId];
    if (!player) throw new Error(`Unknown player ${playerId}`);
    player.commanderTaxLedger ||= {};
    player.commanderDamage ||= {};
    const commanders = this.commandersOwnedBy(playerId);
    for (const card of commanders) {
      const identity = commanderIdentityFor(card);
      if (!identity) continue;
      const existing = player.commanderTaxLedger[identity] || {};
      player.commanderTaxLedger[identity] = {
        commanderIdentity: identity,
        cardId: card.cardId,
        castsFromCommandZone: Math.max(0, Number(existing.castsFromCommandZone || 0)),
        tax: Math.max(0, Number(existing.tax ?? (Number(existing.castsFromCommandZone || 0) * 2)))
      };
    }
    this.#syncLegacyTax(playerId);
    return player;
  }

  commandersOwnedBy(playerId) {
    const player = this.engine.state.players[playerId];
    if (!player) return [];
    const cards = [];
    for (const zone of ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command']) {
      for (const card of player[zone] || []) if (card.isCommander && card.owner === playerId) cards.push(card);
    }
    for (const item of this.engine.state.stack || []) if (item.card?.isCommander && item.card.owner === playerId) cards.push(item.card);
    return cards;
  }

  identity(card) { return commanderIdentityFor(card); }

  taxFor(playerId, card, { zone = card?.zone } = {}) {
    if (!card?.isCommander || zone !== 'command') return 0;
    const player = this.ensurePlayer(playerId);
    const identity = commanderIdentityFor(card);
    const ledgerTax = Math.max(0, Number(player.commanderTaxLedger?.[identity]?.tax || 0));
    // The pre-Step-14 state exposed one scalar tax. Preserve old saved games and
    // test fixtures for single-commander decks without letting that scalar merge
    // the ledgers of a legal commander pair.
    const designated = Object.keys(player.commanderTaxLedger || {});
    if (designated.length <= 1) return Math.max(ledgerTax, Math.max(0, Number(player.commanderTax || 0)));
    return ledgerTax;
  }

  recordCast(playerId, card, { fromZone = card?.zone } = {}) {
    if (!card?.isCommander || fromZone !== 'command') return this.taxFor(playerId, card, { zone: fromZone });
    const player = this.ensurePlayer(playerId);
    const identity = commanderIdentityFor(card);
    if (!identity) throw new Error('Commander cast is missing persistent commander identity');
    const entry = player.commanderTaxLedger[identity] || { commanderIdentity: identity, cardId: card.cardId, castsFromCommandZone: 0, tax: 0 };
    entry.castsFromCommandZone = Math.max(0, Number(entry.castsFromCommandZone || 0)) + 1;
    entry.tax = entry.castsFromCommandZone * 2;
    player.commanderTaxLedger[identity] = entry;
    this.#syncLegacyTax(playerId);
    return entry.tax;
  }

  recordCombatDamage(targetPlayerId, source, amount) {
    return this.recordCombatDamageByIdentity(targetPlayerId, commanderIdentityFor(source), amount);
  }

  recordCombatDamageByIdentity(targetPlayerId, identity, amount) {
    const dealt = Math.max(0, Number(amount || 0));
    if (!identity || dealt <= 0) return 0;
    const player = this.engine.state.players[targetPlayerId];
    if (!player) throw new Error(`Unknown player ${targetPlayerId}`);
    player.commanderDamage ||= {};
    player.commanderDamage[identity] = Math.max(0, Number(player.commanderDamage[identity] || 0)) + dealt;
    return player.commanderDamage[identity];
  }

  taxLedger(playerId) {
    const player = this.ensurePlayer(playerId);
    return structuredClone(player.commanderTaxLedger || {});
  }

  damageMatrix() {
    return Object.fromEntries(this.engine.playerIds().map(playerId => [playerId, structuredClone(this.engine.state.players[playerId].commanderDamage || {})]));
  }

  #syncLegacyTax(playerId) {
    const player = this.engine.state.players[playerId];
    if (!player) return;
    const taxes = Object.values(player.commanderTaxLedger || {}).map(entry => Math.max(0, Number(entry.tax || 0)));
    const legacy = Math.max(0, Number(player.commanderTax || 0));
    if (taxes.length === 1) player.commanderTax = Math.max(legacy, taxes[0]);
    else if (taxes.length > 1) player.commanderTax = Math.max(...taxes);
    else player.commanderTax = legacy;
  }
}
