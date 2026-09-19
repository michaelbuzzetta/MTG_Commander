function lower(value = '') { return String(value || '').trim().toLowerCase(); }
function isLand(def = {}) { return /(^|\s)Land(?:\s|—|-|$)/i.test(def.typeLine || ''); }
function isPermanent(def = {}) { return /(Creature|Artifact|Enchantment|Planeswalker|Land|Battle)/i.test(def.typeLine || ''); }
function isCreature(def = {}) { return /(^|\s)Creature(?:\s|—|-|$)/i.test(def.typeLine || ''); }
function manaSymbols(cost = '') { return [...String(cost || '').matchAll(/\{([^}]+)\}/g)].map(match => match[1].toUpperCase()); }
function cardEntries(deck = {}, db = {}) {
  return (deck.cards || []).flatMap(entry => {
    const def = db[entry.id];
    return def ? [{ entry, def }] : [];
  });
}

function activatedAbilityExists(def = {}) {
  if ((def.abilities || []).some(ability => ['activated', 'mana'].includes(ability?.type))) return true;
  return /(^|\n)[^\n:]+:\s*/m.test(def.oracleText || '');
}

const STANDARD_COMPANION_RULES = Object.freeze({
  'gyruda, doom of depths': (deck, db) => cardEntries(deck, db).filter(({ def }) => Number(def.manaValue || 0) % 2 !== 0).map(({ def }) => `${def.name} has odd mana value.`),
  'jegantha, the wellspring': (deck, db) => cardEntries(deck, db).flatMap(({ def }) => {
    const seen = new Set();
    for (const symbol of manaSymbols(def.manaCost)) {
      if (['X', 'Y', 'Z'].includes(symbol) || /^\d+$/.test(symbol)) continue;
      if (seen.has(symbol)) return [`${def.name} repeats mana symbol {${symbol}} in its mana cost.`];
      seen.add(symbol);
    }
    return [];
  }),
  'kaheera, the orphanguard': (deck, db) => cardEntries(deck, db).filter(({ def }) => isCreature(def) && !/(Cat|Elemental|Nightmare|Dinosaur|Beast)/i.test(def.typeLine || '')).map(({ def }) => `${def.name} is not an allowed Kaheera creature type.`),
  'keruga, the macrosage': (deck, db) => cardEntries(deck, db).filter(({ def }) => !isLand(def) && Number(def.manaValue || 0) < 3).map(({ def }) => `${def.name} has mana value less than 3.`),
  'lurrus of the dream-den': (deck, db) => cardEntries(deck, db).filter(({ def }) => isPermanent(def) && !isLand(def) && Number(def.manaValue || 0) > 2).map(({ def }) => `${def.name} is a permanent card with mana value greater than 2.`),
  'lutri, the spellchaser': (deck) => {
    const names = new Map();
    for (const entry of deck.cards || []) names.set(entry.id, (names.get(entry.id) || 0) + Number(entry.quantity || 0));
    return [...names.entries()].filter(([, count]) => count > 1).map(([id]) => `${id} appears more than once.`);
  },
  'obosh, the preypiercer': (deck, db) => cardEntries(deck, db).filter(({ def }) => !isLand(def) && Number(def.manaValue || 0) % 2 !== 1).map(({ def }) => `${def.name} has even mana value.`),
  'umori, the collector': (deck, db) => {
    const chosenType = deck.companionChoice || deck.companionType || null;
    if (!chosenType) return ['Umori requires deck.companionChoice to name the shared nonland card type.'];
    return cardEntries(deck, db).filter(({ def }) => !isLand(def) && !new RegExp(`\\b${String(chosenType).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(def.typeLine || '')).map(({ def }) => `${def.name} does not have the chosen type ${chosenType}.`);
  },
  'yorion, sky nomad': (deck) => {
    const total = (deck.cards || []).reduce((sum, entry) => sum + Number(entry.quantity || 0), 0);
    return total >= 120 ? [] : [`Yorion requires at least 120 cards in a Commander starting deck; found ${total}.`];
  },
  'zirda, the dawnwaker': (deck, db) => cardEntries(deck, db).filter(({ def }) => isPermanent(def) && !isLand(def) && !activatedAbilityExists(def)).map(({ def }) => `${def.name} is a nonland permanent without an activated ability.`)
});

export function validateCompanionRestriction(companion, deck, db) {
  if (!companion) return [];
  if (companion.companionRestriction?.validate === false) return ['Companion restriction metadata marks this companion invalid.'];
  const custom = companion.companionRestriction;
  if (custom && Array.isArray(custom.errors)) return [...custom.errors];
  const rule = STANDARD_COMPANION_RULES[lower(companion.name)];
  if (!rule) {
    // Unknown companions remain explicit rather than silently assumed legal.
    return companion.oracleText && /\bCompanion\b/i.test(companion.oracleText)
      ? [`No Step 20 deck-building validator is registered for companion ${companion.name}.`]
      : [`${companion.name || 'The designated card'} does not expose a supported companion restriction.`];
  }
  return rule(deck, db);
}
