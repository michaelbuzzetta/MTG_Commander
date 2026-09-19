import { normalizeOracleText, oracleNumber } from './OracleTokenizer.js';

const HIGH = 'high';

function effect(op, fields = {}) { return { op, ...fields }; }
function spell(effectNode, targets = null) { return { type: 'spell', ...(targets ? { targets } : {}), effect: effectNode }; }
function trigger(event, effectNode, condition = null) {
  return { type: 'triggered', event, ...(condition ? { condition } : {}), effect: effectNode };
}
function activated(cost, effectNode, targets = null) {
  return { type: 'activated', cost, ...(targets ? { targets } : {}), effect: effectNode };
}

function targetSelector(description = '') {
  const raw = String(description).trim().toLowerCase();
  let controller = null;
  let base = raw;
  if (base.endsWith(' you control')) { controller = 'you'; base = base.slice(0, -12).trim(); }
  if (base.endsWith(' an opponent controls')) { controller = 'opponent'; base = base.slice(0, -21).trim(); }
  const withController = selector => controller ? { ...selector, controller } : selector;
  if (base === 'creature') return withController({ kind: 'permanent', type: 'Creature' });
  if (base === 'permanent') return withController({ kind: 'permanent' });
  if (base === 'nonland permanent') return withController({ kind: 'permanent', nonland: true });
  if (base === 'artifact') return withController({ kind: 'permanent', type: 'Artifact' });
  if (base === 'land') return withController({ kind: 'permanent', type: 'Land' });
  if (base === 'enchantment') return withController({ kind: 'permanent', type: 'Enchantment' });
  if (base === 'artifact or enchantment') return withController({ kind: 'permanent', types: ['Artifact', 'Enchantment'] });
  if (base === 'artifact or creature') return withController({ kind: 'permanent', types: ['Artifact', 'Creature'] });
  if (base === 'creature or planeswalker') return withController({ kind: 'permanent', types: ['Creature', 'Planeswalker'] });
  if (base === 'nonblack creature') return withController({ and: [{ kind: 'permanent', type: 'Creature' }, { not: { color: 'B' } }] });
  return null;
}

function quantityToken(raw) {
  const amount = oracleNumber(raw);
  return Number.isInteger(amount) && amount >= 0 ? amount : null;
}

function selfEtbPrefix(text) {
  return text.match(/^When this (creature|artifact|enchantment|permanent|land) enters(?: the battlefield)?,\s*/i);
}

function template(id, description, matcher) {
  return Object.freeze({ id, description, confidence: HIGH, match: matcher });
}

const SIMPLE_KEYWORD_NAMES = Object.freeze(new Map([
  ['flying', 'flying'],
  ['reach', 'reach'],
  ['first strike', 'first strike'],
  ['double strike', 'double strike'],
  ['deathtouch', 'deathtouch'],
  ['trample', 'trample'],
  ['vigilance', 'vigilance'],
  ['lifelink', 'lifelink'],
  ['haste', 'haste'],
  ['hexproof', 'hexproof'],
  ['menace', 'menace'],
  ['indestructible', 'indestructible'],
  ['flash', 'flash'],
  ['defender', 'defender'],
  ['plainswalk', 'plainswalk'],
  ['islandwalk', 'islandwalk'],
  ['swampwalk', 'swampwalk'],
  ['mountainwalk', 'mountainwalk'],
  ['forestwalk', 'forestwalk'],
  ['prowess', 'prowess'],
  ['exalted', 'exalted'],
  ['infect', 'infect'],
  ['wither', 'wither'],
  ['shroud', 'shroud'],
  ['fear', 'fear'],
  ['intimidate', 'intimidate'],
  ['horsemanship', 'horsemanship'],
  ['shadow', 'shadow']
]));

