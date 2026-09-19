import { validateCommanderSelection, normalizeCommanderIds } from '../multiplayer/CommanderRules.js';
import { validateCompanionRestriction } from './CompanionRules.js';

const COLORS = Object.freeze(['W', 'U', 'B', 'R', 'G']);
function totalCards(deck = {}) { return (deck.cards || []).reduce((sum, entry) => sum + Number(entry.quantity || 0), 0); }
function unique(values = []) { return [...new Set(values.filter(Boolean))]; }
function isBasicLand(def = {}) { return /\bBasic\b/i.test(def.typeLine || '') && /\bLand\b/i.test(def.typeLine || ''); }
function hasUnlimitedCopies(def = {}) { return /A deck can have any number of cards named/i.test(def.oracleText || '') || def.deckLimit === 'any'; }
function normalizedCompanionId(deck = {}) { return typeof deck.companion === 'string' ? deck.companion : deck.companion?.id || deck.companionId || null; }

export class FormatValidator {
  constructor(db = {}, {
    format = 'Commander',
    minimumDeckSize = 100,
    exactDeckSize = 100,
    singleton = true,
    bannedCardIds = [],
    restrictedCardIds = [],
    bannedListVersion = 'project-config'
  } = {}) {
    this.db = db;
    this.rules = { format, minimumDeckSize, exactDeckSize, singleton, bannedCardIds: new Set(bannedCardIds), restrictedCardIds: new Set(restrictedCardIds), bannedListVersion };
  }

  validate(deck = {}, { throwOnError = false } = {}) {
    const errors = [];
    const warnings = [];
    const commander = validateCommanderSelection(deck, this.db, { requireColorIdentityMatch: true });
    if (!commander.ok) errors.push(...commander.errors);

    if (String(deck.format || this.rules.format).toLowerCase() !== String(this.rules.format).toLowerCase()) {
      errors.push(`Deck format ${deck.format || 'unspecified'} does not match ${this.rules.format}.`);
    }

    const count = totalCards(deck);
    const companionId = normalizedCompanionId(deck);
    const companion = companionId ? this.db[companionId] : null;
    const yorion = /yorion, sky nomad/i.test(companion?.name || '');
    const minimum = yorion ? Math.max(120, this.rules.minimumDeckSize) : this.rules.minimumDeckSize;
    const exact = yorion ? null : this.rules.exactDeckSize;
    if (exact != null && count !== exact) errors.push(`${this.rules.format} decks must contain exactly ${exact} cards including commander(s); found ${count}.`);
    else if (count < minimum) errors.push(`${this.rules.format} deck must contain at least ${minimum} cards; found ${count}.`);

    const commanderIds = new Set(normalizeCommanderIds(deck));
    const countsById = new Map();
    for (const entry of deck.cards || []) {
      const qty = Number(entry.quantity || 0);
      if (!entry.id || !Number.isInteger(qty) || qty < 1) {
        errors.push(`Invalid deck entry ${entry.id || '(missing id)'} ×${entry.quantity}.`);
        continue;
      }
      countsById.set(entry.id, (countsById.get(entry.id) || 0) + qty);
      const def = this.db[entry.id];
      if (!def) {
        errors.push(`Unresolved card ${entry.id}.`);
        continue;
      }
      if (this.rules.bannedCardIds.has(entry.id) || ['banned', 'not_legal'].includes(def.legalities?.commander)) errors.push(`${def.name || entry.id} is not legal in Commander under the configured banned-list source.`);
      if (this.rules.restrictedCardIds.has(entry.id) && qty > 1) errors.push(`${def.name || entry.id} exceeds its configured restricted copy limit.`);
      const cardColors = unique(def.colorIdentity || []).filter(color => COLORS.includes(color));
      const allowed = new Set(commander.colorIdentity || []);
      if (cardColors.some(color => !allowed.has(color))) errors.push(`${def.name || entry.id} has color identity outside the commander's color identity.`);
      if (this.rules.singleton && qty > 1 && !isBasicLand(def) && !hasUnlimitedCopies(def)) errors.push(`${def.name || entry.id} violates Commander singleton deck construction (${qty} copies).`);
    }

    for (const id of commanderIds) {
      if ((countsById.get(id) || 0) !== 1) errors.push(`Designated commander ${this.db[id]?.name || id} must appear exactly once in the 100-card deck list.`);
    }

    if (companionId) {
      if (!companion) errors.push(`Unresolved companion ${companionId}.`);
      else {
        const allowed = new Set(commander.colorIdentity || []);
        const outside = (companion.colorIdentity || []).filter(color => !allowed.has(color));
        if (outside.length) errors.push(`${companion.name} has color identity outside the commander's color identity.`);
        const companionErrors = validateCompanionRestriction(companion, deck, this.db);
        errors.push(...companionErrors.map(message => `Companion restriction: ${message}`));
      }
    }

    const result = Object.freeze({
      ok: errors.length === 0,
      format: this.rules.format,
      deckId: deck.id || null,
      cardCount: count,
      commanderIds: Object.freeze([...commanderIds]),
      companionId,
      colorIdentity: Object.freeze([...(commander.colorIdentity || [])]),
      bannedListVersion: this.rules.bannedListVersion,
      errors: Object.freeze(errors),
      warnings: Object.freeze(warnings)
    });
    if (throwOnError && errors.length) throw new Error(`Illegal ${this.rules.format} deck ${deck.name || deck.id || ''}:\n- ${errors.join('\n- ')}`);
    return result;
  }
}