const KNOWN_KEYWORD_REMINDERS = Object.freeze([
  /\s*\(This creature can't be blocked except by creatures with flying or reach\.\)/gi,
  /\s*\(This creature can block creatures with flying\.\)/gi,
  /\s*\(This creature deals combat damage before creatures without first strike\.\)/gi,
  /\s*\(This creature deals both first-strike and regular combat damage\.\)/gi,
  /\s*\(Any amount of damage this deals to a creature is enough to destroy it\.\)/gi,
  /\s*\(This creature can deal excess combat damage to the player or planeswalker it's attacking\.\)/gi,
  /\s*\(This creature can deal excess combat damage to the player it's attacking\.\)/gi,
  /\s*\(Attacking doesn't cause this creature to tap\.\)/gi,
  /\s*\(Damage dealt by this creature also causes you to gain that much life\.\)/gi,
  /\s*\(This creature can attack and \{T\} as soon as it comes under your control\.\)/gi,
  /\s*\(This creature can't be the target of spells or abilities your opponents control\.\)/gi,
  /\s*\(This creature can't be blocked except by two or more creatures\.\)/gi,
  /\s*\(Damage and effects that say \"destroy\" don't destroy this creature\.\)/gi,
  /\s*\(You may cast this spell any time you could cast an instant\.\)/gi,
  /\s*\(This creature can't attack\.\)/gi,
  /\s*\(Whenever you cast a noncreature spell, this creature gets \+1\/\+1 until end of turn\.\)/gi,
  /\s*\(Whenever a creature you control attacks alone, that creature gets \+1\/\+1 until end of turn\.\)/gi,
  /\s*\(This creature deals damage to creatures in the form of -1\/-1 counters and to players in the form of poison counters\.\)/gi,
  /\s*\(This deals damage to creatures in the form of -1\/-1 counters\.\)/gi,
  /\s*\(This creature can't be the target of spells or abilities\.\)/gi,
  /\s*\(This creature can't be blocked except by artifact creatures and\/or black creatures\.\)/gi,
  /\s*\(This creature can't be blocked except by artifact creatures and\/or creatures that share a color with it\.\)/gi,
  /\s*\(This creature can't be blocked except by creatures with horsemanship\.\)/gi,
  /\s*\(This creature can block or be blocked by only creatures with shadow\.\)/gi,
  /\s*\(This creature can't be blocked as long as defending player controls a Plains\.\)/gi,
  /\s*\(This creature can't be blocked as long as defending player controls an Island\.\)/gi,
  /\s*\(This creature can't be blocked as long as defending player controls a Swamp\.\)/gi,
  /\s*\(This creature can't be blocked as long as defending player controls a Mountain\.\)/gi,
  /\s*\(This creature can't be blocked as long as defending player controls a Forest\.\)/gi
]);

function simpleKeywordOnlyText(text, card) {
  if (!(card?.keywords || []).length) return null;
  let cleaned = String(text || '');
  for (const reminder of KNOWN_KEYWORD_REMINDERS) cleaned = cleaned.replace(reminder, '');
  const parts = cleaned.replace(/\n/g, ',').split(',').map(part => part.trim().toLowerCase()).filter(Boolean);
  if (!parts.length || parts.some(part => !SIMPLE_KEYWORD_NAMES.has(part))) return null;
  const parsed = [...new Set(parts.map(part => SIMPLE_KEYWORD_NAMES.get(part)))].sort();
  const declared = [...new Set((card?.keywords || []).map(value => String(value).trim().toLowerCase()).filter(value => value !== 'landwalk'))].sort();
  if (parsed.length !== declared.length || parsed.some((value, index) => value !== declared[index])) return null;
  return parsed;
}

const TEMPLATES = [
  template('card.vanilla-creature', 'A normal creature with no rules text has no executable abilities beyond its copiable characteristics.', ({ text, card }) => {
    if (text !== '' || card?.layout !== 'normal' || !String(card?.typeLine || '').includes('Creature') || (card?.keywords || []).length) return null;
    return { ast: { type: 'card', abilities: [] } };
  }),

  template('card.keyword-only', 'One or more exact generic keywords whose semantics are implemented by the reusable mechanic engine.', ({ text, card }) => {
    const keywords = simpleKeywordOnlyText(text, card);
    return keywords ? { ast: { type: 'card', abilities: [] }, metadata: { keywords } } : null;
  }),

  template('spell.draw-fixed', 'Draw a fixed number of cards.', ({ text }) => {
    const m = text.match(/^Draw (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?\.$/i);
    const amount = m && quantityToken(m[1]);
    return amount == null ? null : { ast: { type: 'card', abilities: [spell(effect('draw', { amount }))] } };
  }),

  template('spell.destroy-target', 'Destroy one target matching a supported selector.', ({ text }) => {
    const m = text.match(/^Destroy target (.+)\.$/i);
    if (!m) return null;
    const targets = targetSelector(m[1]);
    return targets ? { ast: { type: 'card', abilities: [spell(effect('destroy'), targets)] } } : null;
  }),

  template('spell.exile-target', 'Exile one target matching a supported selector.', ({ text }) => {
    const m = text.match(/^Exile target (.+)\.$/i);
    if (!m) return null;
    const targets = targetSelector(m[1]);
    return targets ? { ast: { type: 'card', abilities: [spell(effect('exile'), targets)] } } : null;
  }),

  template('spell.pump-until-eot', 'Give a target creature a fixed power/toughness change until end of turn.', ({ text }) => {
    const m = text.match(/^Target (creature(?: you control| an opponent controls)?) gets ([+-]\d+)\/([+-]\d+) until end of turn\.$/i);
    if (!m) return null;
    const targets = targetSelector(m[1]);
    return targets ? { ast: { type: 'card', abilities: [spell(effect('modifyCharacteristics', { power: Number(m[2]), toughness: Number(m[3]), duration: 'until-end-of-turn' }), targets)] } } : null;
  }),

  template('spell.damage-any-target', 'Deal a fixed amount of damage to any target.', ({ text, card }) => {
    const names = ['This spell', card?.name].filter(Boolean).map(name => String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!names.length) return null;
    const m = text.match(new RegExp(`^(?:${names.join('|')}) deals (a|one|two|three|four|five|six|seven|eight|nine|ten|\\d+) damage to any target\\.$`, 'i'));
    const amount = m && quantityToken(m[1]);
    return amount == null ? null : {
      ast: { type: 'card', abilities: [spell(effect('damage', { amount }), { kind: 'playerOrPermanent', types: ['Creature', 'Planeswalker', 'Battle'] })] }
    };
  }),

  template('spell.search-basic-land', 'Search for a basic land, move it to the battlefield, then shuffle.', ({ text }) => {
    const m = text.match(/^Search your library for (?:a|one) basic land card, put (?:it|that card) onto the battlefield( tapped)?, then shuffle\.$/i);
    if (!m) return null;
    return { ast: { type: 'card', abilities: [spell(effect('search', { basicOnly: true, max: 1, toZone: 'battlefield', tapped: !!m[1], shuffle: true }))] } };
  }),

  template('spell.create-common-token', 'Create a fixed number of Treasure, Clue, or Food tokens.', ({ text }) => {
    const m = text.match(/^Create (a|an|one|two|three|four|five|six|\d+) (Treasure|Clue|Food) tokens?\.$/i);
    const amount = m && quantityToken(m[1]);
    if (amount == null) return null;
    const name = m[2][0].toUpperCase() + m[2].slice(1).toLowerCase();
    return { ast: { type: 'card', abilities: [spell(effect('createToken', { token: { name }, amount }))] } };
  }),

  template('trigger.etb-gain-life', 'Gain a fixed amount of life when this permanent enters.', ({ text }) => {
    const prefix = selfEtbPrefix(text);
    if (!prefix) return null;
    const rest = text.slice(prefix[0].length);
    const m = rest.match(/^you gain (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) life\.$/i);
    const amount = m && quantityToken(m[1]);
    if (amount == null) return null;
    return { ast: { type: 'card', abilities: [trigger('ENTER_BATTLEFIELD', effect('gainLife', { amount }), { controllerEvent: true, sourceEvent: true })] } };
  }),

  template('trigger.etb-draw-fixed', 'Draw a fixed number of cards when this permanent enters.', ({ text }) => {
    const prefix = selfEtbPrefix(text);
    if (!prefix) return null;
    const rest = text.slice(prefix[0].length);
    const m = rest.match(/^draw (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?\.$/i);
    const amount = m && quantityToken(m[1]);
    if (amount == null) return null;
    return { ast: { type: 'card', abilities: [trigger('ENTER_BATTLEFIELD', effect('draw', { amount }), { controllerEvent: true, sourceEvent: true })] } };
  }),

  template('trigger.etb-create-common-token', 'Create common utility tokens when this permanent enters.', ({ text }) => {
    const prefix = selfEtbPrefix(text);
    if (!prefix) return null;
    const rest = text.slice(prefix[0].length);
    const m = rest.match(/^create (a|an|one|two|three|four|five|six|\d+) (Treasure|Clue|Food) tokens?\.(?: \(It's an artifact with \"\{T\}, Sacrifice this token: Add one mana of any color\.\"\))?$/i);
    const amount = m && quantityToken(m[1]);
    if (amount == null) return null;
    const name = m[2][0].toUpperCase() + m[2].slice(1).toLowerCase();
    return { ast: { type: 'card', abilities: [trigger('ENTER_BATTLEFIELD', effect('createToken', { token: { name }, amount }), { controllerEvent: true, sourceEvent: true })] } };
  }),

  template('trigger.etb-plus-counter', 'Put fixed +1/+1 counters on this permanent when it enters.', ({ text }) => {
    const prefix = selfEtbPrefix(text);
    if (!prefix) return null;
    const rest = text.slice(prefix[0].length);
    const m = rest.match(/^put (a|one|two|three|four|five|six|\d+) \+1\/\+1 counters? on (?:it|this creature|this permanent)\.$/i);
    const amount = m && quantityToken(m[1]);
    if (amount == null) return null;
    return { ast: { type: 'card', abilities: [trigger('ENTER_BATTLEFIELD', effect('addCounter', { source: true, counter: '+1/+1', amount }), { controllerEvent: true, sourceEvent: true })] } };
  }),

  template('trigger.etb-target-plus-counter', 'Put fixed +1/+1 counters on a target creature when this permanent enters.', ({ text }) => {
    const prefix = selfEtbPrefix(text);
    if (!prefix) return null;
    const rest = text.slice(prefix[0].length);
    const m = rest.match(/^put (a|one|two|three|four|five|six|\d+) \+1\/\+1 counters? on target creature\.$/i);
    const amount = m && quantityToken(m[1]);
    if (amount == null) return null;
    return { ast: { type: 'card', abilities: [{ ...trigger('ENTER_BATTLEFIELD', effect('addCounter', { counter: '+1/+1', amount }), { controllerEvent: true, sourceEvent: true }), targets: { kind: 'permanent', type: 'Creature' } }] } };
  }),

  template('trigger.etb-destroy-artifact', 'Destroy target artifact when this permanent enters.', ({ text }) => {
    const prefix = selfEtbPrefix(text);
    if (!prefix || text.slice(prefix[0].length).toLowerCase() !== 'destroy target artifact.') return null;
    return { ast: { type: 'card', abilities: [{ ...trigger('ENTER_BATTLEFIELD', effect('destroy'), { controllerEvent: true, sourceEvent: true }), targets: { kind: 'permanent', type: 'Artifact' } }] } };
  }),

  template('trigger.etb-damage-any-target', 'Deal a fixed amount of damage to any target when this permanent enters.', ({ text, card }) => {
    const prefix = selfEtbPrefix(text);
    if (!prefix) return null;
    const escapedName = String(card?.name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!escapedName) return null;
    const rest = text.slice(prefix[0].length);
    const m = rest.match(new RegExp(`^${escapedName} deals (a|one|two|three|four|five|six|seven|eight|nine|ten|\\d+) damage to any target\\.$`, 'i'));
    const amount = m && quantityToken(m[1]);
    if (amount == null) return null;
    return { ast: { type: 'card', abilities: [{ ...trigger('ENTER_BATTLEFIELD', effect('damage', { amount }), { controllerEvent: true, sourceEvent: true }), targets: { kind: 'playerOrPermanent', types: ['Creature', 'Planeswalker', 'Battle'] } }] } };
  }),

  template('trigger.dies-draw-one', 'Draw a card when this creature dies.', ({ text, card }) => {
    if (!text.startsWith('When ')) return null;
    const escapedName = String(card?.name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!escapedName) return null;
    if (!new RegExp(`^When ${escapedName} dies, draw a card\\.$`, 'i').test(text) && !/^When this creature dies, draw a card\.$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [trigger('CREATURE_DIED', effect('draw', { amount: 1 }), { controllerEvent: true, sourceEvent: true })] } };
  }),

  template('trigger.combat-damage-player-draw-one', 'Draw a card when this creature deals combat damage to a player.', ({ text, card }) => {
    if (!text.startsWith('Whenever ')) return null;
    const escapedName = String(card?.name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!escapedName) return null;
    const named = new RegExp(`^Whenever ${escapedName} deals combat damage to a player, draw a card\\.$`, 'i');
    if (!named.test(text) && !/^Whenever this creature deals combat damage to a player, draw a card\.$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [trigger('COMBAT_DAMAGE_PLAYER', effect('draw', { amount: 1 }), { controllerEvent: true, sourceEvent: true })] } };
  }),

  template('spell.destroy-target-tapped-creature', 'Destroy target tapped creature.', ({ text }) => {
    if (!/^Destroy target tapped creature\.$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [spell(effect('destroy'), { kind: 'permanent', type: 'Creature', tapped: true })] } };
  }),

  template('spell.counter-target-creature-spell', 'Counter target creature spell.', ({ text }) => {
    if (!/^Counter target creature spell\.$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [spell(effect('counter'), { kind: 'spell', zone: 'stack', type: 'Creature' })] } };
  }),

  template('card.keyword-plus-etb-draw-one', 'Exact simple keyword line plus an ETB draw-one trigger.', ({ text, card }) => {
    const lines = text.split('\n');
    if (lines.length !== 2 || !/^When this (?:creature|artifact|enchantment|permanent) enters(?: the battlefield)?, draw a card\.$/i.test(lines[1])) return null;
    const keywords = simpleKeywordOnlyText(lines[0], { ...card, oracleText: lines[0] });
    if (!keywords) return null;
    return { ast: { type: 'card', abilities: [trigger('ENTER_BATTLEFIELD', effect('draw', { amount: 1 }), { controllerEvent: true, sourceEvent: true })] } };
  }),

  template('card.keyword-plus-dies-draw-one', 'Exact simple keyword line plus a dies draw-one trigger.', ({ text, card }) => {
    const lines = text.split('\n');
    if (lines.length !== 2 || !/^When this creature dies, draw a card\.$/i.test(lines[1])) return null;
    const keywords = simpleKeywordOnlyText(lines[0], { ...card, oracleText: lines[0] });
    if (!keywords) return null;
    return { ast: { type: 'card', abilities: [trigger('CREATURE_DIED', effect('draw', { amount: 1 }), { controllerEvent: true, sourceEvent: true })] } };
  }),

  template('activated.tap-damage-any-target', 'Tap this permanent to deal one damage to any target.', ({ text }) => {
    if (!/^\{T\}: This (?:creature|artifact) deals 1 damage to any target\.$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [activated({ tap: true }, effect('damage', { amount: 1 }), { kind: 'playerOrPermanent', types: ['Creature', 'Planeswalker', 'Battle'] })] } };
  }),

  template('activated.white-tap-target-creature', 'Pay white and tap this permanent to tap target creature.', ({ text }) => {
    if (!/^\{W\}, \{T\}: Tap target creature\.$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [activated({ mana: '{W}', tap: true }, effect('tap'), { kind: 'permanent', type: 'Creature' })] } };
  }),

  template('activated.tap-gain-one-life', 'Tap this permanent to gain one life.', ({ text }) => {
    if (!/^\{T\}: You gain 1 life\.$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [activated({ tap: true }, effect('gainLife', { amount: 1 }))] } };
  }),

  template('spell.reanimate-target-creature', 'Return target creature card from your graveyard to the battlefield.', ({ text }) => {
    if (!/^Return target creature card from your graveyard to the battlefield\.$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [spell(effect('moveZone', { toZone: 'battlefield' }), { kind: 'card', zone: 'graveyard', owner: 'you', type: 'Creature' })] } };
  }),

  template('trigger.cast-type-plus-counter', 'Put a +1/+1 counter on this creature after casting a simple permanent-type spell.', ({ text }) => {
    const m = text.match(/^Whenever you cast a (creature|artifact|enchantment) spell, put (a|one|two|three|\d+) \+1\/\+1 counters? on this creature\.$/i);
    const amount = m && quantityToken(m[2]);
    if (amount == null) return null;
    const cardType = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
    return { ast: { type: 'card', abilities: [trigger('SPELL_CAST', effect('addCounter', { source: true, counter: '+1/+1', amount }), { controllerEvent: true, cardType })] } };
  })
];

export class OracleTemplateLibrary {
  constructor(templates = TEMPLATES) { this.templates = [...templates]; }
  list() { return this.templates.map(({ id, description, confidence }) => ({ id, description, confidence })); }
  match(card = {}) {
    const text = normalizeOracleText(card.oracleText || '');
    const matches = [];
    for (const entry of this.templates) {
      const result = entry.match({ card, text });
      if (result) matches.push({ templateId: entry.id, confidence: entry.confidence, description: entry.description, ...result });
    }
    return matches;
  }
}

export const ORACLE_TEMPLATE_IDS = Object.freeze(TEMPLATES.map(item => item.id));
