import { normalizeOracleText, oracleNumber } from './OracleTokenizer.js';

const HIGH = 'high';

function effect(op, fields = {}) { return { op, ...fields }; }
function spell(effectNode, targets = null, extra = {}) { return { type: 'spell', ...(targets ? { targets } : {}), ...extra, effect: effectNode }; }
function trigger(event, effectNode, condition = null, extra = {}) {
  return { type: 'triggered', event, ...(condition ? { condition } : {}), ...extra, effect: effectNode };
}
function activated(cost, effectNode, targets = null, extra = {}) {
  return { type: 'activated', cost, ...(targets ? { targets } : {}), ...extra, effect: effectNode };
}

function targetSelector(description = '') {
  const raw = String(description).trim().toLowerCase();
  let controller = null;
  let base = raw;
  if (base.endsWith(' you control')) { controller = 'you'; base = base.slice(0, -12).trim(); }
  if (base.endsWith(' an opponent controls')) { controller = 'opponent'; base = base.slice(0, -21).trim(); }
  const withController = selector => controller ? { ...selector, controller } : selector;
  if (base === 'player') return { kind: 'player' };
  if (base === 'opponent') return { kind: 'player', controller: 'opponent' };
  if (base === 'creature') return withController({ kind: 'permanent', type: 'Creature' });
  if (base === 'permanent') return withController({ kind: 'permanent' });
  if (base === 'nonland permanent') return withController({ kind: 'permanent', nonland: true });
  if (base === 'artifact') return withController({ kind: 'permanent', type: 'Artifact' });
  if (base === 'land') return withController({ kind: 'permanent', type: 'Land' });
  if (base === 'enchantment') return withController({ kind: 'permanent', type: 'Enchantment' });
  if (base === 'artifact or enchantment') return withController({ kind: 'permanent', types: ['Artifact', 'Enchantment'] });
  if (base === 'artifact or creature') return withController({ kind: 'permanent', types: ['Artifact', 'Creature'] });
  if (base === 'creature or planeswalker') return withController({ kind: 'permanent', types: ['Creature', 'Planeswalker'] });
  if (base === "creature you don't control") return { kind: 'permanent', type: 'Creature', controller: 'opponent' };
  if (base === 'nonblack creature') return withController({ and: [{ kind: 'permanent', type: 'Creature' }, { not: { color: 'B' } }] });
  return null;
}

function quantityToken(raw) {
  const amount = oracleNumber(raw);
  return Number.isInteger(amount) && amount >= 0 ? amount : null;
}

function selfEtbPrefix(text) {
  return text.match(/^When this (creature|artifact|enchantment|permanent|land|Aura|Equipment) enters(?: the battlefield)?,\s*/i);
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
  // Paragraph composition may inspect one keyword line from a card that has
  // additional keyword paragraphs. Every parsed keyword must be declared on
  // the card, but the paragraph does not need to enumerate the card's entire
  // keyword set. This remains fail-closed for unknown/non-keyword text.
  if (parsed.some(value => !declared.includes(value))) return null;
  return parsed;
}

function staticAbility(filter, effectNode, extra = {}) {
  return { type: 'static', filter, effect: effectNode, ...extra };
}

function replacementAbility(event, filter, replacement, extra = {}) {
  return { type: 'replacement', event, filter: filter || {}, replacement, ...extra };
}

function parseKeywordList(raw = '') {
  const parts = String(raw).toLowerCase().replace(/\band\b/g, ',').split(',').map(value => value.trim()).filter(Boolean);
  if (!parts.length || parts.some(value => !SIMPLE_KEYWORD_NAMES.has(value))) return null;
  return [...new Set(parts.map(value => SIMPLE_KEYWORD_NAMES.get(value)))];
}

function simpleControlCondition(raw, relation = 'controller') {
  const value = String(raw || '').trim().replace(/^(?:an?|one)\s+/i, '').trim();
  const lower = value.toLowerCase();
  const cardTypes = new Map([['creature','Creature'],['artifact','Artifact'],['enchantment','Enchantment'],['land','Land'],['planeswalker','Planeswalker'],['battle','Battle']]);
  const spec = cardTypes.has(lower) ? { type: cardTypes.get(lower), min: 1 } : (/^[A-Za-z][A-Za-z '-]*$/.test(value) ? { subtype: value, min: 1 } : null);
  if (!spec) return null;
  return relation === 'opponent' ? { opponentControls: spec } : { controllerControls: spec };
}

function simpleConditionalEffect(raw) {
  let m = String(raw || '').match(/^draw (a|one|two|three|four|five|\d+) cards?\.$/i);
  if (m) { const amount = quantityToken(m[1]); return amount == null ? null : effect('draw', { amount }); }
  m = String(raw || '').match(/^you gain (one|two|three|four|five|\d+) life\.$/i);
  if (m) { const amount = quantityToken(m[1]); return amount == null ? null : effect('gainLife', { amount }); }
  return null;
}

function simpleModalClause(raw) {
  const text = String(raw || '').trim().replace(/^•\s*/, '').replace(/^[^—\n]+—\s*/, '');
  let m = text.match(/^Draw (a|one|two|three|four|five|\d+) cards?\.?$/i);
  if (m) { const amount = quantityToken(m[1]); return amount == null ? null : { effect: effect('draw', { amount }) }; }
  m = text.match(/^You gain (one|two|three|four|five|\d+) life\.?$/i);
  if (m) { const amount = quantityToken(m[1]); return amount == null ? null : { effect: effect('gainLife', { amount }) }; }
  m = text.match(/^Target (creature|permanent|artifact|enchantment|opponent|player) gets ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i);
  if (m) { const targets = targetSelector(m[1]); return targets ? { targets, effect: effect('modifyCharacteristics', { power: Number(m[2]), toughness: Number(m[3]), duration: 'untilEndOfTurn' }) } : null; }
  m = text.match(/^Destroy target (creature|artifact|enchantment|nonland permanent)\.?$/i);
  if (m) { const targets = targetSelector(m[1]); return targets ? { targets, effect: effect('destroy') } : null; }
  m = text.match(/^Exile target (creature|artifact|enchantment|nonland permanent)\.?$/i);
  if (m) { const targets = targetSelector(m[1]); return targets ? { targets, effect: effect('exile') } : null; }
  if (/^Destroy target artifact or enchantment\.?$/i.test(text)) return { targets:{kind:'permanent',types:['Artifact','Enchantment']}, effect:effect('destroy') };
  let selfCounter = text.match(/^Put (a|one|two|three|four|five|\d+) \+1\/\+1 counters? on this creature\.?$/i);
  if (selfCounter) { const amount=quantityToken(selfCounter[1]); return { effect:effect('addCounter',{counter:'+1/+1',amount,target:'self'}) }; }
  if (/^This creature gains haste until end of turn\.?$/i.test(text)) return { effect:effect('grantAbility',{ability:'haste',target:'self',duration:'untilEndOfTurn'}) };
  if (/^Exile target card from a graveyard\.?$/i.test(text)) return { targets:{kind:'card',zone:'graveyard'}, effect:effect('exile') };
  if (/^Draw a card\.?$/i.test(text)) return { effect:effect('draw',{amount:1}) };
  let sc=text.match(/^Scry (one|two|three|four|five|\d+)\.?$/i); if(sc){const amount=quantityToken(sc[1]);return {effect:effect('scry',{amount})};}
  let sv=text.match(/^Surveil (one|two|three|four|five|\d+)(?:\. .*|\.)?$/i); if(sv){const amount=quantityToken(sv[1]);return {effect:effect('surveil',{amount})};}
  if (/^Discard a card, then draw a card\.?$/i.test(text)) return {effect:effect('sequence',{effects:[effect('discard',{amount:1,controller:'you'}),effect('draw',{amount:1})]})};
  let drain=text.match(/^Target opponent loses (one|two|three|four|five|\d+) life and you gain \1 life\.?$/i); if(drain){const amount=quantityToken(drain[1]);return {targets:{kind:'player',controller:'opponent'},effect:effect('sequence',{effects:[effect('loseLife',{amount,controller:'target'}),effect('gainLife',{amount})]})};}
  let tok=text.match(/^Create a 1\/1 (?:[a-z]+(?: and [a-z]+)? )?([A-Za-z]+) creature token(?: with (flying|menace|vigilance))?\.?$/i); if(tok){return {effect:effect('createToken',{token:{name:`${tok[1]} Token`,typeLine:`Token Creature — ${tok[1]}`,subtypes:[tok[1]],power:1,toughness:1,keywords:tok[2]?[tok[2].toLowerCase()]:[],abilities:[]},amount:1})};}

  if (/^Create a Treasure token(?:\. .*|\.)?$/i.test(text)) return { effect:effect('createToken',{token:'Treasure',amount:1}) };

  if (/^Return target creature to its owner's hand\.?$/i.test(text)) return { targets:{kind:'permanent',type:'Creature'}, effect:effect('moveZone',{toZone:'hand',owner:true}) };
  if (/^Return target creature card from your graveyard to your hand\.?$/i.test(text)) return { targets:{kind:'card',zone:'graveyard',controller:'you',type:'Creature'}, effect:effect('moveZone',{toZone:'hand',owner:true}) };
  if (/^Tap target creature\.?$/i.test(text)) return { targets:{kind:'permanent',type:'Creature'}, effect:effect('tap') };
  if (/^Untap target creature\.?$/i.test(text)) return { targets:{kind:'permanent',type:'Creature'}, effect:effect('untap') };
  if (/^Tap target nonland permanent\.?$/i.test(text)) return { targets:{kind:'permanent',nonland:true}, effect:effect('tap') };
  if (/^Untap target nonland permanent\.?$/i.test(text)) return { targets:{kind:'permanent',nonland:true}, effect:effect('untap') };
  if (/^Return target artifact or enchantment card from your graveyard to your hand\.?$/i.test(text)) return { targets:{kind:'card',zone:'graveyard',controller:'you',types:['Artifact','Enchantment']}, effect:effect('moveZone',{toZone:'hand',owner:true}) };
  if (/^Counter target spell\.?$/i.test(text)) return { targets:{kind:'spell'}, effect:effect('counterSpellTarget') };
  if (/^Target player discards a card\.?$/i.test(text)) return { targets:{kind:'player'}, effect:effect('discard',{amount:1,controller:'target'}) };
  if (/^Create a Treasure token\.?$/i.test(text)) return { effect:effect('createToken',{token:'Treasure',amount:1}) };
  if (/^Create a Food token\.?$/i.test(text)) return { effect:effect('createToken',{token:'Food',amount:1}) };
  if (/^Investigate\.?$/i.test(text)) return { effect:effect('createToken',{token:'Clue',amount:1}) };
  m=text.match(/^([A-Za-z][A-Za-z '-]*) deals (one|two|three|four|five|six|seven|eight|nine|ten|\d+) damage to any target\.?$/i);
  if(m){const amount=quantityToken(m[2]); return {targets:{kind:'any'},effect:effect('damage',{amount})};}
  m=text.match(/^([A-Za-z][A-Za-z '-]*) deals (one|two|three|four|five|six|seven|eight|nine|ten|\d+) damage to target creature\.?$/i);
  if(m){const amount=quantityToken(m[2]); return {targets:{kind:'permanent',type:'Creature'},effect:effect('damage',{amount})};}
  m=text.match(/^Create (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) (\d+)\/(\d+) ([A-Za-z]+) creature tokens?(?: with ([A-Za-z ,]+))?\.?$/i);
  if(m){const amount=quantityToken(m[1]); const keywords=m[5]?parseKeywordList(m[5]):[]; if(m[5]&&!keywords)return null; return {effect:effect('createToken',{token:{name:`${m[4]} Token`,typeLine:`Token Creature — ${m[4]}`,subtypes:[m[4]],power:Number(m[2]),toughness:Number(m[3]),keywords:keywords||[],abilities:[]},amount})};}
  m=text.match(/^Target creature gains ([A-Za-z ]+) until end of turn\.?$/i);
  if(m){const ks=parseKeywordList(m[1]); return ks?{targets:{kind:'permanent',type:'Creature'},effect:effect('grantAbility',{ability:ks.length===1?ks[0]:ks,duration:'untilEndOfTurn'})}:null;}
  m=text.match(/^Put (a|one|two|three|four|five|\d+) \+1\/\+1 counters? on target creature\.?$/i);
  if(m){const amount=quantityToken(m[1]); return {targets:{kind:'permanent',type:'Creature'},effect:effect('addCounter',{counter:'+1/+1',amount})};}
  m=text.match(/^Target opponent loses (one|two|three|four|five|\d+) life\.?$/i);
  if(m){const amount=quantityToken(m[1]); return {targets:{kind:'player',controller:'opponent'},effect:effect('loseLife',{amount,controller:'target'})};}
  return null;
}

function triggeredModalOracle(text) {
  const normalized = String(text || '').replace(/\r/g, '');
  const m = normalized.match(/^When this creature enters, choose one [—-]\s*\n([\s\S]+)$/i);
  if (!m) return null;
  const clauses = m[1].split(/\n\s*•\s*/).map(x => x.trim()).filter(Boolean);
  if (clauses.length < 2 || clauses.length > 5) return null;
  const parsed = clauses.map(simpleModalClause);
  if (parsed.some(x => !x)) return null;
  return parsed.map((row, i) => ({
    id: `mode-${i + 1}`, label: clauses[i].replace(/^[^—]+—\s*/, '').replace(/[.]$/, ''),
    ...(row.targets ? { targets: row.targets } : {}), effect: row.effect
  }));
}

function modalOracle(text) {
  const normalized = String(text || '').replace(/\r/g, '');
  const m = normalized.match(/^Choose (one|two|three|one or both|one or more)\s*[—-]\s*([\s\S]+)$/i);
  if (!m) return null;
  const clauses = m[2].split(/\n?\s*•\s*/).map(x => x.trim()).filter(Boolean);
  if (clauses.length < 2 || clauses.length > 5) return null;
  const parsed = clauses.map(simpleModalClause);
  if (parsed.some(x => !x)) return null;
  const phrase = m[1].toLowerCase();
  const choose = phrase === 'one' ? 1 : phrase === 'two' ? 2 : phrase === 'three' ? 3 : null;
  const combinations = [];
  const walk = (at, picked) => {
    if (picked.length && ((choose != null && picked.length === choose) || (phrase === 'one or both' && picked.length <= 2) || phrase === 'one or more')) combinations.push([...picked]);
    if ((choose != null && picked.length >= choose) || (phrase === 'one or both' && picked.length >= 2)) return;
    for (let i = at; i < parsed.length; i++) walk(i + 1, [...picked, i]);
  };
  walk(0, []);
  const exact = combinations.filter(indexes => choose == null || indexes.length === choose);
  return exact.map(indexes => {
    const rows = indexes.map(i => parsed[i]);
    const targetSpecs = rows.flatMap(row => row.targets ? [row.targets] : []);
    return {
      id: `modes-${indexes.map(i => i + 1).join('-')}`,
      label: indexes.map(i => clauses[i].replace(/[.]$/, '')).join(' / '),
      ...(targetSpecs.length ? { targets: targetSpecs, minTargets: targetSpecs.length, maxTargets: targetSpecs.length } : {}),
      effect: rows.length === 1 ? rows[0].effect : effect('sequence', { effects: rows.map(row => row.effect) })
    };
  });
}

const PHASE51_55_TEMPLATES = [
  template('mechanic.crew', 'Crew N selects any number of untapped creatures with sufficient combined power and taps them as the activation cost.', ({ text }) => {
    const m = text.match(/^Crew (\d+)(?:\s*\([^)]*\))?$/i);
    if (!m) return null;
    const rating = Number(m[1]);
    return { ast: { type: 'card', abilities: [], cardPatch: { abilities: [{
      type: 'activated', cost: {}, selection: { type: 'Creature', minCount: 1, maxCount: 100, minCombinedPower: rating, tap: true },
      effect: { type: 'crewVehicle' }, scriptMetadata: { mechanic: 'crew', rating }
    }] } } };
  }),
  template('mechanic.read-ahead', 'Read Ahead marks a Saga for chosen-chapter entry.', ({ text }) => {
    if (!/^Read ahead(?:\s*\([^)]*\))?$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [], cardPatch: { readAhead: true } } };
  }),
  template('trigger.landfall-simple', 'Landfall-style land entry trigger with a simple payload.', ({ text }) => {
    const m = text.match(/^Whenever a land enters(?: the battlefield)? under your control, (.+)$/i);
    if (!m) return null;
    const payload = simpleConditionalEffect(m[1]);
    return payload ? { ast: { type: 'card', abilities: [trigger('ENTER_BATTLEFIELD', payload, { controllerEvent: true, cardType: 'Land' })] } } : null;
  }),
  template('trigger.cast-any-simple', 'Whenever you cast a spell with a simple payload.', ({ text }) => {
    const m = text.match(/^Whenever you cast a spell, (.+)$/i);
    if (!m) return null;
    const payload = simpleConditionalEffect(m[1]);
    return payload ? { ast: { type: 'card', abilities: [trigger('SPELL_CAST', payload, { controllerEvent: true })] } } : null;
  }),
  template('trigger.permanent-leaves-simple', 'Whenever another permanent you control leaves the battlefield with a simple payload.', ({ text }) => {
    const m = text.match(/^Whenever another permanent you control leaves the battlefield, (.+)$/i);
    if (!m) return null;
    const payload = simpleConditionalEffect(m[1]);
    return payload ? { ast: { type: 'card', abilities: [trigger('LEAVE_BATTLEFIELD', payload, { controllerEvent: true, other: true })] } } : null;
  })
];

const PHASE61_65_TEMPLATES = [
  template('continuous.loses-all-abilities', 'Remove all abilities from a supported permanent set in layer 6.', ({ text }) => {
    const m=text.match(/^(Creatures|Artifacts|Permanents) (?:your opponents control )?lose all abilities\.?$/i); if(!m)return null;
    return {ast:{type:'card',abilities:[staticAbility({kind:'permanent', ...(m[1].toLowerCase()==='creatures'?{type:'Creature'}:m[1].toLowerCase()==='artifacts'?{type:'Artifact'}:{})}, effect('continuous',{layer:6,transform:{removeAbilities:true}}))]}};
  }),
  template('continuous.becomes-base-pt', 'Set creature base power/toughness in layer 7b.', ({ text }) => {
    const m=text.match(/^Target creature becomes (\d+)\/(\d+) until end of turn\.?$/i); if(!m)return null;
    return {ast:{type:'card',abilities:[spell(effect('modifyCharacteristics',{setPower:Number(m[1]),setToughness:Number(m[2]),duration:'untilEndOfTurn'}),targetSelector('creature'))]}};
  }),
  template('keyword.basic-landcycling', 'Basic landcycling with a fixed mana cost.', ({ text }) => {
    const m=text.match(/^Basic landcycling ((?:\{[^}]+\})+)\s*(?:\([^)]*\))?$/i); if(!m)return null;
    return {ast:{type:'card',abilities:[activated({mana:m[1],discardSelf:true},effect('search',{filter:{type:'Land',supertype:'Basic'},destination:'hand'}),null,{sourceZones:['hand'],metadata:{mechanic:'basic landcycling'}})]}};
  })
];

const PHASE56_60_TEMPLATES = [
  template('casting.alternative-rather-than', 'Cast for a printed alternative mana cost rather than the mana cost.', ({ text }) => {
    const m = text.match(/^You may (?:cast|play) this (?:spell|card) (?:for|by paying) ((?:\{[^}]+\})+) rather than pay its mana cost\.?$/i);
    if (!m) return null;
    return { ast: { type: 'card', abilities: [], cardPatch: { castingOptions: [{ id: 'alternative', castOption: 'alternative', fromZone: 'hand', manaCost: m[1], alternative: true }] } } };
  }),
  template('casting.without-mana-cost', 'Permission to cast this spell without paying its mana cost.', ({ text }) => {
    if (!/^You may cast this (?:spell|card) without paying its mana cost\.?$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [], cardPatch: { castingOptions: [{ id: 'without-mana-cost', castOption: 'withoutManaCost', fromZone: 'hand', withoutManaCost: true }] } } };
  }),
  template('cost.activated-life', 'Activated ability with a fixed life payment.', ({ text }) => {
    const m = text.match(/^Pay (\d+) life:\s*(.+)$/i); if (!m) return null;
    const body = simpleConditionalEffect(m[2]);
    return body ? { ast: { type: 'card', abilities: [activated({ life: Number(m[1]) }, body)] } } : null;
  }),
  template('cost.activated-sacrifice-self', 'Activated ability that sacrifices this permanent as a cost.', ({ text }) => {
    const m = text.match(/^Sacrifice this (?:creature|artifact|permanent):\s*(.+)$/i); if (!m) return null;
    const body = simpleConditionalEffect(m[1]);
    return body ? { ast: { type: 'card', abilities: [activated({ sacrificeSelf: true }, body)] } } : null;
  }),
  template('replacement.draw-double', 'A declarative draw-doubling replacement effect.', ({ text }) => {
    if (!/^If you would draw (?:a|one) card, draw two cards instead\.?$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [{ type:'replacement', event:'DRAW_CARD', filter:{controller:'you'}, effect:{kind:'multiplyAmount',factor:2} }] } };
  })
];

const PHASE49_50_TEMPLATES = [
  template('keyword.kicker-mana', 'Kicker with a fixed mana additional cost.', ({ text }) => {
    const m = text.match(/^Kicker ((?:\{[^}]+\})+)\s*(?:\([^)]*\))?$/i);
    if (!m) return null;
    return { ast: { type: 'card', abilities: [], cardPatch: {
      kickerCost: m[1],
      castingOptions: [{ castOption: 'kicked', fromZone: 'hand', additionalManaCost: m[1], marksKicked: true }]
    } } };
  }),
  template('keyword.cycling-mana', 'Cycling with a fixed mana cost: pay the cost, discard this card, then draw a card.', ({ text }) => {
    const m = text.match(/^Cycling ((?:\{[^}]+\})+)\s*(?:\([^)]*\))?$/i);
    if (!m) return null;
    return { ast: { type: 'card', abilities: [activated(
      { mana: m[1], discardSelf: true }, effect('draw', { amount: 1 }), null,
      { sourceZones: ['hand'], metadata: { mechanic: 'cycling' } }
    )], cardPatch: { cyclingCost: m[1] } } };
  })
];

const PHASE37_38_TEMPLATES = [
  template('mana.tap-fixed', 'Tap this permanent to add one or more fixed mana symbols.', ({ text }) => {
    const m = text.match(/^\{T\}: Add ((?:\{[WUBRGC]\})+)\.$/i);
    if (!m) return null;
    const mana = {};
    for (const symbol of m[1].matchAll(/\{([WUBRGC])\}/gi)) mana[symbol[1].toUpperCase()] = (mana[symbol[1].toUpperCase()] || 0) + 1;
    return { ast: { type: 'card', abilities: [], cardPatch: { abilities: [{ type: 'mana', tap: true, mana }] } } };
  }),
  template('mana.tap-any-color', 'Tap this permanent to add one mana of any color.', ({ text }) => {
    if (!/^\{T\}: Add one mana of any color\.$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [], cardPatch: { abilities: [{ type: 'mana', tap: true, anyColor: true, colors: ['W','U','B','R','G'], amount: 1 }] } } };
  }),
  template('keyword.mixed-simple-ward-mana', 'Comma-separated reusable keywords plus parameterized mana Ward.', ({ text, card }) => {
    const m = text.match(/^(.+),\s*ward ((?:\{[^}]+\})+)\s*(?:\([^)]*\))?$/i);
    if (!m) return null;
    const keywords = parseKeywordList(m[1]);
    if (!keywords || !keywords.length || !((card?.keywords || []).map(k => String(k).toLowerCase()).includes('ward'))) return null;
    return { ast: { type: 'card', abilities: [], cardPatch: { wardCost: m[2] } }, metadata: { keywords } };
  }),
  template('keyword.ward-mana', 'Parameterized Ward backed by the targeting/ward stack implementation.', ({ text }) => {
    const m = text.match(/^Ward ((?:\{[^}]+\})+)\s*(?:\([^)]*\))?$/i);
    return m ? { ast: { type: 'card', abilities: [], cardPatch: { wardCost: m[1] } } } : null;
  }),
  template('keyword.convoke', 'Convoke backed by authoritative cost-payment mechanics.', ({ text }) => {
    return /^Convoke(?:\s*\([^)]*\))?$/i.test(text) ? { ast: { type: 'card', abilities: [] } } : null;
  }),
  template('keyword.changeling', 'Changeling backed by all-zone creature-subtype mechanics.', ({ text }) => {
    return /^Changeling(?:\s*\([^)]*\))?$/i.test(text) ? { ast: { type: 'card', abilities: [] } } : null;
  }),
  template('commander.partner', 'Standalone Partner backed by Commander deck-construction rules.', ({ text }) => {
    return /^Partner(?:\s*\([^)]*\))?$/i.test(text) ? { ast: { type: 'card', abilities: [] } } : null;
  })
];

const PHASE67_BROAD_TEMPLATES = [
  template('keyword.devoid', 'Devoid is represented by the card color/color-indicator characteristics and the reusable devoid mechanic.', ({ text }) => {
    return /^Devoid(?:\s*\([^)]*\))?$/i.test(text) ? { ast: { type: 'card', abilities: [], cardPatch: { devoid: true } } } : null;
  }),
  template('combat.cant-block-self', 'This creature cannot block.', ({ text, card }) => {
    const n=String(card?.name||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    return (/^This creature can't block\.$/i.test(text) || (n && new RegExp(`^${n} can't block\\.$`,'i').test(text))) ? { ast: { type:'card', abilities:[], cardPatch:{ cantBlock:true } } } : null;
  }),
  template('combat.cant-be-blocked-self', 'This creature cannot be blocked.', ({ text, card }) => {
    const n=String(card?.name||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    return (/^This creature can't be blocked\.$/i.test(text) || (n && new RegExp(`^${n} can't be blocked\\.$`,'i').test(text))) ? { ast: { type:'card', abilities:[], cardPatch:{ cantBeBlocked:true } } } : null;
  }),
  template('combat.must-attack-self', 'This creature attacks each combat if able.', ({ text }) => {
    return /^This creature attacks each combat if able\.$/i.test(text) ? { ast:{ type:'card', abilities:[], cardPatch:{ mustAttack:true } } } : null;
  }),
  template('mana.tap-two-colors', 'Tap this permanent to add one of two specified colors.', ({ text }) => {
    const m=text.match(/^\{T\}: Add \{([WUBRG])\} or \{([WUBRG])\}\.$/i); if(!m) return null;
    return { ast:{ type:'card', abilities:[], cardPatch:{ abilities:[{type:'mana',tap:true,colors:[m[1].toUpperCase(),m[2].toUpperCase()],amount:1}] } } };
  }),
  template('replacement.enters-plus-counters', 'This creature enters with a fixed number of +1/+1 counters.', ({ text }) => {
    const m=text.match(/^This creature enters with (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) \+1\/\+1 counters? on it\.$/i); const amount=m&&quantityToken(m[1]);
    return amount==null?null:{ast:{type:'card',abilities:[replacementAbility('ENTER_BATTLEFIELD',{self:true},{kind:'enterWithCounters',counter:'+1/+1',amount})]}};
  }),
  template('activated.firebreathing', 'Pay one colored mana to give this creature a fixed power/toughness modifier until end of turn.', ({ text }) => {
    const m=text.match(/^\{([WUBRG])\}: This creature gets ([+-]\d+)\/([+-]\d+) until end of turn\.$/i); if(!m)return null;
    return {ast:{type:'card',abilities:[activated({mana:`{${m[1].toUpperCase()}}`},effect('modifyCharacteristics',{power:Number(m[2]),toughness:Number(m[3]),duration:'untilEndOfTurn',target:'self'}))]}};
  }),
  template('spell.counter-target-spell', 'Counter target spell.', ({ text }) => {
    return /^Counter target spell\.$/i.test(text)?{ast:{type:'card',abilities:[spell(effect('counter'),{kind:'spell'})]}}:null;
  }),
  template('static.no-maximum-hand-size', 'Controller has no maximum hand size.', ({ text }) => {
    return /^You have no maximum hand size\.$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{noMaximumHandSize:true}}}:null;
  }),
];



// Phase 69 / Catalog Batch 1: reusable exact grammars for common Oracle
// trigger/effect families. These deliberately lower only to primitives already
// executed by the authoritative rules engine; unknown clauses still fail closed.
function phase69SimplePayload(raw = '') {
  const text = String(raw || '').trim();
  let m;
  if ((m=text.match(/^draw (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?\.?$/i))) { const amount=quantityToken(m[1]); return amount==null?null:{effect:effect('draw',{amount})}; }
  if ((m=text.match(/^you gain (one|two|three|four|five|six|seven|eight|nine|ten|\d+) life\.?$/i))) { const amount=quantityToken(m[1]); return amount==null?null:{effect:effect('gainLife',{amount})}; }
  if ((m=text.match(/^you lose (one|two|three|four|five|six|seven|eight|nine|ten|\d+) life\.?$/i))) { const amount=quantityToken(m[1]); return amount==null?null:{effect:effect('loseLife',{amount})}; }
  if ((m=text.match(/^scry (one|two|three|four|five|\d+)\.(?:\s*\([^]*\))?$/i))) { const amount=quantityToken(m[1]); return amount==null?null:{effect:effect('scry',{amount})}; }
  if ((m=text.match(/^surveil (one|two|three|four|five|\d+)\.(?:\s*\([^]*\))?$/i))) { const amount=quantityToken(m[1]); return amount==null?null:{effect:effect('surveil',{amount})}; }
  if ((m=text.match(/^mill (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?\.(?:\s*\([^]*\))?$/i))) { const amount=quantityToken(m[1]); return amount==null?null:{effect:effect('mill',{amount})}; }
  if (/^draw a card, then discard a card\.?$/i.test(text)) return {effect:effect('sequence',{effects:[effect('draw',{amount:1}),effect('discard',{amount:1,controller:'you'})]})};
  if (/^investigate\.(?:\s*\([^]*\))?$/i.test(text)) return {effect:effect('createToken',{token:'Clue',amount:1})};
  if (/^create a Food token\.(?:\s*\([^]*\))?$/i.test(text)) return {effect:effect('createToken',{token:'Food',amount:1})};
  if (/^create a Treasure token\.(?:\s*\([^]*\))?$/i.test(text)) return {effect:effect('createToken',{token:'Treasure',amount:1})};
  if ((m=text.match(/^put (a|one|two|three|four|five|\d+) \+1\/\+1 counters? on this creature\.?$/i))) { const amount=quantityToken(m[1]); return amount==null?null:{effect:effect('addCounter',{counter:'+1/+1',amount,target:'self'})}; }
  if ((m=text.match(/^target (creature|artifact|enchantment|permanent)(?: (you control|an opponent controls))? gets ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i))) { const sel=targetSelector(`${m[1]}${m[2]?` ${m[2]}`:''}`); return sel?{targets:sel,effect:effect('modifyCharacteristics',{power:Number(m[3]),toughness:Number(m[4]),duration:'untilEndOfTurn'})}:null; }
  if ((m=text.match(/^put (a|one|two|three|four|five|\d+) \+1\/\+1 counters? on target creature(?: (you control|an opponent controls))?\.?$/i))) { const amount=quantityToken(m[1]); const sel=targetSelector(`creature${m[2]?` ${m[2]}`:''}`); return amount==null||!sel?null:{targets:sel,effect:effect('addCounter',{counter:'+1/+1',amount})}; }
  if ((m=text.match(/^destroy target (creature|artifact|enchantment|nonland permanent|permanent)(?: (you control|an opponent controls))?\.?$/i))) { const sel=targetSelector(`${m[1]}${m[2]?` ${m[2]}`:''}`); return sel?{targets:sel,effect:effect('destroy')}:null; }
  if ((m=text.match(/^exile target (creature|artifact|enchantment|nonland permanent|permanent)(?: (you control|an opponent controls))?\.?$/i))) { const sel=targetSelector(`${m[1]}${m[2]?` ${m[2]}`:''}`); return sel?{targets:sel,effect:effect('exile')}:null; }
  if ((m=text.match(/^tap target (creature|artifact|land|permanent)(?: (you control|an opponent controls))?\.?$/i))) { const sel=targetSelector(`${m[1]}${m[2]?` ${m[2]}`:''}`); return sel?{targets:sel,effect:effect('tap')}:null; }
  if ((m=text.match(/^untap target (creature|artifact|land|permanent)(?: (you control|an opponent controls))?\.?$/i))) { const sel=targetSelector(`${m[1]}${m[2]?` ${m[2]}`:''}`); return sel?{targets:sel,effect:effect('untap')}:null; }
  if ((m=text.match(/^this creature deals (one|two|three|four|five|\d+) damage to any target\.?$/i))) { const amount=quantityToken(m[1]); return amount==null?null:{targets:{kind:'any'},effect:effect('damage',{amount,source:'self'})}; }
  if ((m=text.match(/^it deals (one|two|three|four|five|\d+) damage to any target\.?$/i))) { const amount=quantityToken(m[1]); return amount==null?null:{targets:{kind:'any'},effect:effect('damage',{amount,source:'self'})}; }
  if ((m=text.match(/^each opponent loses (one|two|three|four|five|\d+) life\.?$/i))) { const amount=quantityToken(m[1]); return amount==null?null:{effect:effect('loseLife',{amount,controller:'eachOpponent'})}; }
  if ((m=text.match(/^each opponent loses (one|two|three|four|five|\d+) life and you gain \1 life\.?$/i))) { const amount=quantityToken(m[1]); return amount==null?null:{effect:effect('sequence',{effects:[effect('loseLife',{amount,controller:'eachOpponent'}),effect('gainLife',{amount})]})}; }
  if ((m=text.match(/^this creature gets ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i))) return {effect:effect('modifyCharacteristics',{power:Number(m[1]),toughness:Number(m[2]),duration:'untilEndOfTurn',target:'self'})};
  if ((m=text.match(/^it gets ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i))) return {effect:effect('modifyCharacteristics',{power:Number(m[1]),toughness:Number(m[2]),duration:'untilEndOfTurn',target:'self'})};
  if (/^untap this creature\.?$/i.test(text)) return {effect:effect('untap',{target:'self'})};
  if (/^discard a card\.?$/i.test(text)) return {effect:effect('discard',{amount:1,controller:'you'})};
  if (/^you may draw a card\.?$/i.test(text)) return {effect:effect('may',{effect:effect('draw',{amount:1})})};
  if (/^you may gain (\d+) life\.?$/i.test(text)) { m=text.match(/(\d+)/); return {effect:effect('may',{effect:effect('gainLife',{amount:Number(m[1])})})}; }
  if (/^sacrifice this creature\.?$/i.test(text)) return {effect:effect('sacrifice',{target:'self'})};
  if ((m=text.match(/^create (a|one|two|three|four|five|\d+) (\d+)\/(\d+) (white|blue|black|red|green|colorless) ([A-Za-z ]+?) creature tokens?\.?$/i))) { const amount=quantityToken(m[1]); return amount==null?null:{effect:effect('createToken',{amount,token:{power:Number(m[2]),toughness:Number(m[3]),color:m[4].toLowerCase(),subtypes:m[5].trim().split(/\s+/)}})}; }
  if ((m=text.match(/^return target (creature|artifact|enchantment|permanent) to its owner's hand\.?$/i))) { const sel=targetSelector(m[1]); return sel?{targets:sel,effect:effect('moveZone',{toZone:'hand',owner:true})}:null; }
  if ((m=text.match(/^return target (creature|artifact|enchantment) card from your graveyard to your hand\.?$/i))) return {targets:{kind:'card',zone:'graveyard',controller:'you',type:m[1][0].toUpperCase()+m[1].slice(1)},effect:effect('moveZone',{toZone:'hand',owner:true})};
  return null;
}

function phase69Triggered(prefix, event, condition = {}, extra = {}) {
  return template(`phase69.${prefix.replace(/[^a-z0-9]+/gi,'-').toLowerCase()}`, `Catalog batch trigger grammar: ${prefix}`, ({ text }) => {
    const re = new RegExp(`^${prefix},\\s*(.+)$`, 'i');
    const m = text.match(re); if (!m) return null;
    const parsed=phase69SimplePayload(m[1]); if(!parsed) return null;
    return {ast:{type:'card',abilities:[trigger(event,parsed.effect,condition,{...extra,...(parsed.targets?{targets:parsed.targets}:{})})]}};
  });
}

const PHASE69_BATCH1_TEMPLATES = [
  template('phase69.land-entry-conditional','Common exact conditional tapped-land entry rules.',({text,card})=>{
    if(!/\bLand\b/i.test(card?.typeLine||''))return null;
    let m;
    if((m=text.match(/^This land enters tapped unless you control (two|three|four|\d+) or more (basic |other )?lands\.$/i))) return {ast:{type:'card',abilities:[],cardPatch:{entersTappedUnless:{kind:'controlCount',type:'Land',qualifier:(m[2]||'').trim()||null,operator:'>=',amount:quantityToken(m[1])}}}};
    if((m=text.match(/^This land enters tapped unless you control (two|three|four|\d+) or fewer other lands\.$/i))) return {ast:{type:'card',abilities:[],cardPatch:{entersTappedUnless:{kind:'controlCount',type:'Land',other:true,operator:'<=',amount:quantityToken(m[1])}}}};
    if((m=text.match(/^This land enters tapped unless (?:a player has|you have) (\d+) or less life\.$/i))) return {ast:{type:'card',abilities:[],cardPatch:{entersTappedUnless:{kind:'lifeAtMost',amount:Number(m[1]),player:/a player/i.test(text)?'any':'you'}}}};
    if((m=text.match(/^This land enters tapped unless you have (two|three|four|\d+) or more opponents\.$/i))) return {ast:{type:'card',abilities:[],cardPatch:{entersTappedUnless:{kind:'opponentCount',operator:'>=',amount:quantityToken(m[1])}}}};
    if((m=text.match(/^This land enters tapped unless your opponents control (\d+) or more lands\.$/i))) return {ast:{type:'card',abilities:[],cardPatch:{entersTappedUnless:{kind:'opponentsControlCount',type:'Land',operator:'>=',amount:Number(m[1])}}}};
    if((m=text.match(/^As this land enters, you may pay (\d+) life\. If you don't, it enters tapped\.$/i))) return {ast:{type:'card',abilities:[],cardPatch:{entryChoice:{payLife:Number(m[1]),otherwiseTapped:true}}}};
    return null;
  }),
  template('phase69.block-power-restriction','Source cannot be blocked by creatures at or below a power threshold.',({text})=>{const m=text.match(/^This creature can't be blocked by creatures with power (\d+) or less\.$/i);return m?{ast:{type:'card',abilities:[],cardPatch:{blockRestriction:{blockerPowerGreaterThan:Number(m[1])}}}}:null;}),
  template('phase69.max-one-blocker','Source cannot be blocked by more than one creature.',({text})=>/^This creature can't be blocked by more than one creature\.$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{maxBlockers:1}}}:null),
  template('phase69.island-home','Source cannot attack unless defending player controls an Island.',({text})=>/^This creature can't attack unless defending player controls an Island\.$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{attackRestriction:{defenderControlsSubtype:'Island'}}}}:null),
  template('phase69.may-skip-untap','Controller may choose not to untap source.',({text})=>/^You may choose not to untap this creature during your untap step\.$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{optionalUntap:false,mayRemainTapped:true}}}:null),
  template('phase69.spell-cost-reduction-type','Controller instant and sorcery spells cost one generic less.',({text})=>/^Instant and sorcery spells you cast cost \{1\} less to cast\.$/i.test(text)?{ast:{type:'card',abilities:[staticAbility({controller:'you',zone:'stack',types:['Instant','Sorcery']},effect('costModifier',{generic:-1}))]}}:null),
  template('phase69.chosen-color-mana','Tap to add one mana of the previously chosen color.',({text})=>/^\{T\}: Add one mana of the chosen color\.$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{abilities:[{type:'mana',tap:true,chosenColor:true,amount:1}]}}}:null),
  template('phase69.upkeep-spore','Upkeep puts a spore counter on source.',({text})=>/^At the beginning of your upkeep, put a spore counter on this creature\.$/i.test(text)?{ast:{type:'card',abilities:[trigger('UPKEEP',effect('addCounter',{counter:'spore',amount:1,target:'self'}),{controller:'you'})]}}:null),
  template('phase69.draw-delayed-next-upkeep','Schedule one card draw for next turn upkeep.',({text})=>/^Draw a card at the beginning of the next turn's upkeep\.$/i.test(text)?{ast:{type:'card',abilities:[spell(effect('scheduleDelayedTrigger',{step:'upkeep',nextTurn:true,effect:effect('draw',{amount:1})}))]}}:null),
  template('phase69.targeted-sacrifice-on-target','Sacrifice source whenever it becomes targeted.',({text})=>/^When this creature becomes the target of a spell or ability, sacrifice it\.$/i.test(text)?{ast:{type:'card',abilities:[trigger('BECOMES_TARGET',effect('sacrifice',{target:'self'}),{sourceSelf:true})]}}:null),
  template('phase69.draw-counter-self','Whenever controller draws, put a +1/+1 counter on source.',({text})=>/^Whenever you draw a card, put a \+1\/\+1 counter on this creature\.$/i.test(text)?{ast:{type:'card',abilities:[trigger('DRAW_CARD',effect('addCounter',{counter:'+1/+1',amount:1,target:'self'}),{controllerEvent:true})]}}:null),
  template('phase69.life-counter-self','Whenever controller gains life, put a +1/+1 counter on source.',({text})=>/^Whenever you gain life, put a \+1\/\+1 counter on this creature\.$/i.test(text)?{ast:{type:'card',abilities:[trigger('GAIN_LIFE',effect('addCounter',{counter:'+1/+1',amount:1,target:'self'}),{controllerEvent:true})]}}:null),
  template('phase69.sac-mana-any-color','Tap and sacrifice source to add one mana of any color.',({text})=>/^\{T\}, Sacrifice this (?:land|artifact): Add one mana of any color\.$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{abilities:[{type:'mana',tap:true,sacrificeSelf:true,anyColor:true,colors:['W','U','B','R','G'],amount:1}]}}}:null),
  template('phase69.landfall-self-pump','Landfall pumps source +2/+2 until end of turn.',({text})=>/^Landfall — Whenever a land you control enters, this creature gets \+2\/\+2 until end of turn\.$/i.test(text)?{ast:{type:'card',abilities:[trigger('ENTER_BATTLEFIELD',effect('modifyCharacteristics',{power:2,toughness:2,duration:'untilEndOfTurn',target:'self'}),{controllerEvent:true,cardType:'Land'})]}}:null),
  template('phase69.equipment-autoattach','Equipment ETB attaches to target creature you control.',({text})=>/^When this Equipment enters, attach it to target creature you control\.$/i.test(text)?{ast:{type:'card',abilities:[trigger('ENTER_BATTLEFIELD',effect('attach',{source:'self'}),null,{source:'self',targets:{kind:'permanent',type:'Creature',controller:'you'}})]}}:null),
  template('phase69.aura-return-hand','Aura dying from battlefield returns itself to owner hand.',({text})=>/^When this Aura is put into a graveyard from the battlefield, return it to its owner's hand\.$/i.test(text)?{ast:{type:'card',abilities:[trigger('ZONE_CHANGE',effect('moveZone',{target:'self',toZone:'hand',owner:true}),{sourceSelf:true,fromZone:'battlefield',toZone:'graveyard'})]}}:null),
  template('phase69.etb-initiative','Source ETB makes controller take initiative.',({text})=>/^When this creature enters, you take the initiative\.$/i.test(text)?{ast:{type:'card',abilities:[trigger('ENTER_BATTLEFIELD',effect('takeInitiative'),null,{source:'self'})]}}:null),
  template('phase69.prevent-combat-turn','Prevent all combat damage this turn.',({text,card})=>/^Prevent all combat damage that would be dealt this turn\.$/i.test(text)&&/\b(Instant|Sorcery)\b/i.test(card?.typeLine||'')?{ast:{type:'card',abilities:[spell(effect('preventDamage',{combatOnly:true,amount:'all',duration:'untilEndOfTurn'}))]}}:null),
  template('phase69.target-unblockable','Target creature cannot be blocked this turn.',({text,card})=>/^Target creature can't be blocked this turn\.$/i.test(text)&&/\b(Instant|Sorcery)\b/i.test(card?.typeLine||'')?{ast:{type:'card',abilities:[spell(effect('grantAbility',{ability:'cantBeBlocked',duration:'untilEndOfTurn'}),{kind:'permanent',type:'Creature'})]}}:null),
  template('phase69.counter-unless-one','Counter target spell unless controller pays one.',({text,card})=>/^Counter target spell unless its controller pays \{1\}\.$/i.test(text)&&/\b(Instant|Sorcery)\b/i.test(card?.typeLine||'')?{ast:{type:'card',abilities:[spell(effect('counterUnlessPays',{mana:'{1}'}),{kind:'spell'})]}}:null),
  template('phase69.additional-discard-cost','Discard a card as an additional casting cost.',({text})=>/^As an additional cost to cast this spell, discard a card\.$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{additionalCosts:[{kind:'discard',amount:1}]}}}:null),
  template('phase69.additional-sac-ac-cost','Sacrifice artifact or creature as additional casting cost.',({text})=>/^As an additional cost to cast this spell, sacrifice an artifact or creature\.$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{additionalCosts:[{kind:'sacrifice',amount:1,types:['Artifact','Creature']}]}}}:null),
  template('phase69.etb-explore','Source explores when it enters.',({text})=>/^When this creature enters, it explores\. \(Reveal the top card of your library\. Put that card into your hand if it's a land\. Otherwise, put a \+1\/\+1 counter on this creature, then put the card back or put it into your graveyard\.\)$/i.test(text)?{ast:{type:'card',abilities:[trigger('ENTER_BATTLEFIELD',effect('explore',{target:'self'}),null,{source:'self'})]}}:null),
  template('phase69.damage-shield-counter','Damage to source is prevented by removing a +1/+1 counter.',({text})=>/^If damage would be dealt to this creature, prevent that damage\. Remove a \+1\/\+1 counter from this creature\.$/i.test(text)?{ast:{type:'card',abilities:[replacementAbility('DEAL_DAMAGE',{self:true},{kind:'preventByRemovingCounter',counter:'+1/+1',amount:1})]}}:null),
  template('phase69.ally-etb-counter','Ally rally-style ETB may put a +1/+1 counter on source.',({text})=>/^Whenever this creature or another Ally you control enters, you may put a \+1\/\+1 counter on this creature\.$/i.test(text)?{ast:{type:'card',abilities:[trigger('ENTER_BATTLEFIELD',effect('may',{effect:effect('addCounter',{counter:'+1/+1',amount:1,target:'self'})}),{controllerEvent:true,subtype:'Ally'})]}}:null),
  template('phase69.simple-spell-payload','Fallback exact grammar for a single simple instant/sorcery payload.',({text,card})=>{
    if(!/\b(Instant|Sorcery)\b/i.test(card?.typeLine||'')) return null;
    const parsed=phase69SimplePayload(text); return parsed?{ast:{type:'card',abilities:[spell(parsed.effect,parsed.targets||null)]}}:null;
  }),
  template('phase69.land-parenthetical-mana','Parenthetical land mana reminder is executable mana behavior.',({text,card})=>{
    if(!/\bLand\b/i.test(card?.typeLine||'')) return null;
    const m=text.match(/^\(\{T\}: Add ((?:\{[WUBRGC]\})(?:,? or )?)+\.\)$/i); if(!m)return null;
    const colors=[...m[1].matchAll(/\{([WUBRGC])\}/gi)].map(x=>x[1].toUpperCase());
    return {ast:{type:'card',abilities:[],cardPatch:{abilities:[{type:'mana',tap:true,colors,amount:1}]}}};
  }),
  template('phase69.land-etb-bounce','Land ETB returns a land you control to owner hand.',({text})=>/^When this land enters, return a land you control to its owner's hand\.$/i.test(text)?{ast:{type:'card',abilities:[trigger('ENTER_BATTLEFIELD',effect('moveZone',{selector:{kind:'permanent',type:'Land',controller:'you'},toZone:'hand',owner:true,choose:1}),null,{source:'self'})]}}:null),
  template('phase69.enters-x-counters','Creature enters with X +1/+1 counters.',({text})=>/^This creature enters with X \+1\/\+1 counters on it\.$/i.test(text)?{ast:{type:'card',abilities:[replacementAbility('ENTER_BATTLEFIELD',{self:true},{kind:'enterWithCounters',counter:'+1/+1',amount:{variable:'X'}})]}}:null),
  template('phase69.combat-damage-counter-self','Combat damage to player puts a +1/+1 counter on source.',({text})=>/^Whenever this creature deals combat damage to a player, put a \+1\/\+1 counter on it\.$/i.test(text)?{ast:{type:'card',abilities:[trigger('COMBAT_DAMAGE',effect('addCounter',{counter:'+1/+1',amount:1,target:'self'}),{sourceSelf:true,toPlayer:true})]}}:null),
  template('phase69.land-etb-damage-opponent','Land ETB deals 1 damage to target opponent.',({text})=>/^When this land enters, it deals 1 damage to target opponent\.$/i.test(text)?{ast:{type:'card',abilities:[trigger('ENTER_BATTLEFIELD',effect('damage',{amount:1,source:'self'}),null,{source:'self',targets:{kind:'player',controller:'opponent'}})]}}:null),
  template('phase69.tribal-other-plus-one','Other creatures of a named subtype you control get +1/+1.',({text})=>{const m=text.match(/^Other ([A-Za-z]+)s you control get \+1\/\+1\.$/i); return m?{ast:{type:'card',abilities:[staticAbility({type:'Creature',subtype:m[1],controller:'you',other:true},{power:1,toughness:1})]}}:null;}),
  phase69Triggered('When this creature enters(?: the battlefield)?','ENTER_BATTLEFIELD',{}, {source:'self'}),
  phase69Triggered('When this artifact enters(?: the battlefield)?','ENTER_BATTLEFIELD',{}, {source:'self'}),
  phase69Triggered('When this enchantment enters(?: the battlefield)?','ENTER_BATTLEFIELD',{}, {source:'self'}),
  phase69Triggered('When this land enters(?: the battlefield)?','ENTER_BATTLEFIELD',{}, {source:'self'}),
  phase69Triggered('When this creature dies','DIES',{}, {source:'self'}),
  phase69Triggered('Whenever this creature attacks','ATTACK',{selfEvent:true}),
  phase69Triggered('Whenever this creature deals combat damage to a player','COMBAT_DAMAGE',{sourceSelf:true,toPlayer:true}),
  phase69Triggered('At the beginning of your upkeep','UPKEEP',{controller:'you'}),
  phase69Triggered('At the beginning of your end step','END_STEP',{controller:'you'}),
  phase69Triggered('Whenever you cast a spell','SPELL_CAST',{controllerEvent:true}),
  phase69Triggered('Whenever you cast a noncreature spell','SPELL_CAST',{controllerEvent:true,noncreature:true}),
  phase69Triggered('Whenever another creature you control enters(?: the battlefield)?','ENTER_BATTLEFIELD',{controllerEvent:true,cardType:'Creature',notSelfEvent:true}),

  template('phase69.aura-tap-on-entry','Aura ETB taps enchanted creature.',({text})=>/^When this Aura enters, tap enchanted creature\.$/i.test(text)?{ast:{type:'card',abilities:[trigger('ENTER_BATTLEFIELD',effect('tap',{target:'enchanted'}),null,{source:'self'})]}}:null),
  template('phase69.aura-no-untap','Enchanted creature does not untap during its controller untap step.',({text})=>/^Enchanted creature doesn't untap during its controller's untap step\.$/i.test(text)?{ast:{type:'card',abilities:[staticAbility({attachedObject:true},effect('continuous',{layer:6,transform:{doesNotUntap:true}}))]}}:null),
  template('phase69.aura-control','Controller controls enchanted permanent.',({text})=>/^You control enchanted (creature|permanent)\.$/i.test(text)?{ast:{type:'card',abilities:[staticAbility({attachedObject:true},effect('continuous',{layer:2,transform:{controller:'you'}}))]}}:null),
  template('phase69.aura-keyword','Enchanted creature has a supported evergreen keyword.',({text})=>{const m=text.match(/^Enchanted creature has ([A-Za-z ]+)\.$/i); const ks=m&&parseKeywordList(m[1]); return ks?{ast:{type:'card',abilities:[staticAbility({attachedObject:true},effect('continuous',{layer:6,transform:{addKeywords:ks}}))]}}:null;}),
  template('phase69.equipment-keyword','Equipped creature has a supported evergreen keyword.',({text})=>{const m=text.match(/^Equipped creature has ([A-Za-z ]+)\.$/i); const ks=m&&parseKeywordList(m[1]); return ks?{ast:{type:'card',abilities:[staticAbility({equippedObject:true},effect('continuous',{layer:6,transform:{addKeywords:ks}}))]}}:null;}),
  template('phase69.aura-pt','Enchanted creature gets a fixed P/T modification.',({text})=>{const m=text.match(/^Enchanted creature gets ([+-]\d+)\/([+-]\d+)\.$/i); return m?{ast:{type:'card',abilities:[staticAbility({attachedObject:true},effect('continuous',{layer:'7c',transform:{power:Number(m[1]),toughness:Number(m[2])}}))]}}:null;}),
  template('phase69.equipment-pt','Equipped creature gets a fixed P/T modification.',({text})=>{const m=text.match(/^Equipped creature gets ([+-]\d+)\/([+-]\d+)\.$/i); return m?{ast:{type:'card',abilities:[staticAbility({equippedObject:true},effect('continuous',{layer:'7c',transform:{power:Number(m[1]),toughness:Number(m[2])}}))]}}:null;}),
  template('phase69.aura-pt-keyword','Enchanted creature gets fixed P/T and a supported keyword.',({text})=>{const m=text.match(/^Enchanted creature gets ([+-]\d+)\/([+-]\d+) and has ([A-Za-z ]+)\.$/i); const ks=m&&parseKeywordList(m[3]); return ks?{ast:{type:'card',abilities:[staticAbility({attachedObject:true},effect('continuous',{layer:'7c',transform:{power:Number(m[1]),toughness:Number(m[2]),addKeywords:ks}}))]}}:null;}),
  template('phase69.equipment-pt-keyword','Equipped creature gets fixed P/T and a supported keyword.',({text})=>{const m=text.match(/^Equipped creature gets ([+-]\d+)\/([+-]\d+) and has ([A-Za-z ]+)\.$/i); const ks=m&&parseKeywordList(m[3]); return ks?{ast:{type:'card',abilities:[staticAbility({equippedObject:true},effect('continuous',{layer:'7c',transform:{power:Number(m[1]),toughness:Number(m[2]),addKeywords:ks}}))]}}:null;}),
  template('phase69.endstep-sacrifice-self','Sacrifice this creature at beginning of end step.',({text})=>/^At the beginning of the end step, sacrifice this creature\.$/i.test(text)?{ast:{type:'card',abilities:[trigger('END_STEP',effect('sacrifice',{target:'self'}),{}, {source:'self'})]}}:null),
  template('phase69.activated-regenerate','Fixed mana activation regenerates this creature.',({text})=>{const m=text.match(/^((?:\{[^}]+\})+): Regenerate this creature\.$/i); return m?{ast:{type:'card',abilities:[activated({mana:m[1]},effect('grantAbility',{ability:'regenerationShield',target:'self',duration:'untilUsed'}))]}}:null;}),
  template('phase69.activated-pump','Fixed mana activation pumps this creature until EOT.',({text})=>{const m=text.match(/^((?:\{[^}]+\})+): This creature gets ([+-]\d+)\/([+-]\d+) until end of turn\.$/i); return m?{ast:{type:'card',abilities:[activated({mana:m[1]},effect('modifyCharacteristics',{power:Number(m[2]),toughness:Number(m[3]),duration:'untilEndOfTurn',target:'self'}))]}}:null;}),
  template('phase69.generic-activated-simple','Simple activated ability with mana/tap/sacrifice costs and a supported payload.',({text})=>{
    const m=text.match(/^((?:(?:\{[^}]+\}),?\s*)+(?:(?:\{T\}|Sacrifice this (?:creature|artifact|permanent|land)),?\s*)*):\s*(.+)$/i); if(!m)return null;
    if (/^Draw a card, then discard a card\.?$/i.test(m[2])) return null;
    const parsed=phase69SimplePayload(m[2]); if(!parsed)return null;
    const raw=m[1]; const mana=(raw.match(/\{(?!T\})[^}]+\}/g)||[]).join('');
    const cost={...(mana?{mana}:{}),...(/\{T\}/i.test(raw)?{tap:true}:{}),...(/Sacrifice this/i.test(raw)?{sacrificeSelf:true}:{})};
    return {ast:{type:'card',abilities:[activated(cost,parsed.effect,parsed.targets||null)]}};
  }),
  template('phase69.combat-block-flying-only','This creature can block only creatures with flying.',({text})=>/^This creature can block only creatures with flying\.$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{blockRestriction:{defenderRequiresKeyword:'flying'}}}}:null),
  template('phase69.top-library-visible','Controller may look at top card of library any time.',({text})=>/^You may look at the top card of your library any time\.$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{mayLookAtTopLibrary:true}}}:null)
];



// Phase 70 / Batch 2 — additional catalog families. Every grammar below lowers
// to an already executable engine primitive or an existing cost/casting path.
const PHASE71_BATCH2_TEMPLATES = [
  // Phase 75: recurring static legality restrictions now compile directly into
  // ruleObjects consumed by the authoritative LegalityService/Stax adapter.
  template('phase75.rule-of-law-each','Each player can cast at most one spell each turn.',({text})=>/^Each player can't cast more than one spell each turn\.$/i.test(text)?{ast:{type:'card',abilities:[staticAbility({},null,{ruleObject:{kind:'restriction',operation:'CAST',appliesTo:'each-player',maxPerTurn:1,message:'A player cannot cast more than one spell each turn.'}})]}}:null),
  template('phase75.rule-of-law-opponents','Opponents can cast at most one spell each turn.',({text})=>/^Your opponents can't cast more than one spell each turn\.$/i.test(text)?{ast:{type:'card',abilities:[staticAbility({},null,{ruleObject:{kind:'restriction',operation:'CAST',appliesTo:'opponent',maxPerTurn:1,message:'An opponent cannot cast more than one spell each turn.'}})]}}:null),
  template('phase75.players-cant-search','Players cannot search libraries.',({text})=>/^Players can't search libraries\.$/i.test(text)?{ast:{type:'card',abilities:[staticAbility({},null,{ruleObject:{kind:'restriction',operation:'SEARCH',appliesTo:'each-player',message:'Players cannot search libraries.'}})]}}:null),
  template('phase75.opponents-cant-search','Opponents cannot search libraries.',({text})=>/^Your opponents can't search libraries\.$/i.test(text)?{ast:{type:'card',abilities:[staticAbility({},null,{ruleObject:{kind:'restriction',operation:'SEARCH',appliesTo:'opponent',message:'Opponents cannot search libraries.'}})]}}:null),
  template('phase75.one-draw-each','Each player can draw at most one card each turn.',({text})=>/^Each player can't draw more than one card each turn\.$/i.test(text)?{ast:{type:'card',abilities:[staticAbility({},null,{ruleObject:{kind:'restriction',operation:'DRAW',appliesTo:'each-player',maxPerTurn:1,message:'A player cannot draw more than one card each turn.'}})]}}:null),
  // Phase 76: migrate additional established stax families into the compiled legality pipeline.
  template('phase76.one-attacker','No more than one creature can attack each combat.',({text})=>/^No more than one creature can attack each combat\.$/i.test(text)?{ast:{type:'card',abilities:[staticAbility({},null,{ruleObject:{kind:'restriction',operation:'ATTACK',appliesTo:'each-player',maxObjects:1,message:'No more than one creature can attack each combat.'}})]}}:null),
  template('phase76.one-blocker','No more than one creature can block each combat.',({text})=>/^No more than one creature can block each combat\.$/i.test(text)?{ast:{type:'card',abilities:[staticAbility({},null,{ruleObject:{kind:'restriction',operation:'BLOCK',appliesTo:'each-player',maxObjects:1,message:'No more than one creature can block each combat.'}})]}}:null),
  template('phase76.attack-tax','Fixed generic payment per creature attacking you.',({text})=>{const m=text.match(/^Creatures can't attack you unless their controller pays \{(\d+)\} for each creature they control that's attacking you\.$/i);return m?{ast:{type:'card',abilities:[staticAbility({},null,{ruleObject:{kind:'requirement',operation:'ATTACK',appliesTo:'opponent',when:{targetPlayerIsSourceController:true},genericCostPerObject:Number(m[1]),message:`Attacking this player costs {${Number(m[1])}} per creature.`}})]}}:null;}),
  template('phase76.nonbasic-freeze',"Nonbasic lands do not untap normally.",({text})=>/^Nonbasic lands don't untap during their controllers' untap steps\.$/i.test(text)?{ast:{type:'card',abilities:[staticAbility({},null,{ruleObject:{kind:'restriction',operation:'UNTAP',appliesTo:'each-player',filter:{type:'Land',nonbasic:true},message:"Nonbasic lands do not untap during their controllers' untap steps."}})]}}:null),
  template('phase76.own-turn-casting','Players cast spells only on their own turns.',({text})=>/^Players can cast spells only during their own turns\.$/i.test(text)?{ast:{type:'card',abilities:[staticAbility({},null,{ruleObject:{kind:'restriction',operation:'CAST',appliesTo:'each-player',when:{notOwnTurn:true},message:'Players can cast spells only during their own turns.'}})]}}:null),
  // Phase 77: additional opponent-scoped turn limits through the authoritative legality layer.
  template('phase77.each-opponent-one-draw','Each opponent can draw at most one card each turn.',({text})=>/^Each opponent can't draw more than one card each turn\.$/i.test(text)?{ast:{type:'card',abilities:[staticAbility({},null,{ruleObject:{kind:'restriction',operation:'DRAW',appliesTo:'opponent',maxPerTurn:1,message:'An opponent cannot draw more than one card each turn.'}})]}}:null),
  template('phase77.each-opponent-one-spell','Each opponent can cast at most one spell each turn.',({text})=>/^Each opponent can't cast more than one spell each turn\.$/i.test(text)?{ast:{type:'card',abilities:[staticAbility({},null,{ruleObject:{kind:'restriction',operation:'CAST',appliesTo:'opponent',maxPerTurn:1,message:'An opponent cannot cast more than one spell each turn.'}})]}}:null),
  // Phase 73: commander pairing and graveyard-casting mechanics already owned
  // by authoritative CommanderRules / casting-option resolution paths.
  // Phase 74: runtime-hardening + additional exact reusable semantics.
  template('phase74.enters-minus-counters','This creature enters with fixed -1/-1 counters.',({text})=>{const m=text.match(/^This creature enters with (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) -1\/-1 counters? on it\.$/i); if(!m)return null; const words={a:1,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10}; const amount=words[m[1].toLowerCase()]??Number(m[1]); return {ast:{type:'card',abilities:[replacementAbility('ENTER_BATTLEFIELD',{self:true},{kind:'enterWithCounters',counter:'-1/-1',amount})]}};}),
  template('phase74.players-no-life-gain','No player can gain life.',({text})=>/^Players can't gain life\.$/i.test(text)?{ast:{type:'card',abilities:[replacementAbility('GAIN_LIFE',{player:'any'},{kind:'preventLifeGain'})]}}:null),
  template('phase73.doctors-companion',"Doctor's companion commander pairing rule.",({text})=>/^Doctor['’]s companion(?:\s*\([^]*\))?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{commanderPairing:{kind:'doctors-companion'}}}}:null),
  template('phase73.aftermath','Aftermath graveyard-only cast permission with exile after leaving stack.',({text})=>/^Aftermath(?:\s*\([^]*\))?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{castingOptions:[{id:'aftermath',fromZone:'graveyard',castOption:'aftermath',timing:'sorcery',exileOnLeaveStack:true}]}}}:null),
  // Phase 72: structural Oracle clauses. These clauses carry rules meaning that
  // is already enforced by the corresponding engine subsystem; compiling them
  // prevents reminder/header text from falsely downgrading an otherwise
  // executable card during paragraph composition.
  template('phase72.saga-reminder','Saga lore-counter/sacrifice reminder handled by Saga/Counter services.',({text})=>/^\(As this Saga enters and after your draw step, add a lore counter\.(?: Sacrifice after (?:III|IV)\.)?\)$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{sagaRules:true}}}:null),
  template('phase72.modal-header','Modal choice header consumed by modal composition.',({text})=>/^Choose (?:one|two|three|one or both|one or more) —$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{modalHeader:true}}}:null),
  template('phase72.choose-background','Choose a Background commander pairing rule.',({text})=>/^Choose a Background(?:\s*\([^]*\))?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{chooseBackground:true}}}:null),
  template('phase71.theme-color','Theme-color marker retained as executable card metadata.',({text})=>{const m=text.match(/^\(Theme colors?: ((?:\{[WUBRG]\})+)\.?(?:\))$/i);return m?{ast:{type:'card',abilities:[],cardPatch:{themeColors:[...m[1].matchAll(/\{([WUBRG])\}/g)].map(x=>x[1])}}}:null;}),
  template('phase71.flanking','Flanking combat trigger.',({text})=>/^Flanking(?:\s*\([^]*\))?$/i.test(text)?{ast:{type:'card',abilities:[trigger('BLOCKED',effect('modifyCharacteristics',{power:-1,toughness:-1,duration:'untilEndOfTurn',target:'blockingCreature'}),{sourceSelf:true,blockerLacksKeyword:'flanking'})]}}:null),
  template('phase71.mentor','Mentor attack trigger.',({text})=>/^Mentor(?:\s*\([^]*\))?$/i.test(text)?{ast:{type:'card',abilities:[trigger('ATTACK',effect('mentor'),{sourceSelf:true},{targets:{kind:'permanent',type:'Creature',controller:'you',attacking:true,powerLessThanSource:true}})]}}:null),
  template('phase71.myriad','Myriad multiplayer attack trigger.',({text})=>/^Myriad(?:\s*\([^]*\))?$/i.test(text)?{ast:{type:'card',abilities:[trigger('ATTACK',effect('myriad'),{sourceSelf:true})]}}:null),
  template('phase71.battle-cry','Battle cry attack trigger.',({text})=>/^Battle cry(?:\s*\([^]*\))?$/i.test(text)?{ast:{type:'card',abilities:[trigger('ATTACK',effect('pump',{selector:{kind:'permanent',type:'Creature',controller:'you',attacking:true,other:true},power:1,toughness:0,duration:'untilEndOfTurn'}),{sourceSelf:true})]}}:null),
  template('phase71.ingest','Ingest combat damage trigger.',({text})=>/^Ingest(?:\s*\([^]*\))?$/i.test(text)?{ast:{type:'card',abilities:[trigger('COMBAT_DAMAGE',effect('scriptMoveZone',{from:'library',to:'exile',amount:1,player:'damagedPlayer',position:'top'}),{sourceSelf:true,toPlayer:true})]}}:null),
  template('phase71.energy-etb','ETB grants energy counters.',({text})=>{const m=text.match(/^When this creature enters, you get ((?:\{E\})+)\s*(?:\([^]*\))?\.?$/i);return m?{ast:{type:'card',abilities:[trigger('ENTER_BATTLEFIELD',effect('addCounter',{counter:'energy',amount:(m[1].match(/\{E\}/g)||[]).length,target:'controller'}),null,{source:'self'})]}}:null;}),
  template('phase71.training','Training attack trigger.',({text})=>/^Training(?:\s*\([^]*\))?$/i.test(text)?{ast:{type:'card',abilities:[trigger('ATTACK',effect('addCounter',{counter:'+1/+1',amount:1,target:'self'}),{sourceSelf:true,attacksWithGreaterPower:true})]}}:null),
  template('phase71.dethrone','Dethrone attack trigger.',({text})=>/^Dethrone(?:\s*\([^]*\))?$/i.test(text)?{ast:{type:'card',abilities:[trigger('ATTACK',effect('addCounter',{counter:'+1/+1',amount:1,target:'self'}),{sourceSelf:true,defendingPlayerHasMostLife:true})]}}:null),
  template('phase71.landfall-counter','Landfall adds a +1/+1 counter.',({text})=>/^Landfall — Whenever a land you control enters, put a \+1\/\+1 counter on this creature\.$/i.test(text)?{ast:{type:'card',abilities:[trigger('ENTER_BATTLEFIELD',effect('addCounter',{counter:'+1/+1',amount:1,target:'self'}),{controllerEvent:true,cardType:'Land'})]}}:null),
  template('phase71.second-draw-counter','Second card drawn each turn adds counter.',({text})=>/^Whenever you draw your second card each turn, put a \+1\/\+1 counter on this creature\.$/i.test(text)?{ast:{type:'card',abilities:[trigger('DRAW_CARD',effect('addCounter',{counter:'+1/+1',amount:1,target:'self'}),{controllerEvent:true,nthThisTurn:2})]}}:null),
  template('phase71.etb-loot','ETB optional discard then draw.',({text})=>/^When this creature enters, you may discard a card\. If you do, draw a card\.$/i.test(text)?{ast:{type:'card',abilities:[trigger('ENTER_BATTLEFIELD',effect('optionalEffect',{cost:{discard:1},effect:effect('draw',{amount:1})}),null,{source:'self'})]}}:null),
  template('phase71.etb-opponents-discard','ETB each opponent discards.',({text})=>/^When this creature enters, each opponent discards a card\.$/i.test(text)?{ast:{type:'card',abilities:[trigger('ENTER_BATTLEFIELD',effect('discard',{amount:1,controller:'eachOpponent'}),null,{source:'self'})]}}:null),
  template('phase71.life-drain-trigger','Life gain drains opponents.',({text})=>/^Whenever you gain life, each opponent loses 1 life\.$/i.test(text)?{ast:{type:'card',abilities:[trigger('GAIN_LIFE',effect('loseLife',{amount:1,controller:'eachOpponent'}),{controllerEvent:true})]}}:null),
  template('phase71.skip-draw','Skip your draw step.',({text})=>/^Skip your draw step\.$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{skipDrawStep:true}}}:null),
  template('phase71.play-top-revealed','Top library is revealed.',({text})=>/^Play with the top card of your library revealed\.$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{revealTopLibrary:true}}}:null),
  template('phase71.play-lands-graveyard','Play lands from graveyard.',({text})=>/^You may play lands from your graveyard\.$/i.test(text)?{ast:{type:'card',abilities:[staticAbility({controller:'you'},effect('castPermission',{zone:'graveyard',type:'Land',play:true}))]}}:null),
  template('phase71.no-life-gain','Opponents cannot gain life.',({text})=>/^Your opponents can't gain life\.$/i.test(text)?{ast:{type:'card',abilities:[replacementAbility('GAIN_LIFE',{player:'opponent'},{kind:'preventLifeGain'})]}}:null),
  template('phase71.must-block','Source must be blocked if able.',({text})=>/^This creature must be blocked if able\.$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{mustBeBlocked:true}}}:null),
  template('phase71.all-must-block','All creatures able to block source do so.',({text})=>/^All creatures able to block this creature do so\.$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{allAbleMustBlock:true}}}:null),
  template('phase71.three-blockers','Source needs three or more blockers.',({text})=>/^This creature can't be blocked except by three or more creatures\.$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{minBlockers:3}}}:null),
  template('phase71.damage-as-unblocked','May assign combat damage as unblocked.',({text})=>/^You may have this creature assign its combat damage as though it weren't blocked\.$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{assignDamageAsUnblocked:true}}}:null),
  template('phase71.etb-basic-land-hand','ETB may tutor basic land to hand.',({text})=>/^When this creature enters, you may search your library for a basic land card, reveal it, put it into your hand, then shuffle\.$/i.test(text)?{ast:{type:'card',abilities:[trigger('ENTER_BATTLEFIELD',effect('searchBasic',{destination:'hand',optional:true}),null,{source:'self'})]}}:null),
  template('phase71.etb-grave-spell-hand','ETB returns instant/sorcery from graveyard.',({text})=>/^When this creature enters, return target instant or sorcery card from your graveyard to your hand\.$/i.test(text)?{ast:{type:'card',abilities:[trigger('ENTER_BATTLEFIELD',effect('returnTarget',{destination:'hand'}),null,{source:'self',targets:{kind:'card',zone:'graveyard',controller:'you',types:['Instant','Sorcery']}})]}}:null),
  template('phase71.sac-destroy-ae','Sacrifice self to destroy artifact/enchantment.',({text})=>{const m=text.match(/^((?:\{[^}]+\},?\s*)*)Sacrifice this (?:creature|artifact): Destroy target artifact or enchantment\.$/i); if(!m)return null; const mana=(m[1].match(/\{[^}]+\}/g)||[]).join(''); return {ast:{type:'card',abilities:[activated({...mana?{mana}:{},sacrificeSelf:true},effect('destroy'),{kind:'permanent',types:['Artifact','Enchantment']})]}};}),
  template('phase71.exile-grave-activation','Mana activation exiles graveyard card.',({text})=>{const m=text.match(/^((?:\{[^}]+\})+): Exile target card from a graveyard\.$/i);return m?{ast:{type:'card',abilities:[activated({mana:m[1]},effect('exile'),{kind:'card',zone:'graveyard'})]}}:null;}),
  template('phase71.destroy-all-enchantments','Destroy all enchantments.',({text,card})=>/^Destroy all enchantments\.$/i.test(text)&&/Instant|Sorcery/i.test(card?.typeLine||'')?{ast:{type:'card',abilities:[spell(effect('destroy',{selector:{kind:'permanent',type:'Enchantment',controller:'any'},all:true}))]}}:null),
  template('phase71.return-card-grave-hand','Return target card from your graveyard to hand.',({text,card})=>/^Return target card from your graveyard to your hand\.$/i.test(text)&&/Instant|Sorcery/i.test(card?.typeLine||'')?{ast:{type:'card',abilities:[spell(effect('moveZone',{toZone:'hand',owner:true}),{kind:'card',zone:'graveyard',controller:'you'})]}}:null),
  template('phase71.return-up-to-two-creatures','Return up to two creature cards from graveyard.',({text,card})=>/^Return up to two target creature cards from your graveyard to your hand\.$/i.test(text)&&/Instant|Sorcery/i.test(card?.typeLine||'')?{ast:{type:'card',abilities:[spell(effect('moveZone',{toZone:'hand',owner:true}),{kind:'card',zone:'graveyard',controller:'you',type:'Creature'},{minTargets:0,maxTargets:2})]}}:null),
  template('phase71.counter-unless-two','Counter unless pays two.',({text,card})=>/^Counter target spell unless its controller pays \{2\}\.$/i.test(text)&&/Instant|Sorcery/i.test(card?.typeLine||'')?{ast:{type:'card',abilities:[spell(effect('counterUnlessPays',{mana:'{2}'}),{kind:'spell'})]}}:null),
  template('phase71.search-any-card','Tutor any card to hand.',({text,card})=>/^Search your library for a card, put that card into your hand, then shuffle\.$/i.test(text)&&/Instant|Sorcery/i.test(card?.typeLine||'')?{ast:{type:'card',abilities:[spell(effect('scriptSearch',{filter:{},destination:'hand',minCount:1,maxCount:1,reveal:false,shuffleAfter:true}))]}}:null),
  template('phase71.artifact-dies-draw','Artifact death draws a card.',({text})=>/^When this artifact is put into a graveyard from the battlefield, draw a card\.$/i.test(text)?{ast:{type:'card',abilities:[trigger('ZONE_CHANGE',effect('draw',{amount:1}),{sourceSelf:true,fromZone:'battlefield',toZone:'graveyard'})]}}:null),
  template('phase71.static-attacking-pump','Attacking creatures you control get +1/+0.',({text})=>/^Attacking creatures you control get \+1\/\+0\.$/i.test(text)?{ast:{type:'card',abilities:[staticAbility({type:'Creature',controller:'you',attacking:true},effect('continuous',{layer:'7c',transform:{power:1,toughness:0}}))]}}:null),
];

const PHASE70_BATCH2_TEMPLATES = [
  template('phase70.mana-three','Tap for one of three colors.',({text})=>{const m=text.match(/^\{T\}: Add \{([WUBRGC])\}, \{([WUBRGC])\}, or \{([WUBRGC])\}\.$/i);return m?{ast:{type:'card',abilities:[],cardPatch:{abilities:[{type:'mana',tap:true,colors:[m[1],m[2],m[3]].map(x=>x.toUpperCase()),amount:1}]}}}:null;}),
  template('phase70.mana-two-pain','Tap for one of two colors and source deals 1 damage to you.',({text})=>{const m=text.match(/^\{T\}: Add \{([WUBRGC])\} or \{([WUBRGC])\}\. This (?:land|artifact) deals 1 damage to you\.$/i);return m?{ast:{type:'card',abilities:[],cardPatch:{abilities:[{type:'mana',tap:true,colors:[m[1],m[2]].map(x=>x.toUpperCase()),amount:1,damageController:1}]}}}:null;}),
  template('phase70.mana-sac-double','Tap and sacrifice land to add two mana of one color.',({text})=>{const m=text.match(/^\{T\}, Sacrifice this land: Add \{([WUBRGC])\}\{\1\}\.$/i);return m?{ast:{type:'card',abilities:[],cardPatch:{abilities:[{type:'mana',tap:true,sacrificeSelf:true,colors:[m[1].toUpperCase()],amount:2}]}}}:null;}),
  template('phase70.activated-aura-pump','Mana activation pumps enchanted creature.',({text})=>{const m=text.match(/^((?:\{[^}]+\})+): Enchanted creature gets ([+-]\d+)\/([+-]\d+) until end of turn\.$/i);return m?{ast:{type:'card',abilities:[activated({mana:m[1]},effect('modifyCharacteristics',{power:Number(m[2]),toughness:Number(m[3]),duration:'untilEndOfTurn',target:'enchanted'}))]}}:null;}),
  template('phase70.team-pump-spell','Instant/sorcery pumps creatures you control.',({text,card})=>{const m=text.match(/^Creatures you control get ([+-]\d+)\/([+-]\d+) until end of turn\.$/i);return m&&/Instant|Sorcery/i.test(card?.typeLine||'')?{ast:{type:'card',abilities:[spell(effect('pump',{selector:{kind:'permanent',type:'Creature',controller:'you'},power:Number(m[1]),toughness:Number(m[2]),duration:'untilEndOfTurn'}))]}}:null;}),
  template('phase70.opponent-team-shrink','Instant/sorcery shrinks opponents creatures.',({text,card})=>{const m=text.match(/^Creatures your opponents control get ([+-]\d+)\/([+-]\d+) until end of turn\.$/i);return m&&/Instant|Sorcery/i.test(card?.typeLine||'')?{ast:{type:'card',abilities:[spell(effect('pump',{selector:{kind:'permanent',type:'Creature',controller:'opponent'},power:Number(m[1]),toughness:Number(m[2]),duration:'untilEndOfTurn'}))]}}:null;}),
  template('phase70.static-other-flying-anthem','Other flying creatures you control get fixed P/T.',({text})=>{const m=text.match(/^Other creatures you control with flying get ([+-]\d+)\/([+-]\d+)\.$/i);return m?{ast:{type:'card',abilities:[staticAbility({type:'Creature',controller:'you',other:true,keyword:'flying'},effect('continuous',{layer:'7c',transform:{power:Number(m[1]),toughness:Number(m[2])}}))]}}:null;}),
  template('phase70.combat-damage-discard','Combat damage to player makes that player discard.',({text})=>/^Whenever this creature deals combat damage to a player, that player discards a card\.$/i.test(text)?{ast:{type:'card',abilities:[trigger('COMBAT_DAMAGE',effect('discard',{amount:1,controller:'damagedPlayer'}),{sourceSelf:true,toPlayer:true})]}}:null),
  template('phase70.damage-lifelink-worded','Whenever source deals damage, gain that much life.',({text})=>/^Whenever this creature deals damage, you gain that much life\.$/i.test(text)?{ast:{type:'card',abilities:[trigger('DAMAGE_DEALT',effect('gainLife',{amount:'eventDamage'}),{sourceSelf:true})]}}:null),
  template('phase70.spell-target-discard','Target player discards one card.',({text,card})=>/^Target player discards a card\.$/i.test(text)&&/Instant|Sorcery/i.test(card?.typeLine||'')?{ast:{type:'card',abilities:[spell(effect('discard',{amount:1}),{kind:'player'})]}}:null),
  template('phase70.spell-exile-grave-card','Exile target card from graveyard.',({text,card})=>/^Exile target card from a graveyard\.$/i.test(text)&&/Instant|Sorcery/i.test(card?.typeLine||'')?{ast:{type:'card',abilities:[spell(effect('exile'),{kind:'card',zone:'graveyard'})]}}:null),
  template('phase70.destroy-artifact-land','Destroy target artifact or land.',({text,card})=>/^Destroy target artifact or land\.$/i.test(text)&&/Instant|Sorcery/i.test(card?.typeLine||'')?{ast:{type:'card',abilities:[spell(effect('destroy'),{kind:'permanent',types:['Artifact','Land']})]}}:null),
  template('phase70.tap-up-to-two','Tap up to two target creatures.',({text,card})=>/^Tap up to two target creatures\.$/i.test(text)&&/Instant|Sorcery/i.test(card?.typeLine||'')?{ast:{type:'card',abilities:[spell(effect('scriptTap'),{kind:'permanent',type:'Creature'}, {minTargets:0,maxTargets:2})]}}:null),
  template('phase70.block-flying-pump','Blocking flying creature pumps source.',({text})=>{const m=text.match(/^Whenever this creature blocks a creature with flying, this creature gets ([+-]\d+)\/([+-]\d+) until end of turn\.$/i);return m?{ast:{type:'card',abilities:[trigger('BLOCK',effect('modifyCharacteristics',{power:Number(m[1]),toughness:Number(m[2]),duration:'untilEndOfTurn',target:'self'}),{sourceSelf:true,blockedKeyword:'flying'})]}}:null;}),
  template('phase70.cast-is-pump','Instant/sorcery cast trigger pumps source.',({text})=>{const m=text.match(/^Whenever you cast an instant or sorcery spell, this creature gets ([+-]\d+)\/([+-]\d+) until end of turn\.$/i);return m?{ast:{type:'card',abilities:[trigger('SPELL_CAST',effect('modifyCharacteristics',{power:Number(m[1]),toughness:Number(m[2]),duration:'untilEndOfTurn',target:'self'}),{controllerEvent:true,types:['Instant','Sorcery']})]}}:null;}),
  template('phase70.heroic-counter','Heroic targeting trigger adds counter.',({text})=>{const m=text.match(/^Heroic — Whenever you cast a spell that targets this creature, put a \+(\d+)\/\+(\d+) counter on this creature\.$/i);return m&&m[1]===m[2]?{ast:{type:'card',abilities:[trigger('SPELL_CAST',effect('addCounter',{counter:`+${m[1]}/+${m[2]}`,amount:1,target:'self'}),{controllerEvent:true,targetsSelf:true})]}}:null;}),
  template('phase70.foretell','Foretell casting option.',({text})=>{const m=text.match(/^Foretell ((?:\{[^}]+\})+)\s*(?:\([^]*\))?$/i);return m?{ast:{type:'card',abilities:[],cardPatch:{foretellCost:m[1]}}}:null;}),
  template('phase70.retrace','Retrace graveyard casting permission.',({text})=>/^Retrace(?:\s*\([^]*\))?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{retrace:true}}}:null),
  template('phase70.buyback','Buyback additional cost and return-on-resolution option.',({text})=>{const m=text.match(/^Buyback ((?:\{[^}]+\})+)\s*(?:\([^]*\))?$/i);return m?{ast:{type:'card',abilities:[],cardPatch:{buybackCost:m[1]}}}:null;}),
  template('phase70.storm','Storm spell-copy trigger.',({text})=>/^Storm(?:\s*\([^]*\))?$/i.test(text)?{ast:{type:'card',abilities:[trigger('SPELL_CAST',effect('copySpell',{count:'spellsCastBeforeThisTurn',allowNewTargets:true}),{sourceSelf:true})]}}:null),
  template('phase70.persist','Persist death replacement/trigger.',({text})=>/^Persist(?:\s*\([^]*\))?$/i.test(text)?{ast:{type:'card',abilities:[trigger('DIES',effect('returnTarget',{target:'self',destination:'battlefield',counter:'-1/-1',counterAmount:1}),{sourceSelf:true,noCounter:'-1/-1'})]}}:null),
  template('phase70.undying','Undying death trigger.',({text})=>/^Undying(?:\s*\([^]*\))?$/i.test(text)?{ast:{type:'card',abilities:[trigger('DIES',effect('returnTarget',{target:'self',destination:'battlefield',counter:'+1/+1',counterAmount:1}),{sourceSelf:true,noCounter:'+1/+1'})]}}:null),
  template('phase70.evolve','Evolve ETB comparison trigger.',({text})=>/^Evolve(?:\s*\([^]*\))?$/i.test(text)?{ast:{type:'card',abilities:[trigger('ENTER_BATTLEFIELD',effect('addCounter',{counter:'+1/+1',amount:1,target:'self'}),{controllerEvent:true,cardType:'Creature',notSelfEvent:true,greaterPowerOrToughnessThanSelf:true})]}}:null),
  template('phase70.renown','Renown combat-damage trigger.',({text})=>{const m=text.match(/^Renown (\d+)(?:\s*\([^]*\))?$/i);return m?{ast:{type:'card',abilities:[trigger('COMBAT_DAMAGE',effect('addCounter',{counter:'+1/+1',amount:Number(m[1]),target:'self',markRenowned:true}),{sourceSelf:true,toPlayer:true,ifNotRenowned:true})]}}:null;}),
  template('phase70.bushido','Bushido block combat trigger.',({text})=>{const m=text.match(/^Bushido (\d+)(?:\s*\([^]*\))?$/i);return m?{ast:{type:'card',abilities:[trigger('BLOCK_OR_BLOCKED',effect('modifyCharacteristics',{power:Number(m[1]),toughness:Number(m[1]),duration:'untilEndOfTurn',target:'self'}),{sourceSelf:true})]}}:null;}),
  template('phase70.toxic','Toxic poison combat damage.',({text})=>{const m=text.match(/^Toxic (\d+)(?:\s*\([^]*\))?$/i);return m?{ast:{type:'card',abilities:[trigger('COMBAT_DAMAGE',effect('addCounter',{counter:'poison',amount:Number(m[1]),target:'damagedPlayer'}),{sourceSelf:true,toPlayer:true})]}}:null;}),
  template('phase70.unearth','Unearth graveyard activation.',({text})=>{const m=text.match(/^Unearth ((?:\{[^}]+\})+)\s*(?:\([^]*\))?$/i);return m?{ast:{type:'card',abilities:[activated({mana:m[1],sourceZone:'graveyard'},effect('encore',{mode:'unearth',target:'self',haste:true,exileAtEndStep:true,exileIfLeaves:true}),null,{timing:'sorcery'})]}}:null;}),
  template('phase70.landcycling','Basic typed landcycling.',({text})=>{const m=text.match(/^(Plains|Island|Swamp|Mountain|Forest)cycling ((?:\{[^}]+\})+)\s*(?:\([^]*\))?$/i);return m?{ast:{type:'card',abilities:[activated({mana:m[2],discardSelf:true},effect('search',{filter:{type:'Land',subtype:m[1]},destination:'hand'}),null,{sourceZones:['hand'],metadata:{mechanic:'landcycling'}})]}}:null;}),
  template('phase70.static-threshold-pump','Threshold graveyard static pump.',({text})=>{const m=text.match(/^Threshold — This creature gets ([+-]\d+)\/([+-]\d+) as long as there are seven or more cards in your graveyard\.$/i);return m?{ast:{type:'card',abilities:[staticAbility({self:true,condition:{graveyardCardsAtLeast:7}},effect('continuous',{layer:'7c',transform:{power:Number(m[1]),toughness:Number(m[2])}}))]}}:null;}),
  template('phase70.additional-block','Can block one additional creature.',({text})=>/^This creature can block an additional creature each combat\.$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{additionalBlocks:1}}}:null),
  template('phase70.skulk','Skulk blocker power restriction.',({text})=>/^Skulk(?:\s*\([^]*\))?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{blockRestriction:{blockerPowerNotGreaterThanSource:true}}}}:null),
  template('phase70.split-second','Split second stack restriction.',({text})=>/^Split second(?:\s*\([^]*\))?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{splitSecond:true}}}:null),
];
const TEMPLATES = [
  // Phase 90 — turn-scoped keyword characteristic, derived continuously.
  template('phase90.own-turn-first-strike', 'This creature has first strike during its controller turn.', ({ text }) =>
    /^During your turn, this creature has first strike\.$/i.test(text) ? { ast:{type:'card',abilities:[],cardPatch:{ownTurnKeywords:['first strike']}} } : null),
  // Phase 89 — Living metal is a layer-4 type-changing ability active on its controller turn.
  template('phase89.living-metal', 'Living metal Vehicle type change during controller turn.', ({ text }) =>
    /^Living metal(?: \(During your turn, this Vehicle is also a creature\.\))?$/i.test(text) ? { ast:{type:'card',abilities:[],cardPatch:{keywords:['living metal'],livingMetal:true}} } : null),
  // Phase 88 — Phasing is a turn-based action handled before untapping.
  template('phase88.phasing', 'Phasing turn-based action.', ({ text }) =>
    /^Phasing(?: \(This phases in or out before you untap during each of your untap steps\. While it's phased out, it's treated as though it doesn't exist\.\))?$/i.test(text) ? { ast:{type:'card',abilities:[],cardPatch:{keywords:['phasing'],phasing:true}} } : null),
  template('phase81.etb-modal-simple', 'Creature ETB choose-one modes with executable mode and target locking.', ({ text }) => { const modes = triggeredModalOracle(text); return modes ? { ast: { type: 'card', abilities: [trigger('ENTER_BATTLEFIELD', null, null, { source: 'self', modes })] } } : null; }),
  ...PHASE71_BATCH2_TEMPLATES,
  ...PHASE70_BATCH2_TEMPLATES,
  ...PHASE69_BATCH1_TEMPLATES,
  ...PHASE67_BROAD_TEMPLATES,
  template('multiplayer.become-monarch', 'A spell or self-ETB ability makes its controller the monarch.', ({ text }) => {
    if (/^You become the monarch\.?$/i.test(text)) return { ast: { type: 'card', abilities: [spell(effect('becomeMonarch'))] } };
    const etb = selfEtbPrefix(text);
    if (etb && /^you become the monarch\.?$/i.test(text.slice(etb[0].length))) return { ast: { type: 'card', abilities: [trigger('ENTER_BATTLEFIELD', effect('becomeMonarch'), null, { source: 'self' })] } };
    return null;
  }),
  template('modal.choose-one-simple', 'Choose one among two to four exact simple modes; the chosen mode is locked on the stack.', ({ text, card }) => {
    if (!/\b(Instant|Sorcery)\b/i.test(card?.typeLine || '')) return null;
    const modes = modalOracle(text);
    return modes ? { ast: { type: 'card', abilities: [], modes } } : null;
  }),

  template('target.optional-up-to-one-destroy', 'Destroy up to one target permanent of a supported kind.', ({ text, card }) => {
    if (!/\b(Instant|Sorcery)\b/i.test(card?.typeLine || '')) return null;
    const m = text.match(/^Destroy up to one target (creature|artifact|enchantment|nonland permanent)\.$/i);
    if (!m) return null;
    const targets = targetSelector(m[1]);
    return targets ? { ast: { type: 'card', abilities: [spell(effect('destroy'), targets, { minTargets: 0, maxTargets: 1, optional: true })] } } : null;
  }),

  template('target.optional-up-to-one-exile', 'Exile up to one target permanent of a supported kind.', ({ text, card }) => {
    if (!/\b(Instant|Sorcery)\b/i.test(card?.typeLine || '')) return null;
    const m = text.match(/^Exile up to one target (creature|artifact|enchantment|nonland permanent)\.$/i);
    if (!m) return null;
    const targets = targetSelector(m[1]);
    return targets ? { ast: { type: 'card', abilities: [spell(effect('exile'), targets, { minTargets: 0, maxTargets: 1, optional: true })] } } : null;
  }),

  template('trigger.opponent-casts-draw', 'Draw when an opponent casts a spell.', ({ text }) => {
    const m = text.match(/^Whenever an opponent casts a spell, draw (a|one|two|three|\d+) cards?\.$/i);
    if (!m) return null;
    const amount = quantityToken(m[1]);
    return amount == null ? null : { ast: { type: 'card', abilities: [trigger('SPELL_CAST', effect('draw', { amount }), { eventController: 'opponent' })] } };
  }),

  template('trigger.other-creature-enters-draw', 'Draw when another creature enters under your control.', ({ text }) => {
    const m = text.match(/^Whenever another creature enters(?: the battlefield)? under your control, draw (a|one|two|three|\d+) cards?\.$/i);
    if (!m) return null;
    const amount = quantityToken(m[1]);
    return amount == null ? null : { ast: { type: 'card', abilities: [trigger('ENTER_BATTLEFIELD', effect('draw', { amount }), { controllerEvent: true, cardType: 'Creature', notSelfEvent: true })] } };
  }),
  template('conditional.spell-control', 'A simple spell effect occurs only if its controller controls a specified permanent type or subtype.', ({ text, card }) => {
    if (!/\b(Instant|Sorcery)\b/i.test(card?.typeLine || '')) return null;
    const m = text.match(/^If you control (an? [^,]+), (.+)$/i);
    if (!m) return null;
    const condition = simpleControlCondition(m[1], 'controller');
    const thenEffect = simpleConditionalEffect(m[2]);
    if (!condition || !thenEffect) return null;
    return { ast: { type: 'card', abilities: [spell(effect('if', { condition, then: thenEffect }))] } };
  }),

  template('conditional.spell-opponent-control', 'A simple spell effect occurs only if an opponent controls a specified permanent type or subtype.', ({ text, card }) => {
    if (!/\b(Instant|Sorcery)\b/i.test(card?.typeLine || '')) return null;
    const m = text.match(/^If an opponent controls (an? [^,]+), (.+)$/i);
    if (!m) return null;
    const condition = simpleControlCondition(m[1], 'opponent');
    const thenEffect = simpleConditionalEffect(m[2]);
    if (!condition || !thenEffect) return null;
    return { ast: { type: 'card', abilities: [spell(effect('if', { condition, then: thenEffect }))] } };
  }),

  template('trigger.etb-intervening-control', 'An ETB trigger with an intervening-if control condition is checked both when triggering and on resolution.', ({ text }) => {
    const m = text.match(/^When this (creature|artifact|enchantment|permanent|land) enters(?: the battlefield)?, if you control (an? [^,]+), (.+)$/i);
    if (!m) return null;
    const gate = simpleControlCondition(m[2], 'controller');
    const body = simpleConditionalEffect(m[3]);
    if (!gate || !body) return null;
    const condition = { controllerEvent: true, sourceEvent: true, ...gate };
    return { ast: { type: 'card', abilities: [trigger('ENTER_BATTLEFIELD', body, condition, { interveningIf: gate })] } };
  }),

  template('trigger.upkeep-intervening-control', 'A beginning-of-upkeep trigger with an intervening-if control condition is checked at trigger and resolution.', ({ text }) => {
    const m = text.match(/^At the beginning of your upkeep, if you control (an? [^,]+), (.+)$/i);
    if (!m) return null;
    const gate = simpleControlCondition(m[1], 'controller');
    const body = simpleConditionalEffect(m[2]);
    if (!gate || !body) return null;
    const condition = { controllerEvent: true, phase: 'upkeep', ...gate };
    return { ast: { type: 'card', abilities: [trigger('STEP_BEGIN', body, condition, { interveningIf: gate })] } };
  }),

  template('trigger.attack-intervening-control', 'A self-attack trigger with an intervening-if control condition is checked at trigger and resolution.', ({ text }) => {
    const m = text.match(/^Whenever this creature attacks, if you control (an? [^,]+), (.+)$/i);
    if (!m) return null;
    const gate = simpleControlCondition(m[1], 'controller');
    const body = simpleConditionalEffect(m[2]);
    if (!gate || !body) return null;
    const condition = { sourceAttacking: true, ...gate };
    return { ast: { type: 'card', abilities: [trigger('ATTACK_DECLARED', body, condition, { interveningIf: gate })] } };
  }),
  template('casting.flashback', 'Flashback grants a graveyard casting option with an alternative mana cost and exile-on-leave-stack handling.', ({ text }) => {
    const m = text.match(/^Flashback\s+((?:\{[^}]+\})+)\s*(?:\([^)]*\))?$/i);
    if (!m) return null;
    return { ast: { type: 'card', abilities: [], cardPatch: { castingOptions: [{ id: 'flashback', fromZone: 'graveyard', castOption: 'flashback', manaCost: m[1], exileOnLeaveStack: true }] } } };
  }),

  template('casting.self-from-graveyard', 'This card may be cast from its owner graveyard for its normal cost.', ({ text }) => {
    if (!/^You may cast this card from your graveyard\.$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [], cardPatch: { castingOptions: [{ id: 'graveyard', fromZone: 'graveyard', castOption: 'graveyard' }] } } };
  }),

  template('casting.self-from-exile', 'This card may be cast from exile for its normal cost.', ({ text }) => {
    if (!/^You may cast this card from exile\.$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [], cardPatch: { castingOptions: [{ id: 'exile', fromZone: 'exile', castOption: 'exile' }] } } };
  }),


  template('casting.self-from-graveyard-flash', 'This card may be cast from its owner graveyard at instant timing.', ({ text }) => {
    if (!/^You may cast this card from your graveyard as though it had flash\.$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [], cardPatch: { castingOptions: [{ id: 'graveyard-flash', fromZone: 'graveyard', castOption: 'graveyard-flash', timing: 'instant' }] } } };
  }),

  template('casting.self-from-exile-flash', 'This card may be cast from exile at instant timing.', ({ text }) => {
    if (!/^You may cast this card from exile as though it had flash\.$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [], cardPatch: { castingOptions: [{ id: 'exile-flash', fromZone: 'exile', castOption: 'exile-flash', timing: 'instant' }] } } };
  }),

  template('casting.graveyard-alternative-cost', 'This card may be cast from the graveyard for a printed alternative mana cost.', ({ text }) => {
    const m = text.match(/^You may cast this card from your graveyard by paying ((?:\{[^}]+\})+) rather than paying its mana cost\.$/i);
    if (!m) return null;
    return { ast: { type: 'card', abilities: [], cardPatch: { castingOptions: [{ id: 'graveyard-alt', fromZone: 'graveyard', castOption: 'graveyard-alt', manaCost: m[1] }] } } };
  }),

  template('casting.exile-alternative-cost', 'This card may be cast from exile for a printed alternative mana cost.', ({ text }) => {
    const m = text.match(/^You may cast this card from exile by paying ((?:\{[^}]+\})+) rather than paying its mana cost\.$/i);
    if (!m) return null;
    return { ast: { type: 'card', abilities: [], cardPatch: { castingOptions: [{ id: 'exile-alt', fromZone: 'exile', castOption: 'exile-alt', manaCost: m[1] }] } } };
  }),

  template('casting.graveyard-without-mana-cost', 'This card may be cast from the graveyard without paying its mana cost.', ({ text }) => {
    if (!/^You may cast this card from your graveyard without paying its mana cost\.$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [], cardPatch: { castingOptions: [{ id: 'graveyard-free', fromZone: 'graveyard', castOption: 'graveyard-free', withoutManaCost: true }] } } };
  }),

  template('casting.exile-without-mana-cost', 'This card may be cast from exile without paying its mana cost.', ({ text }) => {
    if (!/^You may cast this card from exile without paying its mana cost\.$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [], cardPatch: { castingOptions: [{ id: 'exile-free', fromZone: 'exile', castOption: 'exile-free', withoutManaCost: true }] } } };
  }),

  template('replacement.self-enters-tapped', 'This permanent enters tapped via a MOVE_ZONE replacement effect.', ({ text }) => {
    if (!/^This (?:permanent|creature|artifact|enchantment|land) enters tapped\.$/i.test(text) && !/^~ enters tapped\.$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [replacementAbility('MOVE_ZONE', { self: true, toZone: 'battlefield' }, { kind: 'enterTapped' })] } };
  }),

  template('replacement.creature-dies-exile', 'Creatures that would die are exiled instead.', ({ text }) => {
    if (!/^If a creature would die, exile it instead\.$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [replacementAbility('MOVE_ZONE', { type: 'Creature', fromZone: 'battlefield', toZone: 'graveyard' }, { kind: 'setDestination', zone: 'exile' })] } };
  }),

  template('replacement.self-dies-exile', 'This permanent is exiled instead of going to a graveyard when it would die.', ({ text }) => {
    if (!/^If this (creature|permanent) would die, exile it instead\.$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [replacementAbility('MOVE_ZONE', { self: true, fromZone: 'battlefield', toZone: 'graveyard' }, { kind: 'setDestination', zone: 'exile' })] } };
  }),

  template('replacement.double-tokens-you-create', 'Token creation is doubled for the source controller.', ({ text }) => {
    if (!/^If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead\.$/i.test(text)
      && !/^If you would create one or more tokens, create twice that many of those tokens instead\.$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [replacementAbility('CREATE_TOKEN', { controller: 'you' }, { kind: 'multiplyAmount', factor: 2 })] } };
  }),

  template('replacement.double-counters-you-permanent', 'Counters placed on permanents you control are doubled.', ({ text }) => {
    if (!/^If one or more counters would be put on a permanent you control, twice that many of each of those kinds of counters are put on that permanent instead\.$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [replacementAbility('ADD_COUNTER', { controller: 'you' }, { kind: 'multiplyAmount', factor: 2 })] } };
  }),

  template('replacement.extra-plus-counter-you-permanent', 'One additional +1/+1 counter is placed on affected permanents you control.', ({ text }) => {
    if (!/^If one or more \+1\/\+1 counters would be put on a creature you control, that many plus one \+1\/\+1 counters are put on it instead\.$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [replacementAbility('ADD_COUNTER', { type: 'Creature', controller: 'you', counterType: '+1/+1' }, { kind: 'addAmount', amount: 1 })] } };
  }),

  template('replacement.double-life-gain-you', 'Life gain by the source controller is doubled.', ({ text }) => {
    if (!/^If you would gain life, you gain twice that much life instead\.$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [replacementAbility('GAIN_LIFE', { controller: 'you' }, { kind: 'multiplyAmount', factor: 2 })] } };
  }),

  template('replacement.prevent-damage-you', 'Damage that would be dealt to the source controller is prevented.', ({ text }) => {
    if (!/^If damage would be dealt to you, prevent that damage\.$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [replacementAbility('DEAL_DAMAGE', { controller: 'you' }, { kind: 'prevent' })] } };
  }),

  template('replacement.prevent-damage-self', 'Damage that would be dealt to this permanent is prevented.', ({ text }) => {
    if (!/^If damage would be dealt to this (creature|permanent), prevent that damage\.$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [replacementAbility('DEAL_DAMAGE', { self: true }, { kind: 'prevent' })] } };
  }),
  template('static.creatures-you-control-pt', 'Creatures you control receive a fixed power/toughness modification through the continuous-effect layer system.', ({ text }) => {
    const m = text.match(/^Creatures you control get ([+-]\d+)\/([+-]\d+)\.$/i);
    if (!m) return null;
    return { ast: { type: 'card', abilities: [staticAbility({ type: 'Creature', controller: 'you' }, { power: Number(m[1]), toughness: Number(m[2]) })] } };
  }),

  template('static.other-creatures-you-control-pt', 'Other creatures you control receive a fixed power/toughness modification.', ({ text }) => {
    const m = text.match(/^Other creatures you control get ([+-]\d+)\/([+-]\d+)\.$/i);
    if (!m) return null;
    return { ast: { type: 'card', abilities: [staticAbility({ type: 'Creature', controller: 'you', other: true }, { power: Number(m[1]), toughness: Number(m[2]) })] } };
  }),

  template('static.opponents-creatures-pt', 'Creatures opponents control receive a fixed power/toughness modification.', ({ text }) => {
    const m = text.match(/^Creatures your opponents control get ([+-]\d+)\/([+-]\d+)\.$/i);
    if (!m) return null;
    return { ast: { type: 'card', abilities: [staticAbility({ type: 'Creature', controller: 'opponent' }, { power: Number(m[1]), toughness: Number(m[2]) })] } };
  }),

  template('static.creatures-you-control-keywords', 'Creatures you control gain one or more reusable keywords in layer 6.', ({ text }) => {
    const m = text.match(/^Creatures you control have (.+)\.$/i);
    const keywords = m && parseKeywordList(m[1]);
    if (!keywords) return null;
    return { ast: { type: 'card', abilities: [staticAbility({ type: 'Creature', controller: 'you' }, { keywords })] } };
  }),

  template('static.other-creatures-you-control-keywords', 'Other creatures you control gain one or more reusable keywords in layer 6.', ({ text }) => {
    const m = text.match(/^Other creatures you control have (.+)\.$/i);
    const keywords = m && parseKeywordList(m[1]);
    if (!keywords) return null;
    return { ast: { type: 'card', abilities: [staticAbility({ type: 'Creature', controller: 'you', other: true }, { keywords })] } };
  }),

  template('static.opponents-creatures-lose-keywords', 'Creatures opponents control lose one or more reusable keywords in layer 6.', ({ text }) => {
    const m = text.match(/^Creatures your opponents control lose (.+)\.$/i);
    const keywords = m && parseKeywordList(m[1]);
    if (!keywords) return null;
    return { ast: { type: 'card', abilities: [staticAbility({ type: 'Creature', controller: 'opponent' }, { removeKeywords: keywords })] } };
  }),
  template('attachment.aura-enchant-clause', 'Standalone Aura enchant restriction used during paragraph composition.', ({ text, card }) => {
    if (!/Aura/i.test(card?.typeLine || '')) return null;
    const m = text.match(/^Enchant (creature|land|artifact|enchantment|permanent|player|artifact or creature|creature or Vehicle)( you control)?(?: \([^)]*\))?$/i);
    if (!m) return null;
    const kind = m[1].toLowerCase();
    const controller = m[2] ? 'you' : undefined;
    const selector = kind === 'player' ? { kind: 'player', ...(controller ? { controller } : {}) } : kind === 'artifact or creature' ? { kind: 'permanent', types: ['Artifact', 'Creature'], ...(controller ? { controller } : {}) } : kind === 'creature or vehicle' ? { kind: 'permanent', types: ['Creature', 'Vehicle'], ...(controller ? { controller } : {}) } : { kind: 'permanent', ...(kind === 'permanent' ? {} : { type: kind[0].toUpperCase() + kind.slice(1) }), ...(controller ? { controller } : {}) };
    return { ast: { type: 'card', abilities: [], cardPatch: { targets: { ...selector, minTargets: 1, maxTargets: 1 }, enchantFilter: selector } } };
  }),

  template('attachment.equip-clause', 'Standalone fixed equip cost used during paragraph composition.', ({ text, card }) => {
    if (!/Equipment/i.test(card?.typeLine || '')) return null;
    const m = text.match(/^Equip ((?:\{[^}]+\})+)(?: \([^)]*\))?$/i);
    return m ? { ast: { type: 'card', abilities: [], cardPatch: { equipCost: m[1] } } } : null;
  }),

  template('attachment.equipped-pt-clause', 'Standalone equipped-creature fixed power/toughness modifier.', ({ text, card }) => {
    if (!/Equipment/i.test(card?.typeLine || '')) return null;
    const m = text.match(/^Equipped creature gets ([+-]\d+)\/([+-]\d+)\.$/i);
    return m ? { ast: { type: 'card', abilities: [staticAbility({ attachedToSource: true }, { power: Number(m[1]), toughness: Number(m[2]) })] } } : null;
  }),

  template('attachment.enchanted-pt-clause', 'Standalone enchanted-creature fixed power/toughness modifier.', ({ text, card }) => {
    if (!/Aura/i.test(card?.typeLine || '')) return null;
    const m = text.match(/^Enchanted creature gets ([+-]\d+)\/([+-]\d+)\.$/i);
    return m ? { ast: { type: 'card', abilities: [staticAbility({ attachedToSource: true }, { power: Number(m[1]), toughness: Number(m[2]) })] } } : null;
  }),

  template('attachment.equipment-pt', 'Equipment with a fixed equipped-creature power/toughness bonus and a fixed equip cost.', ({ text, card }) => {
    if (!/Equipment/i.test(card?.typeLine || '')) return null;
    const m = text.match(/^Equipped creature gets ([+-]\d+)\/([+-]\d+)\.\nEquip (\{[^\n]+\})$/i);
    if (!m) return null;
    return { ast: { type: 'card', abilities: [staticAbility({ attachedToSource: true }, { power: Number(m[1]), toughness: Number(m[2]) })], cardPatch: { equipCost: m[3] } } };
  }),

  template('attachment.equipment-keywords', 'Equipment granting exact reusable keywords with a fixed equip cost.', ({ text, card }) => {
    if (!/Equipment/i.test(card?.typeLine || '')) return null;
    const m = text.match(/^Equipped creature has (.+)\.\nEquip (\{[^\n]+\})$/i);
    const keywords = m && parseKeywordList(m[1]);
    if (!m || !keywords) return null;
    return { ast: { type: 'card', abilities: [staticAbility({ attachedToSource: true }, { keywords })], cardPatch: { equipCost: m[2] } } };
  }),

  template('attachment.aura-creature-pt', 'Creature Aura with a fixed enchanted-creature power/toughness bonus.', ({ text, card }) => {
    if (!/Aura/i.test(card?.typeLine || '')) return null;
    const m = text.match(/^Enchant creature\nEnchanted creature gets ([+-]\d+)\/([+-]\d+)\.$/i);
    if (!m) return null;
    return { ast: { type: 'card', abilities: [staticAbility({ attachedToSource: true }, { power: Number(m[1]), toughness: Number(m[2]) })], cardPatch: { targets: { kind: 'permanent', type: 'Creature', minTargets: 1, maxTargets: 1 }, enchantFilter: { kind: 'permanent', type: 'Creature' } } } };
  }),

  template('attachment.aura-creature-keywords', 'Creature Aura granting exact reusable keywords to the enchanted creature.', ({ text, card }) => {
    if (!/Aura/i.test(card?.typeLine || '')) return null;
    const m = text.match(/^Enchant creature\nEnchanted creature has (.+)\.$/i);
    const keywords = m && parseKeywordList(m[1]);
    if (!m || !keywords) return null;
    return { ast: { type: 'card', abilities: [staticAbility({ attachedToSource: true }, { keywords })], cardPatch: { targets: { kind: 'permanent', type: 'Creature', minTargets: 1, maxTargets: 1 }, enchantFilter: { kind: 'permanent', type: 'Creature' } } } };
  }),

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

  template('spell.gain-life-fixed', 'Gain a fixed amount of life.', ({ text }) => {
    const m = text.match(/^You gain (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) life\.$/i);
    const amount = m && quantityToken(m[1]);
    return amount == null ? null : { ast: { type: 'card', abilities: [spell(effect('gainLife', { amount }))] } };
  }),

  template('spell.lose-life-fixed', 'You lose a fixed amount of life.', ({ text }) => {
    const m = text.match(/^You lose (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) life\.$/i);
    const amount = m && quantityToken(m[1]);
    return amount == null ? null : { ast: { type: 'card', abilities: [spell(effect('loseLife', { amount }))] } };
  }),

  template('spell.mill-self-fixed', 'Mill a fixed number of cards.', ({ text }) => {
    const m = text.match(/^Mill (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?\.$/i);
    const amount = m && quantityToken(m[1]);
    return amount == null ? null : { ast: { type: 'card', abilities: [spell(effect('mill', { amount }))] } };
  }),

  template('spell.discard-self-fixed', 'Discard a fixed number of cards.', ({ text }) => {
    const m = text.match(/^Discard (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?\.$/i);
    const amount = m && quantityToken(m[1]);
    return amount == null ? null : { ast: { type: 'card', abilities: [spell(effect('discard', { amount }))] } };
  }),

  template('spell.tap-target-creature', 'Tap target creature.', ({ text }) => {
    if (!/^Tap target creature\.$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [spell(effect('tap'), { kind: 'permanent', type: 'Creature' })] } };
  }),

  template('spell.untap-target-creature', 'Untap target creature.', ({ text }) => {
    if (!/^Untap target creature\.$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [spell(effect('untap'), { kind: 'permanent', type: 'Creature' })] } };
  }),

  template('spell.bounce-target', 'Return one supported target permanent to its owner hand.', ({ text }) => {
    const m = text.match(/^Return target (.+) to its owner's hand\.$/i);
    if (!m) return null;
    const targets = targetSelector(m[1]);
    return targets ? { ast: { type: 'card', abilities: [spell(effect('moveZone', { toZone: 'hand' }), targets)] } } : null;
  }),

  template('spell.add-counter-target-creature', 'Put fixed +1/+1 counters on target creature.', ({ text }) => {
    const m = text.match(/^Put (a|one|two|three|four|five|six|\d+) \+1\/\+1 counters? on target creature\.$/i);
    const amount = m && quantityToken(m[1]);
    return amount == null ? null : { ast: { type: 'card', abilities: [spell(effect('addCounter', { counter: '+1/+1', amount }), { kind: 'permanent', type: 'Creature' })] } };
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


  template('spell.draw-then-discard-fixed', 'Draw a fixed number of cards, then discard a fixed number of cards.', ({ text }) => {
    const m = text.match(/^Draw (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?, then discard (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?\.$/i);
    const drawAmount = m && quantityToken(m[1]);
    const discardAmount = m && quantityToken(m[2]);
    if (drawAmount == null || discardAmount == null) return null;
    return { ast: { type: 'card', abilities: [spell(effect('sequence', { effects: [effect('draw', { amount: drawAmount }), effect('discard', { amount: discardAmount })] }))] } };
  }),

  template('spell.scry-one', 'Scry 1 using the authoritative hidden-information choice pipeline.', ({ text }) => {
    if (!/^Scry 1\.$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [spell(effect('scry', { amount: 1 }))] } };
  }),

  template('spell.surveil-one', 'Surveil 1 using the authoritative hidden-information choice pipeline.', ({ text }) => {
    if (!/^Surveil 1\.$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [spell(effect('surveil', { amount: 1 }))] } };
  }),

  template('spell.two-creatures-fight', 'Two target creatures fight using simultaneous noncombat damage.', ({ text }) => {
    if (!/^Two target creatures fight each other\.$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [spell(effect('fight'), { kind: 'permanent', type: 'Creature' }, { minTargets: 2, maxTargets: 2 })] } };
  }),

  template('spell.target-gains-keyword-eot', 'Grant a supported keyword to target creature until end of turn.', ({ text }) => {
    const m = text.match(/^Target (creature(?: you control| an opponent controls)?) gains (flying|reach|first strike|double strike|deathtouch|trample|vigilance|lifelink|haste|hexproof|menace|indestructible) until end of turn\.$/i);
    if (!m) return null;
    const targets = targetSelector(m[1]);
    return targets ? { ast: { type: 'card', abilities: [spell(effect('grantAbility', { ability: m[2].toLowerCase(), duration: 'until-end-of-turn' }), targets)] } } : null;
  }),

  template('spell.return-graveyard-card-to-hand', 'Return a supported target card from your graveyard to your hand.', ({ text }) => {
    const m = text.match(/^Return target (creature|artifact|enchantment|land|permanent) card from your graveyard to your hand\.$/i);
    if (!m) return null;
    const type = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
    return { ast: { type: 'card', abilities: [spell(effect('moveZone', { toZone: 'hand' }), { kind: 'card', zone: 'graveyard', owner: 'you', ...(type === 'Permanent' ? { permanent: true } : { type }) })] } };
  }),

  template('trigger.upkeep-fixed-life', 'Gain or lose a fixed amount of life at the beginning of your upkeep.', ({ text }) => {
    const m = text.match(/^At the beginning of your upkeep, you (gain|lose) (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) life\.$/i);
    const amount = m && quantityToken(m[2]);
    if (amount == null) return null;
    return { ast: { type: 'card', abilities: [trigger('STEP_STARTED', effect(m[1].toLowerCase() === 'gain' ? 'gainLife' : 'loseLife', { amount }), { controllerEvent: true, step: 'upkeep' })] } };
  }),

  template('trigger.end-step-draw-fixed', 'Draw a fixed number of cards at the beginning of your end step.', ({ text }) => {
    const m = text.match(/^At the beginning of your end step, draw (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?\.$/i);
    const amount = m && quantityToken(m[1]);
    if (amount == null) return null;
    return { ast: { type: 'card', abilities: [trigger('STEP_STARTED', effect('draw', { amount }), { controllerEvent: true, step: 'end' })] } };
  }),

  template('activated.generic-mana-tap-basic', 'Pay generic mana and tap this permanent for a simple reusable effect.', ({ text }) => {
    const m = text.match(/^\{(\d+)\}, \{T\}: (Draw a card|You gain (\d+) life|Untap target creature|Tap target creature)\.$/i);
    if (!m) return null;
    const cost = { mana: `{${m[1]}}`, tap: true };
    const clause = m[2].toLowerCase();
    if (clause === 'draw a card') return { ast: { type: 'card', abilities: [activated(cost, effect('draw', { amount: 1 }))] } };
    if (clause.startsWith('you gain ')) return { ast: { type: 'card', abilities: [activated(cost, effect('gainLife', { amount: Number(m[3]) }))] } };
    const targets = { kind: 'permanent', type: 'Creature' };
    return { ast: { type: 'card', abilities: [activated(cost, effect(clause.startsWith('untap') ? 'untap' : 'tap'), targets)] } };
  }),



  template('spell.draw-for-each-creature-you-control', 'Draw a card for each creature you control.', ({ text }) => {
    if (!/^Draw a card for each creature you control\.$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [spell(effect('draw', { amount: { countSelector: { kind: 'permanent', controller: 'you', type: 'Creature' } } }))] } };
  }),

  template('spell.draw-for-each-artifact-you-control', 'Draw a card for each artifact you control.', ({ text }) => {
    if (!/^Draw a card for each artifact you control\.$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [spell(effect('draw', { amount: { countSelector: { kind: 'permanent', controller: 'you', type: 'Artifact' } } }))] } };
  }),

  template('spell.draw-equal-cards-in-hand', 'Draw cards equal to the number of cards in your hand.', ({ text }) => {
    if (!/^Draw cards equal to the number of cards in your hand\.$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [spell(effect('draw', { amount: { controllerHandCount: true } }))] } };
  }),

  template('trigger.etb-draw-equal-source-power', 'Draw cards equal to this permanent power when it enters.', ({ text }) => {
    const prefix = selfEtbPrefix(text);
    if (!prefix || !/^draw cards equal to (?:its|this creature's) power\.$/i.test(text.slice(prefix[0].length))) return null;
    return { ast: { type: 'card', abilities: [trigger('ENTER_BATTLEFIELD', effect('draw', { amount: { sourcePower: true } }), { controllerEvent: true, sourceEvent: true })] } };
  }),

  template('trigger.dies-draw-for-each-counter', 'Draw a card for each +1/+1 counter on this creature when it dies.', ({ text }) => {
    if (!/^When this creature dies, draw a card for each \+1\/\+1 counter on it\.$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [trigger('DIES', effect('draw', { amount: { eventField: 'object.counters.+1/+1' } }), { controllerEvent: true, sourceEvent: true })] } };
  }),

  template('spell.each-opponent-loses-life-fixed', 'Each opponent loses a fixed amount of life.', ({ text }) => {
    const m = text.match(/^Each opponent loses (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) life\.$/i);
    const amount = m && quantityToken(m[1]);
    if (amount == null) return null;
    return { ast: { type: 'card', abilities: [spell(effect('forEach', {
      selector: { kind: 'player', player: 'opponent' }, as: 'affectedPlayer',
      effect: effect('loseLife', { player: { variable: 'affectedPlayer' }, amount })
    }))] } };
  }),

  template('spell.each-opponent-draws-fixed', 'Each opponent draws a fixed number of cards.', ({ text }) => {
    const m = text.match(/^Each opponent draws (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?\.$/i);
    const amount = m && quantityToken(m[1]);
    if (amount == null) return null;
    return { ast: { type: 'card', abilities: [spell(effect('forEach', {
      selector: { kind: 'player', player: 'opponent' }, as: 'affectedPlayer',
      effect: effect('draw', { player: { variable: 'affectedPlayer' }, amount })
    }))] } };
  }),

  template('spell.each-player-draws-fixed', 'Each player draws a fixed number of cards.', ({ text }) => {
    const m = text.match(/^Each player draws (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?\.$/i);
    const amount = m && quantityToken(m[1]);
    if (amount == null) return null;
    return { ast: { type: 'card', abilities: [spell(effect('forEach', {
      selector: { kind: 'player' }, as: 'affectedPlayer',
      effect: effect('draw', { player: { variable: 'affectedPlayer' }, amount })
    }))] } };
  }),

  template('spell.destroy-all-creatures', 'Destroy all creatures.', ({ text }) => {
    if (!/^Destroy all creatures\.$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [spell(effect('forEach', {
      selector: { kind: 'permanent', type: 'Creature' }, as: 'affectedPermanent', effect: effect('destroy')
    }))] } };
  }),

  template('spell.exile-all-creatures', 'Exile all creatures.', ({ text }) => {
    if (!/^Exile all creatures\.$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [spell(effect('forEach', {
      selector: { kind: 'permanent', type: 'Creature' }, as: 'affectedPermanent', effect: effect('exile')
    }))] } };
  }),

  template('spell.tap-creatures-you-control', 'Tap all creatures you control.', ({ text }) => {
    if (!/^Tap all creatures you control\.$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [spell(effect('forEach', {
      selector: { kind: 'permanent', controller: 'you', type: 'Creature' }, as: 'affectedPermanent', effect: effect('tap')
    }))] } };
  }),

  template('spell.untap-creatures-you-control', 'Untap all creatures you control.', ({ text }) => {
    if (!/^Untap all creatures you control\.$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [spell(effect('forEach', {
      selector: { kind: 'permanent', controller: 'you', type: 'Creature' }, as: 'affectedPermanent', effect: effect('untap')
    }))] } };
  }),

  template('spell.damage-each-opponent-fixed', 'Deal a fixed amount of damage to each opponent.', ({ text }) => {
    const m = text.match(/^(?:This spell|[^.]+) deals (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) damage to each opponent\.$/i);
    const amount = m && quantityToken(m[1]);
    if (amount == null) return null;
    return { ast: { type: 'card', abilities: [spell(effect('forEach', {
      selector: { kind: 'player', player: 'opponent' }, as: 'affectedPlayer', effect: effect('damage', { amount })
    }))] } };
  }),

  template('spell.draw-x', 'Draw X cards using the locked X value chosen while casting the spell.', ({ text }) => {
    if (!/^Draw X cards\.$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [spell(effect('draw', { amount: { xValue: true } }))] } };
  }),

  template('spell.mill-x', 'Mill X cards using the locked X value chosen while casting the spell.', ({ text }) => {
    if (!/^Mill X cards\.$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [spell(effect('mill', { amount: { xValue: true } }))] } };
  }),

  template('spell.may-draw-one', 'Optionally draw one card.', ({ text }) => {
    if (!/^You may draw a card\.$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [spell(effect('may', { prompt: 'Draw a card?', effect: effect('draw', { amount: 1 }) }))] } };
  }),

  template('trigger.upkeep-draw-fixed', 'Draw a fixed number of cards at the beginning of your upkeep.', ({ text }) => {
    const m = text.match(/^At the beginning of your upkeep, draw (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?\.$/i);
    const amount = m && quantityToken(m[1]);
    return amount == null ? null : { ast: { type: 'card', abilities: [trigger('STEP_STARTED', effect('draw', { amount }), { controllerEvent: true, step: 'upkeep' })] } };
  }),

  template('trigger.upkeep-create-common-token', 'Create common utility tokens at the beginning of your upkeep.', ({ text }) => {
    const m = text.match(/^At the beginning of your upkeep, create (a|an|one|two|three|four|five|six|\d+) (Treasure|Clue|Food) tokens?\.$/i);
    const amount = m && quantityToken(m[1]);
    if (amount == null) return null;
    return { ast: { type: 'card', abilities: [trigger('STEP_STARTED', effect('createToken', { token: { name: m[2][0].toUpperCase()+m[2].slice(1).toLowerCase() }, amount }), { controllerEvent: true, step: 'upkeep' })] } };
  }),

  template('trigger.end-step-gain-life', 'Gain a fixed amount of life at the beginning of your end step.', ({ text }) => {
    const m = text.match(/^At the beginning of your end step, you gain (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) life\.$/i);
    const amount = m && quantityToken(m[1]);
    return amount == null ? null : { ast: { type: 'card', abilities: [trigger('STEP_STARTED', effect('gainLife', { amount }), { controllerEvent: true, step: 'end' })] } };
  }),

  template('trigger.end-step-create-common-token', 'Create common utility tokens at the beginning of your end step.', ({ text }) => {
    const m = text.match(/^At the beginning of your end step, create (a|an|one|two|three|four|five|six|\d+) (Treasure|Clue|Food) tokens?\.$/i);
    const amount = m && quantityToken(m[1]);
    if (amount == null) return null;
    return { ast: { type: 'card', abilities: [trigger('STEP_STARTED', effect('createToken', { token: { name: m[2][0].toUpperCase()+m[2].slice(1).toLowerCase() }, amount }), { controllerEvent: true, step: 'end' })] } };
  }),

  template('trigger.attacks-gain-life', 'Gain a fixed amount of life whenever this creature attacks.', ({ text, card }) => {
    const m = text.match(/^Whenever this creature attacks, you gain (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) life\.$/i);
    const amount = m && quantityToken(m[1]);
    if (amount == null || !String(card?.typeLine || '').includes('Creature')) return null;
    return { ast: { type: 'card', abilities: [trigger('CREATURE_ATTACKED', effect('gainLife', { amount }), { controllerEvent: true, sourceEvent: true })] } };
  }),

  template('trigger.dies-gain-life', 'Gain a fixed amount of life when this creature dies.', ({ text, card }) => {
    const m = text.match(/^When this creature dies, you gain (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) life\.$/i);
    const amount = m && quantityToken(m[1]);
    if (amount == null || !String(card?.typeLine || '').includes('Creature')) return null;
    return { ast: { type: 'card', abilities: [trigger('DIES', effect('gainLife', { amount }), { controllerEvent: true, sourceEvent: true })] } };
  }),

  template('trigger.controlled-creature-dies-draw', 'Draw when another creature you control dies.', ({ text }) => {
    const m = text.match(/^Whenever another creature you control dies, draw (a|one|two|three|four|five|six|\d+) cards?\.$/i);
    const amount = m && quantityToken(m[1]);
    if (amount == null) return null;
    return { ast: { type: 'card', abilities: [trigger('CREATURE_DIED', effect('draw', { amount }), { controllerEvent: true, cardType: 'Creature', notSelfEvent: true })] } };
  }),

  template('trigger.dies-may-draw-one', 'Optionally draw a card when this creature dies.', ({ text, card }) => {
    if (!/^When this creature dies, you may draw a card\.$/i.test(text) || !String(card?.typeLine || '').includes('Creature')) return null;
    return { ast: { type: 'card', abilities: [trigger('DIES', effect('may', { prompt: 'Draw a card?', effect: effect('draw', { amount: 1 }) }), { controllerEvent: true, sourceEvent: true })] } };
  }),

  template('trigger.attacks-draw-fixed', 'Draw a fixed number of cards whenever this creature attacks.', ({ text, card }) => {
    const m = text.match(/^Whenever this creature attacks, draw (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?\.$/i);
    const amount = m && quantityToken(m[1]);
    if (amount == null || !String(card?.typeLine || '').includes('Creature')) return null;
    return { ast: { type: 'card', abilities: [trigger('CREATURE_ATTACKED', effect('draw', { amount }), { controllerEvent: true, sourceEvent: true })] } };
  }),

  template('trigger.cast-draw-fixed', 'Draw a fixed number of cards whenever you cast a spell.', ({ text }) => {
    const m = text.match(/^Whenever you cast a spell, draw (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?\.$/i);
    const amount = m && quantityToken(m[1]);
    if (amount == null) return null;
    return { ast: { type: 'card', abilities: [trigger('SPELL_CAST', effect('draw', { amount }), { controllerEvent: true })] } };
  }),

  template('trigger.etb-may-draw-one', 'Optionally draw a card when this permanent enters.', ({ text }) => {
    const prefix = selfEtbPrefix(text);
    if (!prefix || !/^you may draw a card\.$/i.test(text.slice(prefix[0].length))) return null;
    return { ast: { type: 'card', abilities: [trigger('ENTER_BATTLEFIELD', effect('may', { prompt: 'Draw a card?', effect: effect('draw', { amount: 1 }) }), { controllerEvent: true, sourceEvent: true })] } };
  }),

  template('activated.pay-life-draw', 'Pay a fixed amount of life, optionally with mana, to draw cards.', ({ text }) => {
    const m = text.match(/^(?:(\{(?:\d+|[WUBRGC])\}), )?Pay (one|two|three|four|five|six|seven|eight|nine|ten|\d+) life: Draw (a|one|two|three|four|five|six|\d+) cards?\.$/i);
    if (!m) return null;
    const life = quantityToken(m[2]), amount = quantityToken(m[3]);
    if (life == null || amount == null) return null;
    return { ast: { type: 'card', abilities: [activated({ ...(m[1] ? { mana: m[1] } : {}), life }, effect('draw', { amount }))] } };
  }),

  template('activated.remove-counter-self-draw', 'Remove a named counter from this permanent, optionally with mana, to draw cards.', ({ text }) => {
    const m = text.match(/^(?:(\{(?:\d+|[WUBRGC])\}), )?Remove a ([^:]+) counter from this (?:artifact|creature|permanent): Draw (a|one|two|three|four|five|six|\d+) cards?\.$/i);
    if (!m) return null;
    const amount = quantityToken(m[3]);
    if (amount == null) return null;
    return { ast: { type: 'card', abilities: [activated({ ...(m[1] ? { mana: m[1] } : {}), removeCounterSelf: { counter: m[2].trim(), amount: 1 } }, effect('draw', { amount }))] } };
  }),

  template('activated.sacrifice-another-creature-draw', 'Sacrifice another creature, optionally with mana, to draw cards.', ({ text }) => {
    const m = text.match(/^(?:(\{(?:\d+|[WUBRGC])\}), )?Sacrifice another creature: Draw (a|one|two|three|four|five|six|\d+) cards?\.$/i);
    if (!m) return null;
    const amount = quantityToken(m[2]);
    if (amount == null) return null;
    return { ast: { type: 'card', abilities: [activated({ ...(m[1] ? { mana: m[1] } : {}), sacrificeSelection: true }, effect('draw', { amount }), null, { selection: { count: 1, type: 'Creature', other: true, tap: false } })] } };
  }),

  template('activated.sacrifice-self-draw', 'Sacrifice this permanent, optionally with generic mana, to draw cards.', ({ text }) => {
    const m = text.match(/^(?:\{(\d+)\}, )?Sacrifice this (artifact|creature|permanent): Draw (a|one|two|three|four|five|six|\d+) cards?\.$/i);
    const amount = m && quantityToken(m[3]);
    if (amount == null) return null;
    const cost = { ...(m[1] ? { mana: `{${m[1]}}` } : {}), sacrificeSelf: true };
    return { ast: { type: 'card', abilities: [activated(cost, effect('draw', { amount }))] } };
  }),

  template('activated.tap-sacrifice-self-draw', 'Pay generic mana, tap, and sacrifice this permanent to draw cards.', ({ text }) => {
    const m = text.match(/^\{(\d+)\}, \{T\}, Sacrifice this (artifact|creature|permanent): Draw (a|one|two|three|four|five|six|\d+) cards?\.$/i);
    const amount = m && quantityToken(m[3]);
    if (amount == null) return null;
    return { ast: { type: 'card', abilities: [activated({ mana: `{${m[1]}}`, tap: true, sacrificeSelf: true }, effect('draw', { amount }))] } };
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

  template('trigger.etb-destroy-supported-target', 'Destroy a supported target when this permanent enters.', ({ text }) => {
    const prefix = selfEtbPrefix(text);
    if (!prefix) return null;
    const m = text.slice(prefix[0].length).match(/^destroy target (.+)\.$/i);
    if (!m) return null;
    const targets = targetSelector(m[1]);
    // Keep the historical artifact-only template unique to avoid ambiguity.
    if (!targets || String(m[1]).toLowerCase() === 'artifact') return null;
    return { ast: { type: 'card', abilities: [{ ...trigger('ENTER_BATTLEFIELD', effect('destroy'), { controllerEvent: true, sourceEvent: true }), targets }] } };
  }),

  template('trigger.etb-exile-supported-target', 'Exile a supported target when this permanent enters.', ({ text }) => {
    const prefix = selfEtbPrefix(text);
    if (!prefix) return null;
    const m = text.slice(prefix[0].length).match(/^exile target (.+)\.$/i);
    if (!m) return null;
    const targets = targetSelector(m[1]);
    return targets ? { ast: { type: 'card', abilities: [{ ...trigger('ENTER_BATTLEFIELD', effect('exile'), { controllerEvent: true, sourceEvent: true }), targets }] } } : null;
  }),

  template('trigger.etb-bounce-supported-target', 'Return a supported target permanent to its owner hand when this permanent enters.', ({ text }) => {
    const prefix = selfEtbPrefix(text);
    if (!prefix) return null;
    const m = text.slice(prefix[0].length).match(/^return target (.+) to its owner's hand\.$/i);
    if (!m) return null;
    const targets = targetSelector(m[1]);
    return targets ? { ast: { type: 'card', abilities: [{ ...trigger('ENTER_BATTLEFIELD', effect('moveZone', { toZone: 'hand' }), { controllerEvent: true, sourceEvent: true }), targets }] } } : null;
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

  template('spell.reanimate-target-creature-any-graveyard', 'Return target creature card from a graveyard to the battlefield under your control.', ({ text }) => {
    if (!/^Return target creature card from a graveyard to the battlefield under your control\.$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [spell(effect('moveZone', { toZone: 'battlefield', toPlayer: 'controller' }), { kind: 'card', zone: 'graveyard', type: 'Creature' })] } };
  }),

  template('trigger.dies-return-self-to-hand', 'When this creature dies, return it to its owner hand.', ({ text }) => {
    if (!/^When this creature dies, return it to its owner's hand\.$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [trigger('CREATURE_DIED', effect('moveEventObject', { toZone: 'hand', toPlayer: 'owner' }), { controllerEvent: true, sourceEvent: true }, { sourceZones: ['graveyard'] })] } };
  }),

  template('trigger.dies-return-self-battlefield', 'When this creature dies, return it to the battlefield under its owner control.', ({ text }) => {
    if (!/^When this creature dies, return it to the battlefield under its owner's control\.$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [trigger('CREATURE_DIED', effect('moveEventObject', { toZone: 'battlefield', toPlayer: 'owner' }), { controllerEvent: true, sourceEvent: true }, { sourceZones: ['graveyard'] })] } };
  }),

  template('spell.flicker-target-creature-you-control', 'Exile target creature you control, then return it to the battlefield under its owner control.', ({ text }) => {
    if (!/^Exile target creature you control, then return it to the battlefield under its owner's control\.$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [spell(effect('blink', { returnTo: 'owner' }), { kind: 'permanent', type: 'Creature', controller: 'you' })] } };
  }),

  template('trigger.etb-exile-until-leaves', 'ETB linked temporary exile until this permanent leaves the battlefield.', ({ text }) => {
    const m = text.match(/^When this (?:creature|artifact|enchantment|permanent) enters(?: the battlefield)?, exile target (creature|nonland permanent) an opponent controls until this permanent leaves the battlefield\.$/i);
    if (!m) return null;
    const selector = targetSelector(`${m[1]} an opponent controls`);
    if (!selector) return null;
    return { ast: { type: 'card', abilities: [trigger('ENTER_BATTLEFIELD', effect('exileUntilSourceLeaves'), { controllerEvent: true, sourceEvent: true }, { targets: selector })] } };
  }),


  template('combat.cant-attack-this-turn', 'A targeted creature cannot attack this turn.', ({ text, card }) => {
    if (!/\b(Instant|Sorcery)\b/i.test(card?.typeLine || '')) return null;
    return /^Target creature can't attack this turn\.$/i.test(text) ? { ast: { type: 'card', abilities: [spell(effect('combatRestriction', { cantAttack: true, duration: 'until-end-of-turn' }), targetSelector('creature'))] } } : null;
  }),
  template('combat.must-attack-this-turn', 'A targeted creature must attack this turn if able.', ({ text, card }) => {
    if (!/\b(Instant|Sorcery)\b/i.test(card?.typeLine || '')) return null;
    return /^Target creature attacks this turn if able\.$/i.test(text) ? { ast: { type: 'card', abilities: [spell(effect('combatRestriction', { mustAttack: true, duration: 'until-end-of-turn' }), targetSelector('creature'))] } } : null;
  }),
  template('copy.target-spell', 'Copy a targeted spell and optionally choose new targets.', ({ text, card }) => {
    if (!/\b(Instant|Sorcery)\b/i.test(card?.typeLine || '')) return null;
    if (!/^Copy target (instant or sorcery spell|spell)(?:\. You may choose new targets for the copy\.)?$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [spell(effect('copy', { what: 'spell', zone: 'stack', copies: 1, chooseNewTargets: /choose new targets/i.test(text) }), { kind: 'spell', zone: 'stack' })] } };
  }),
  template('copy.token-target-creature', 'Create a token copy of target creature.', ({ text, card }) => {
    if (!/\b(Instant|Sorcery)\b/i.test(card?.typeLine || '')) return null;
    return /^Create a token that's a copy of target creature\.$/i.test(text) ? { ast: { type: 'card', abilities: [spell(effect('copy', { what: 'token', amount: 1 }), targetSelector('creature'))] } } : null;
  }),
  template('control.gain-target-permanent', 'Gain control of a targeted creature or permanent.', ({ text, card }) => {
    if (!/\b(Instant|Sorcery)\b/i.test(card?.typeLine || '')) return null;
    const m = text.match(/^Gain control of target (creature|permanent)\.$/i); if (!m) return null;
    return { ast: { type: 'card', abilities: [spell(effect('controlChange'), targetSelector(m[1]))] } };
  }),
  template('control.gain-creature-until-eot', 'Temporarily gain control of a creature, optionally untapping it.', ({ text, card }) => {
    if (!/\b(Instant|Sorcery)\b/i.test(card?.typeLine || '')) return null;
    if (!/^Gain control of target creature until end of turn\.(?: Untap that creature\.)?$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [spell(effect('controlChange', { duration: 'until-end-of-turn', untap: /Untap that creature/i.test(text) }), targetSelector('creature'))] } };
  }),

  // Phase 25 — characteristic-defining power/toughness abilities. These are
  // represented as CDAs so they occupy layer 7a rather than ordinary P/T set.
  template('cda.pt-hand-size', 'Power and toughness equal the number of cards in your hand.', ({ text }) => {
    if (!/^This creature's power and toughness are each equal to the number of cards in your hand\.$/i.test(text) && !/^\*\/\*$/.test(text)) return null;
    return { ast: { type: 'card', abilities: [{ type: 'characteristic', characteristic: { setPowerFrom: 'controller-hand-size', setToughnessFrom: 'controller-hand-size' } }] } };
  }),
  template('cda.pt-creatures-you-control', 'Power and toughness equal creatures you control.', ({ text }) => {
    if (!/^This creature's power and toughness are each equal to the number of creatures you control\.$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [{ type: 'characteristic', characteristic: { setPowerFrom: 'creatures-you-control', setToughnessFrom: 'creatures-you-control' } }] } };
  }),
  template('cda.pt-graveyard-cards', 'Power and toughness equal cards in your graveyard.', ({ text }) => {
    if (!/^This creature's power and toughness are each equal to the number of cards in your graveyard\.$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [{ type: 'characteristic', characteristic: { setPowerFrom: 'cards-in-your-graveyard', setToughnessFrom: 'cards-in-your-graveyard' } }] } };
  }),

  // Phase 26 — transform and modal-double-faced support uses the canonical
  // CardFace model. Transform effects never synthesize a second permanent.
  template('transform.self', 'Transform this permanent.', ({ text }) => {
    if (!/^Transform this (creature|permanent)\.$/i.test(text) && !/^Transform this permanent\.$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [{ type: 'activated', cost: {}, effect: effect('transformSelf') }] } };
  }),
  template('trigger.transform-self', 'Triggered self-transform.', ({ text }) => {
    const m = text.match(/^At the beginning of your upkeep, transform this (creature|permanent)\.$/i);
    return m ? { ast: { type: 'card', abilities: [trigger('BEGIN_UPKEEP', effect('transformSelf'), { controllerEvent: true })] } } : null;
  }),

  // Phase 27 — morph/disguise compile into a common face-down cast contract.
  // Turning face up is a special action and therefore does not use the stack.
  template('mechanic.morph', 'Morph face-down cast and turn-face-up cost.', ({ text }) => {
    const m = text.match(/^Morph (\{[^\n]+\})(?: \(.*\))?$/i); if (!m) return null;
    return { ast: { type: 'card', abilities: [], cardPatch: { morphCost: m[1], faceDownCasting: { castOption: 'morph', manaCost: '{3}', faceUpCost: m[1], ward: null } } } };
  }),
  template('mechanic.disguise', 'Disguise face-down cast and turn-face-up cost.', ({ text }) => {
    const m = text.match(/^Disguise (\{[^\n]+\})(?: \(.*\))?$/i); if (!m) return null;
    return { ast: { type: 'card', abilities: [], cardPatch: { disguiseCost: m[1], faceDownCasting: { castOption: 'disguise', manaCost: '{3}', faceUpCost: m[1], ward: 2 } } } };
  }),

  // Phase 82 — Ascend. Runtime grants the city's blessing permanently once
  // its ten-permanent condition is met.
  template('mechanic.living-weapon', 'Living weapon creates a Germ and attaches this Equipment to it.', ({ text }) => {
    if (!/^Living weapon(?: \(When this Equipment enters, create a 0\/0 black Phyrexian Germ creature token, then attach this to it\.\))?$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [trigger('ENTER_BATTLEFIELD', effect('livingWeapon'), { controllerEvent: true, sourceEvent: true })] } };
  }),

  template('mechanic.for-mirrodin', 'For Mirrodin creates a Rebel and attaches this Equipment.', ({ text }) => {
    if (!/^For Mirrodin!(?: \(When this Equipment enters, create a 2\/2 red Rebel creature token, then attach this to it\.\))?$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [trigger('ENTER_BATTLEFIELD', effect('equipmentTokenAttach', { token: { name:'Rebel', typeLine:'Token Creature — Rebel', subtypes:['Rebel'], colors:['R'], power:2, toughness:2, abilities:[] }, reason:'for-mirrodin' }), { controllerEvent:true, sourceEvent:true })] } };
  }),

  template('mechanic.job-select', 'Job select creates a Hero and attaches this Equipment.', ({ text }) => {
    if (!/^Job select(?: \(When this Equipment enters, create a 1\/1 colorless Hero creature token, then attach this to it\.\))?$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [trigger('ENTER_BATTLEFIELD', effect('equipmentTokenAttach', { token: { name:'Hero', typeLine:'Token Creature — Hero', subtypes:['Hero'], colors:[], power:1, toughness:1, abilities:[] }, reason:'job-select' }), { controllerEvent:true, sourceEvent:true })] } };
  }),

  template('mechanic.ascend', "Ascend and the city's blessing.", ({ text }) => {
    if (!/^Ascend(?: \(If you control ten or more permanents, you get the city\'s blessing for the rest of the game\.\))?$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [], cardPatch: { keywords: ['ascend'], ascend: true } } };
  }),

  // Phase 83 — Rebound. A spell cast from hand with rebound is exiled as it
  // resolves and receives a one-shot free cast permission at its controller's
  // next upkeep. The runtime records the original cast zone on stack objects.
  template('mechanic.rebound', 'Rebound delayed free cast from exile.', ({ text }) => {
    if (!/^Rebound(?: \(If you cast this spell from your hand, exile it as it resolves\. At the beginning of your next upkeep, you may cast this card from exile without paying its mana cost\.\))?$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [], cardPatch: { keywords: ['rebound'], rebound: true } } };
  }),

  // Phase 84 — generalized as-enters creature-type choice. The permanent
  // resolution pipeline already pauses for an authoritative creature-type choice.
  template('choice.as-enters-creature-type', 'Choose a creature type as this permanent enters.', ({ text }) => {
    if (!/^As this (?:artifact|enchantment|creature|permanent) enters, choose a creature type\.$/i.test(text)) return null;
    return { ast:{ type:'card', abilities:[], cardPatch:{ asEntersChooseType:true } } };
  }),

  // Phase 83 — day/night and original Innistrad werewolf transform clauses.
  template('mechanic.daybound', 'Daybound day/night transform rule.', ({ text }) => {
    if (!/^Daybound(?: \(If a player casts no spells during their own turn, it becomes night next turn\.\))?$/i.test(text)) return null;
    return { ast:{ type:'card', abilities:[], cardPatch:{ keywords:['daybound'], daybound:true } } };
  }),
  template('mechanic.nightbound', 'Nightbound day/night transform rule.', ({ text }) => {
    if (!/^Nightbound(?: \(If a player casts at least two spells during their own turn, it becomes day next turn\.\))?$/i.test(text)) return null;
    return { ast:{ type:'card', abilities:[], cardPatch:{ keywords:['nightbound'], nightbound:true } } };
  }),
  template('trigger.werewolf-no-spells', 'Transform at upkeep if no spells were cast last turn.', ({ text }) => {
    if (!/^At the beginning of each upkeep, if no spells were cast last turn, transform this creature\.$/i.test(text)) return null;
    return { ast:{ type:'card', abilities:[], cardPatch:{ transformIfNoSpellsLastTurn:true } } };
  }),
  template('trigger.werewolf-two-spells', 'Transform at upkeep if two or more spells were cast last turn.', ({ text }) => {
    if (!/^At the beginning of each upkeep, if a player cast two or more spells last turn, transform this creature\.$/i.test(text)) return null;
    return { ast:{ type:'card', abilities:[], cardPatch:{ transformIfTwoSpellsLastTurn:true } } };
  }),

  // Phases 111–120 — high-impact long-tail Oracle families. Each family
  // lowers to an explicit semantic contract consumed by authoritative runtime
  // subsystems; reminder text is never treated as a no-op implementation.
  template('mechanic.fuse', 'Fuse split-card casting permission.', ({ text }) => {
    if (!/^Fuse(?: \(You may cast one or both halves of this card from your hand\.\))?$/i.test(text)) return null;
    return { ast:{type:'card',abilities:[],cardPatch:{keywords:['fuse'],fuse:true}} };
  }),
  template('mechanic.spree', 'Spree selectable additional-cost modes.', ({ text }) => {
    if (!/^Spree(?: \(Choose one or more additional costs\.\))?$/i.test(text)) return null;
    return { ast:{type:'card',abilities:[],cardPatch:{keywords:['spree'],spree:true}} };
  }),
  template('mechanic.bargain', 'Bargain optional sacrifice additional cost.', ({ text }) => {
    if (!/^Bargain(?: \(You may sacrifice an artifact, enchantment, or token as you cast this spell\.\))?$/i.test(text)) return null;
    return { ast:{type:'card',abilities:[],cardPatch:{keywords:['bargain'],bargain:{optional:true,sacrifice:{anyOfTypes:['Artifact','Enchantment'],orToken:true,count:1}}}} };
  }),
  template('mechanic.backup', 'Backup N ETB counter and temporary ability grant.', ({ text }) => {
    const m=text.match(/^Backup (\d+)(?: \(When this creature enters, put (?:a|\d+) \+1\/\+1 counters? on target creature\. If that['’]s another creature, it gains the following ability until end of turn\.\))?$/i);
    if(!m) return null; const n=Number(m[1]);
    return { ast:{type:'card',abilities:[trigger('ENTER_BATTLEFIELD',effect('backup',{amount:n}),{controllerEvent:true,sourceEvent:true})],cardPatch:{keywords:[`backup ${n}`],backup:n}} };
  }),
  template('mechanic.umbra-armor', 'Umbra armor destruction replacement.', ({ text }) => {
    if (!/^Umbra armor(?: \(If enchanted creature would be destroyed, instead remove all damage from it and destroy this Aura\.\))?$/i.test(text)) return null;
    return { ast:{type:'card',abilities:[],cardPatch:{keywords:['umbra armor'],umbraArmor:true}} };
  }),
  template('mechanic.cipher', 'Cipher encode and combat-damage copy permission.', ({ text }) => {
    if (!/^Cipher(?: \(Then you may exile this spell card encoded on a creature you control\. Whenever that creature deals combat damage to a player, its controller may cast a copy of the encoded card without paying its mana cost\.\))?$/i.test(text)) return null;
    return { ast:{type:'card',abilities:[],cardPatch:{keywords:['cipher'],cipher:true}} };
  }),
  template('choice.modal-repeat-three', 'Choose three with repeated modes allowed.', ({ text }) => {
    if (!/^Choose three\. You may choose the same mode more than once\.$/i.test(text)) return null;
    return { ast:{type:'card',abilities:[],cardPatch:{modalChoice:{count:3,allowRepeatedModes:true}}} };
  }),
  template('choice.commander-both', 'Commander-dependent modal expansion.', ({ text }) => {
    if (!/^Choose one\. If you control a commander as you cast this spell, you may choose both instead\.$/i.test(text)) return null;
    return { ast:{type:'card',abilities:[],cardPatch:{modalChoice:{count:1,ifControlCommanderCount:2}}} };
  }),
  template('saga.transform-chapter', 'Final Saga chapter exile/return transformed.', ({ text }) => {
    if (!/^(?:I|II|III|IV|V|VI|VII|VIII|IX|X) — Exile this Saga, then return it to the battlefield transformed under your control\.$/i.test(text)) return null;
    return { ast:{type:'card',abilities:[{type:'triggered',event:'SAGA_CHAPTER',effect:effect('exileReturnTransformedSelf')}] } };
  }),
  template('untap.optional-self', 'May remain tapped during controller untap.', ({ text }) => {
    if (!/^You may choose not to untap this (?:artifact|creature|permanent) during your untap step\.$/i.test(text)) return null;
    return { ast:{type:'card',abilities:[],cardPatch:{optionalUntap:true}} };
  }),

  // Phases 121–130 — next high-frequency Oracle families from the Phase 120 audit.
  template('trigger.etb-enchantment-exile-until-leaves', 'Enchantment ETB linked temporary exile.', ({ text }) => {
    if (!/^When this enchantment enters, exile target nonland permanent an opponent controls until this enchantment leaves the battlefield\.$/i.test(text)) return null;
    return { ast:{type:'card',abilities:[trigger('ENTER_BATTLEFIELD',effect('exileUntilSourceLeaves'),{controllerEvent:true,sourceEvent:true},{targets:{kind:'permanent',nonland:true,controller:'opponent'}})]} };
  }),
  template('activated.prevent-next-one', 'Tap to prevent the next 1 damage to any target.', ({ text }) => {
    if (!/^\{T\}: Prevent the next 1 damage that would be dealt to any target this turn\.$/i.test(text)) return null;
    return { ast:{type:'card',abilities:[activated({tap:true},effect('preventDamage',{amount:1}),{kind:'playerOrPermanent'})]} };
  }),
  template('casting.declare-attackers-retaliation', 'Cast only during declare attackers after being attacked.', ({ text }) => {
    if (!/^Cast this spell only during the declare attackers step and only if you've been attacked this step\.$/i.test(text)) return null;
    return { ast:{type:'card',abilities:[],cardPatch:{castRestriction:{phase:'DECLARE_ATTACKERS',controllerWasAttackedThisStep:true}}} };
  }),
  template('activated.spore-saproling', 'Remove three spore counters to create a Saproling.', ({ text }) => {
    if (!/^Remove three spore counters from this creature: Create a 1\/1 green Saproling creature token\.$/i.test(text)) return null;
    return { ast:{type:'card',abilities:[activated({removeCountersFromSelf:{type:'spore',amount:3}},effect('createToken',{amount:1,token:{name:'Saproling Token',typeLine:'Token Creature — Saproling',subtypes:['Saproling'],colors:['G'],power:1,toughness:1,keywords:[],abilities:[]}}))]} };
  }),
  template('choice.as-enters-color', 'Choose a color as this creature enters.', ({ text }) => {
    if (!/^As this creature enters, choose a color\.$/i.test(text)) return null;
    return { ast:{type:'card',abilities:[],cardPatch:{asEntersChooseColor:true}} };
  }),
  template('trigger.kicked-enters-two-counters', 'Kicked creature enters with two +1/+1 counters.', ({ text }) => {
    if (!/^If this creature was kicked, it enters with two \+1\/\+1 counters on it\.$/i.test(text)) return null;
    return { ast:{type:'card',abilities:[],cardPatch:{entersIfKickedCounters:{type:'+1/+1',amount:2}}} };
  }),
  template('mechanic.learn', 'Learn choice between outside-game Lesson and discard/draw.', ({ text }) => {
    if (!/^Learn\.(?: \(You may reveal a Lesson card you own from outside the game and put it into your hand, or discard a card to draw a card\.\))?$/i.test(text)) return null;
    return { ast:{type:'card',abilities:[{type:'spell',effect:effect('learn')}],cardPatch:{learn:true}} };
  }),
  template('mechanic.start-your-engines', 'Start your engines and speed progression contract.', ({ text }) => {
    if (!/^Start your engines!(?: \(If you have no speed, it starts at 1\. It increases once on each of your turns when an opponent loses life\. Max speed is 4\.\))?$/i.test(text)) return null;
    return { ast:{type:'card',abilities:[],cardPatch:{startYourEngines:true,speedMechanic:{initial:1,max:4,increaseOnOpponentLifeLossOnceEachOwnTurn:true}}} };
  }),
  template('mechanic.level-sorcery', 'Gain the next level as a sorcery.', ({ text }) => {
    if (!/^\(Gain the next level as a sorcery to add its ability\.\)$/i.test(text)) return null;
    return { ast:{type:'card',abilities:[],cardPatch:{levelProgression:{sorcerySpeed:true,gainNextLevel:true}}} };
  }),
  template('battle.siege-rules', 'Siege protector, combat, defeat, and transformed-cast contract.', ({ text }) => {
    if (!/^\(As a Siege enters, choose an opponent to protect it\. You and others can attack it\. When it's defeated, exile it, then cast it transformed\.\)$/i.test(text)) return null;
    return { ast:{type:'card',abilities:[],cardPatch:{battleType:'Siege',siege:{chooseOpponentProtector:true,attackableByOthers:true,onDefeat:'exile-cast-transformed'}}} };
  }),

  // Phase 28 — Suspend. The card patch exposes a special action from hand;
  // upkeep time-counter processing and the mandatory zero-counter cast use the
  // engine's existing authoritative suspend path.
  template('mechanic.suspend', 'Suspend N—cost special action.', ({ text }) => {
    const m = text.match(/^Suspend (\d+)—(\{[^\n]+\})(?: \(.*\))?$/i);
    if (!m) return null;
    return { ast: { type: 'card', abilities: [], cardPatch: { suspend: { timeCounters: Number(m[1]), cost: m[2] } } } };
  }),

  // Phase 29 — Cascade and Discover lower into LibraryOperationService so
  // reveal/exile iteration, mana-value filtering and cast permission stay in
  // the authoritative rules layer.
  template('mechanic.cascade', 'Cascade cast trigger.', ({ text }) => {
    if (!/^Cascade(?: \(.*\))?$/i.test(text)) return null;
    return { ast: { type: 'card', abilities: [trigger('SPELL_CAST', effect('cascade'), { controllerEvent: true, sourceEvent: true })] } };
  }),
  template('action.discover', 'Discover a fixed value.', ({ text }) => {
    const m = text.match(/^Discover (\d+)\.$/i);
    return m ? { ast: { type: 'card', abilities: [spell(effect('discover', { amount: Number(m[1]) }))] } } : null;
  }),

  template('trigger.cast-type-plus-counter', 'Put a +1/+1 counter on this creature after casting a simple permanent-type spell.', ({ text }) => {
    const m = text.match(/^Whenever you cast a (creature|artifact|enchantment) spell, put (a|one|two|three|\d+) \+1\/\+1 counters? on this creature\.$/i);
    const amount = m && quantityToken(m[2]);
    if (amount == null) return null;
    const cardType = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
    return { ast: { type: 'card', abilities: [trigger('SPELL_CAST', effect('addCounter', { source: true, counter: '+1/+1', amount }), { controllerEvent: true, cardType })] } };
  })
];



// Phase 68 — catalog-scale grammar bridge. These templates deliberately cover
// only constructs already enforced by authoritative engine subsystems. They do
// not mark arbitrary Oracle text executable; every accepted family maps to an
// existing rules primitive/mechanic.
const PHASE68_TEMPLATES = [
  template('spell.uncounterable-self', 'This spell cannot be countered.', ({ text }) =>
    /^This spell can't be countered\.?$/i.test(text) ? { ast:{type:'card',abilities:[],cardPatch:{cantBeCountered:true}} } : null),
  template('cost.additional-sacrifice-creature', 'Sacrifice a creature as an additional casting cost.', ({ text }) =>
    /^As an additional cost to cast this spell, sacrifice a creature\.?$/i.test(text) ? { ast:{type:'card',abilities:[],cardPatch:{additionalCosts:[{sacrifice:{type:'Creature',count:1}}]}} } : null),
  template('mechanic.affinity-artifacts', 'Affinity for artifacts, enforced by CostEngine/MechanicLibrary.', ({ text }) =>
    /^Affinity for artifacts(?:\s*\([^)]*\))?$/i.test(text) ? { ast:{type:'card',abilities:[],cardPatch:{keywords:['affinity for artifacts']}} } : null),
  template('mechanic.delve', 'Delve, enforced by authoritative cost contribution/payment.', ({ text }) =>
    /^Delve(?:\s*\([^)]*\))?$/i.test(text) ? { ast:{type:'card',abilities:[],cardPatch:{keywords:['delve']}} } : null),
  template('mechanic.improvise', 'Improvise, enforced by authoritative cost contribution/payment.', ({ text }) =>
    /^Improvise(?:\s*\([^)]*\))?$/i.test(text) ? { ast:{type:'card',abilities:[],cardPatch:{keywords:['improvise']}} } : null),
  template('keyword.protection-simple', 'Protection from a color or everything.', ({ text }) => {
    const m=text.match(/^Protection from (white|blue|black|red|green|everything)\.?$/i); return m?{ast:{type:'card',abilities:[],cardPatch:{keywords:[`protection from ${m[1].toLowerCase()}`]}}}:null;
  }),
  template('static.additional-land', 'One additional land play each turn.', ({ text }) =>
    /^You may play an additional land on each of your turns\.?$/i.test(text) ? { ast:{type:'card',abilities:[{type:'static',filter:{controller:'you'},effect:{type:'rule',additionalLandPlays:1}}]} } : null),
  template('activated.loot-one', 'Tap: draw then discard.', ({ text }) =>
    /^\{T\}: Draw a card, then discard a card\.?$/i.test(text) ? { ast:{type:'card',abilities:[activated({tap:true},effect('sequence',{effects:[effect('draw',{amount:1}),effect('discard',{amount:1})]}))]} } : null),
  template('mana.generic-tap-any-color', 'Generic mana plus tap to add one mana of any color.', ({ text }) => {
    const m=text.match(/^\{(\d+)\}, \{T\}: Add one mana of any color\.?$/i); return m?{ast:{type:'card',abilities:[],cardPatch:{abilities:[{type:'mana',tap:true,cost:{mana:`{${m[1]}}`},anyColor:true,colors:['W','U','B','R','G'],amount:1}]}}}:null;
  }),
  template('static.cant-untap-self', 'This permanent does not untap during your untap step.', ({ text }) =>
    /^This (?:creature|artifact|permanent) doesn't untap during your untap step\.?$/i.test(text) ? { ast:{type:'card',abilities:[],cardPatch:{doesNotUntap:true}} } : null),
  template('static.aura-cant-attack-block', 'Enchanted creature cannot attack or block.', ({ text }) =>
    /^Enchanted creature can't attack or block\.?$/i.test(text) ? { ast:{type:'card',abilities:[],cardPatch:{grantedRestrictions:{cantAttack:true,cantBlock:true}}} } : null),
  template('phase80.aura-cant-attack', 'Enchanted creature cannot attack.', ({ text }) =>
    /^Enchanted creature can't attack\.?$/i.test(text) ? { ast:{type:'card',abilities:[],cardPatch:{grantedRestrictions:{cantAttack:true}}} } : null),
  template('phase80.aura-lockdown', 'Enchanted creature cannot attack, block, or activate nonmana abilities.', ({ text }) =>
    /^Enchanted creature can't attack or block, and its activated abilities can't be activated\.?$/i.test(text) ? { ast:{type:'card',abilities:[],cardPatch:{grantedRestrictions:{cantAttack:true,cantBlock:true,cantActivateAbilities:true}}} } : null),
  template('pregame.opening-battlefield', 'Opening-hand battlefield pregame action; PregameActionService enforces the choice.', ({ text }) =>
    /^If this card is in your opening hand, you may begin the game with it on the battlefield\.?$/i.test(text) ? { ast:{type:'card',abilities:[],cardPatch:{pregameOpeningBattlefield:true}} } : null),
];


// Phases 91–100 — long-tail keyword semantic expansion.  Each family is
// represented explicitly in card metadata/IR so runtime subsystems can enforce
// the mechanic without treating reminder text as an opaque success.
const PHASE91_100_TEMPLATES = [
  template('phase91.exploit','Exploit ETB sacrifice choice.',({text})=>/^Exploit(?: \(When this creature enters, you may sacrifice a creature\.\))?$/i.test(text)?{ast:{type:'card',abilities:[trigger('ENTER_BATTLEFIELD',effect('exploit'),null,{source:'self'})],cardPatch:{exploit:true}}}:null),
  template('phase92.cumulative-upkeep','Cumulative upkeep with a fixed mana cost.',({text})=>{const m=text.match(/^Cumulative upkeep (\{[^\n]+\})(?: \(At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless you pay its upkeep cost for each age counter on it\.\))?$/i);return m?{ast:{type:'card',abilities:[trigger('UPKEEP',effect('cumulativeUpkeep',{mana:m[1]}),{controllerEvent:true,sourceSelf:true})],cardPatch:{cumulativeUpkeep:{mana:m[1]}}}}:null;}),
  template('phase93.extort','Extort cast trigger.',({text})=>/^Extort(?: \(Whenever you cast a spell, you may pay \{W\/B\}\. If you do, each opponent loses 1 life and you gain that much life\.\))?$/i.test(text)?{ast:{type:'card',abilities:[trigger('SPELL_CAST',effect('extort',{mana:'{W/B}'}),{controllerEvent:true})],cardPatch:{extort:true}}}:null),
  template('phase94.unleash','Unleash entry choice and block restriction.',({text})=>/^Unleash(?: \(You may have this creature enter with a \+1\/\+1 counter on it\. It can't block as long as it has a \+1\/\+1 counter on it\.\))?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{unleash:true}}}:null),
  template('phase95.riot','Riot entry choice.',({text})=>/^Riot(?: \(This creature enters with your choice of a \+1\/\+1 counter or haste\.\))?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{riot:true}}}:null),
  template('phase96.melee','Melee attack trigger.',({text})=>/^Melee(?: \(Whenever this creature attacks, it gets \+1\/\+1 until end of turn for each opponent you attacked this combat\.\))?$/i.test(text)?{ast:{type:'card',abilities:[trigger('ATTACK',effect('melee'),{sourceSelf:true})],cardPatch:{melee:true}}}:null),
  template('phase97.bloodthirst','Bloodthirst fixed entry counters.',({text})=>{const m=text.match(/^Bloodthirst (\d+)(?: \(If an opponent was dealt damage this turn, this creature enters with (?:a|\d+) \+1\/\+1 counters? on it\.\))?$/i);return m?{ast:{type:'card',abilities:[],cardPatch:{bloodthirst:Number(m[1])}}}:null;}),
  template('phase98.ravenous','Ravenous X entry counters and threshold draw.',({text})=>/^Ravenous(?: \(This creature enters with X \+1\/\+1 counters on it\. If X is 5 or more, draw a card when it enters\.\))?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{ravenous:true}}}:null),
  template('phase99.jump-start','Jump-start graveyard casting permission.',({text})=>/^Jump-start(?: \(You may cast this card from your graveyard by discarding a card in addition to paying its other costs\. Then exile this card\.\))?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{castingOptions:[{id:'jump-start',fromZone:'graveyard',castOption:'jump-start',additionalCosts:[{type:'discard',count:1}],exileOnLeaveStack:true}]}}}:null),
  template('phase100.soulbond','Soulbond pairing lifecycle.',({text})=>/^Soulbond(?: \(You may pair this creature with another unpaired creature when either enters\. They remain paired for as long as you control both of them\.\))?$/i.test(text)?{ast:{type:'card',abilities:[trigger('ENTER_BATTLEFIELD',effect('soulbond'),null,{source:'self'}),trigger('ENTER_BATTLEFIELD',effect('soulbond'),{controllerEvent:true,cardType:'Creature',other:true})],cardPatch:{soulbond:true}}}:null)
];



// Phases 131–140 — next high-frequency digitally representable Oracle families.
const PHASE131_140_TEMPLATES = [
  template('phase131.ward-discard','Ward paid by discarding a card.',({text})=>/^Ward—Discard a card\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{wardCost:{kind:'discard',amount:1}}}}:null),
  template('phase132.power-evasion','Creatures with lower power cannot block this creature.',({text})=>/^Creatures with power less than this creature's power can't block it\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{blockRestriction:{kind:'blockerPowerAtLeastSourcePower'}}}}:null),
  template('phase133.enlist','Enlist attack participation contract.',({text})=>/^Enlist(?: \(As this creature attacks, you may tap a nonattacking creature you control without summoning sickness\. When you do, add its power to this creature's until end of turn\.\))?$/i.test(text)?{ast:{type:'card',abilities:[trigger('ATTACK',effect('enlist'),{sourceSelf:true})],cardPatch:{enlist:true}}}:null),
  template('phase134.verse-upkeep','Optional verse counter on upkeep.',({text})=>/^At the beginning of your upkeep, you may put a verse counter on this enchantment\.?$/i.test(text)?{ast:{type:'card',abilities:[trigger('UPKEEP',effect('optionalEffect',{effect:effect('addCounter',{counterType:'verse',amount:1,target:'self'})}),{controllerEvent:true,sourceSelf:true})],cardPatch:{verseCounterUpkeep:true}}}:null),
  template('phase135.gift-card','Gift a card casting choice.',({text})=>/^Gift a card(?: \(You may promise an opponent a gift as you cast this spell\. If you do, they draw a card before its other effects\.\))?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{gift:{kind:'card',optional:true,recipient:'opponent',effect:{type:'draw',amount:1}}}}}:null),
  template('phase136.additional-discard-x','Discard X cards as an additional casting cost.',({text})=>/^As an additional cost to cast this spell, discard X cards\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{additionalCosts:[{kind:'discard',amount:'X'}]}}}:null),
  template('phase137.move-plus-counter','Move a +1/+1 counter from this creature to target creature.',({text})=>/^\{2\}, Remove a \+1\/\+1 counter from this creature: Put a \+1\/\+1 counter on target creature\.?$/i.test(text)?{ast:{type:'card',abilities:[activated({mana:'{2}',removeCounters:{type:'+1/+1',amount:1,from:'self'}},effect('addCounter',{counterType:'+1/+1',amount:1,target:'target'}))]}}:null),
  template('phase138.offspring','Offspring fixed additional cost and token-copy ETB.',({text})=>{const m=text.match(/^Offspring ((?:\{[^}]+\})+)(?: \(You may pay an additional (?:\{[^}]+\})+ as you cast this spell\. If you do, when this creature enters, create a 1\/1 token copy of it\.\))?$/i);return m?{ast:{type:'card',abilities:[],cardPatch:{offspring:{cost:m[1],power:1,toughness:1}}}}:null;}),
  template('phase139.fabricate','Fabricate fixed counter-or-Servo ETB choice.',({text})=>{const m=text.match(/^Fabricate (\d+)(?: \(When this creature enters, put (?:a|\d+) \+1\/\+1 counters? on it or create (?:a|\d+) 1\/1 colorless Servo artifact creature tokens?\.\))?$/i);return m?{ast:{type:'card',abilities:[trigger('ENTER_BATTLEFIELD',effect('fabricate',{amount:Number(m[1])}),null,{source:'self'})],cardPatch:{fabricate:Number(m[1])}}}:null;}),
  template('phase140.island-dependency','Sacrifice this creature when you control no Islands.',({text})=>/^When you control no Islands, sacrifice this creature\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{stateTrigger:{condition:{controllerHasLandSubtype:'Island',count:0},effect:{type:'sacrifice',target:'self'}}}}}:null)
];


// Phases 141–160 — high-frequency digitally representable Oracle families.
const PHASE141_160_TEMPLATES = [
  template('phase141.additional-exile-creature-grave','Exile a creature card from your graveyard as an additional casting cost.',({text})=>/^As an additional cost to cast this spell, exile a creature card from your graveyard\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{additionalCosts:[{kind:'exileFromGraveyard',amount:1,cardType:'Creature'}]}}}:null),
  template('phase142.conspire','Conspire optional creature-tap copy cost.',({text})=>/^Conspire(?: \(As you cast this spell, you may tap two untapped creatures you control that share a color with it\. When you do, copy it and you may choose a new target for the copy\.\))?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{conspire:true}}}:null),
  template('phase143.firebending','Firebending attack mana trigger.',({text})=>{const m=text.match(/^Firebending (\d+)(?: \(Whenever this creature attacks, add \{R\}\. This mana lasts until end of combat\.\))?$/i);return m?{ast:{type:'card',abilities:[trigger('ATTACK',effect('addMana',{color:'R',amount:Number(m[1]),expires:'END_OF_COMBAT'}),{sourceSelf:true})],cardPatch:{firebending:Number(m[1])}}}:null;}),
  template('phase144.additional-sacrifice-artifact','Sacrifice an artifact as an additional casting cost.',({text})=>/^As an additional cost to cast this spell, sacrifice an artifact\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{additionalCosts:[{sacrifice:{type:'Artifact',count:1}}]}}}:null),
  template('phase145.activated-flying','Pay blue to gain flying until end of turn.',({text})=>/^\{U\}: This creature gains flying until end of turn\.?$/i.test(text)?{ast:{type:'card',abilities:[activated({mana:'{U}'},effect('grantKeyword',{keyword:'flying',target:'self',duration:'END_OF_TURN'}))]}}:null),
  template('phase146.increment','Increment mana-spent cast trigger.',({text})=>/^Increment \(Whenever you cast a spell, if the amount of mana you spent is greater than this creature's power or toughness, put a \+1\/\+1 counter on this creature\.\)$/i.test(text)?{ast:{type:'card',abilities:[trigger('SPELL_CAST',effect('increment'),{controllerEvent:true})],cardPatch:{increment:true}}}:null),
  template('phase147.squad','Squad repeatable additional cost and token copies.',({text})=>{const m=text.match(/^Squad ((?:\{[^}]+\})+)(?: \(As an additional cost to cast this spell, you may pay (?:\{[^}]+\})+ any number of times\. When this creature enters, create that many tokens that are copies of it\.\))?$/i);return m?{ast:{type:'card',abilities:[],cardPatch:{squad:{cost:m[1]}}}}:null;}),
  template('phase148.tap-freeze','Tap target creature and keep it tapped next untap.',({text})=>/^Tap target creature\. It doesn't untap during its controller's next untap step\.?$/i.test(text)?{ast:{type:'card',abilities:[spell(effect('sequence',{effects:[effect('tap',{target:'target'}),effect('skipNextUntap',{target:'target'})]}),{kind:'creature'})]}}:null),
  template('phase149.entwine','Entwine fixed additional cost for all modes.',({text})=>{const m=text.match(/^Entwine ((?:\{[^}]+\})+)(?: \(Choose both if you pay the entwine cost\.\))?$/i);return m?{ast:{type:'card',abilities:[],cardPatch:{entwine:{cost:m[1]}}}}:null;}),
  template('phase150.activated-vigilance','Pay white to gain vigilance until end of turn.',({text})=>/^\{W\}: This creature gains vigilance until end of turn\.?$/i.test(text)?{ast:{type:'card',abilities:[activated({mana:'{W}'},effect('grantKeyword',{keyword:'vigilance',target:'self',duration:'END_OF_TURN'}))]}}:null),
  template('phase151.hand-disruption','Opponent reveals hand; choose nonland card to discard.',({text})=>/^Target opponent reveals their hand\. You choose a nonland card from it\. That player discards that card\.?$/i.test(text)?{ast:{type:'card',abilities:[spell(effect('revealChooseDiscard',{restriction:{nonland:true}}),{kind:'player',relation:'opponent'})]}}:null),
  template('phase152.artifact-count-pump','Power bonus for each artifact you control.',({text})=>/^This creature gets \+1\/\+0 for each artifact you control\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{dynamicPT:{powerPerControlledType:{type:'Artifact',amount:1},toughness:0}}}}:null),
  template('phase153.life-gain-plus-one','Increase each life-gain event by one.',({text})=>/^If you would gain life, you gain that much life plus 1 instead\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{replacementEffects:[{event:'GAIN_LIFE',modify:{add:1}}]}}}:null),
  template('phase154.charge-counters-entry','Artifact enters with three charge counters.',({text})=>/^This artifact enters with three charge counters on it\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{entersWithCounters:{type:'charge',amount:3}}}}:null),
  template('phase155.stun-etb','ETB tap opposing creature and add stun counter.',({text})=>/^When this creature enters, tap target creature an opponent controls and put a stun counter on it\.(?: \(If a permanent with a stun counter would become untapped, remove one from it instead\.\))?$/i.test(text)?{ast:{type:'card',abilities:[trigger('ENTER_BATTLEFIELD',effect('sequence',{effects:[effect('tap',{target:'target'}),effect('addCounter',{counterType:'stun',amount:1,target:'target'})]}),null,{targets:{kind:'creature',controller:'opponent'}})]}}:null),
  template('phase156.mobilize','Mobilize attack token creation.',({text})=>{const m=text.match(/^Mobilize (\d+)(?: \(Whenever this creature attacks, create a tapped and attacking 1\/1 red Warrior creature token\. Sacrifice it at the beginning of the next end step\.\))?$/i);return m?{ast:{type:'card',abilities:[trigger('ATTACK',effect('mobilize',{amount:Number(m[1])}),{sourceSelf:true})],cardPatch:{mobilize:Number(m[1])}}}:null;}),
  template('phase157.tap-creature-mana','Tap this and another untapped creature to add any color.',({text})=>/^\{T\}, Tap an untapped creature you control: Add one mana of any color\.?$/i.test(text)?{ast:{type:'card',abilities:[activated({tap:true,tapOtherCreature:true},effect('addManaChoice',{amount:1,colors:['W','U','B','R','G']}))]}}:null),
  template('phase158.global-minus-two','All creatures get -2/-2 until end of turn.',({text})=>/^All creatures get -2\/-2 until end of turn\.?$/i.test(text)?{ast:{type:'card',abilities:[spell(effect('modifyPT',{selector:{kind:'creature',controller:'any'},power:-2,toughness:-2,duration:'END_OF_TURN'}))]}}:null),
  template('phase159.sunburst','Sunburst creature entry counters from colors of mana spent.',({text})=>/^Sunburst(?: \(This creature enters with a \+1\/\+1 counter on it for each color of mana spent to cast it\.\))?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{sunburst:true}}}:null),
  template('phase160.devour','Devour fixed entry sacrifice multiplier.',({text})=>{const m=text.match(/^Devour (\d+)(?: \(As this creature enters, you may sacrifice any number of creatures\. It enters with that many \+1\/\+1 counters on it\.\))?$/i);return m?{ast:{type:'card',abilities:[],cardPatch:{devour:Number(m[1])}}}:null;})
];



// Phases 161–180 — continued long-tail Oracle coverage.
const PHASE161_180_TEMPLATES = [
  template('phase161.room-reminder','Room split-permanent door rules.',({text})=>/^\(You may cast either half\. That door unlocks on the battlefield\. As a sorcery, you may pay the mana cost of a locked door to unlock it\.\)$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{room:true,doors:true}}}:null),
  template('phase162.prepared','Prepared creature spell-copy state.',({text})=>/^This creature enters prepared\. \(While it's prepared, you may cast a copy of its spell\. Doing so unprepares it\.\)$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{prepared:true,preparedSpellCopy:true}}}:null),
  template('phase163.ongoing-scheme','Ongoing scheme persistence.',({text})=>/^\(An ongoing scheme remains face up until it's abandoned\.\)$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{ongoingScheme:true}}}:null),
  template('phase164.hidden-agenda','Hidden agenda command-zone naming contract.',({text})=>/^Hidden agenda \(Start the game with this conspiracy face down in the command zone and secretly choose a card name\. You may turn this conspiracy face up any time and reveal that name\.\)$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{hiddenAgenda:true,startZone:'command',faceDown:true,secretCardName:true}}}:null),
  template('phase165.faceup-conspiracy','Face-up conspiracy starting-zone rule.',({text})=>/^\(Start the game with this conspiracy face up in the command zone\.\)$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{startZone:'command',conspiracyFaceUp:true}}}:null),
  template('phase166.draft-faceup','Face-up draft instruction.',({text})=>/^Draft this card face up\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{draftInstruction:'faceUp'}}}:null),
  template('phase167.open-attraction','ETB opens an Attraction.',({text})=>/^When this creature enters, open an Attraction\. \(Put the top card of your Attraction deck onto the battlefield\.\)$/i.test(text)?{ast:{type:'card',abilities:[trigger('ENTER_BATTLEFIELD',effect('openAttraction'),null,{source:'self'})],cardPatch:{opensAttraction:true}}}:null),
  template('phase168.double-team','Double team digital conjure mechanic.',({text})=>/^Double team\.?$/i.test(text)?{ast:{type:'card',abilities:[trigger('ATTACK',effect('doubleTeam'),{sourceSelf:true})],cardPatch:{doubleTeam:true}}}:null),
  template('phase169.ki-counter','Spirit or Arcane cast ki-counter trigger.',({text})=>/^Whenever you cast a Spirit or Arcane spell, you may put a ki counter on this creature\.?$/i.test(text)?{ast:{type:'card',abilities:[trigger('SPELL_CAST',effect('optionalEffect',{effect:effect('addCounter',{counterType:'ki',amount:1,target:'self'})}),{controllerEvent:true,spellSubtypeAny:['Spirit','Arcane']})],cardPatch:{kiCounterTrigger:true}}}:null),
  template('phase170.flash-cleanup-sacrifice','Flash permission with delayed cleanup sacrifice.',({text})=>/^You may cast this spell as though it had flash\. If you cast it any time a sorcery couldn't have been cast, the controller of the permanent it becomes sacrifices it at the beginning of the next cleanup step\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{castingTiming:'flash',sacrificeNextCleanupIfCastOutsideSorceryTiming:true}}}:null),
  template('phase171.storied','Storied enduring-story threshold.',({text})=>/^Storied \(If you control three or more artifacts, legendaries, and\/or Sagas, you have an enduring story for the rest of the game\.\)$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{storied:{threshold:3,types:['Artifact','Legendary','Saga'],persistent:true}}}}:null),
  template('phase172.library-top-creature','Put target creature on top of owner library.',({text})=>/^Put target creature on top of its owner's library\.?$/i.test(text)?{ast:{type:'card',abilities:[spell(effect('moveZone',{target:'target',to:'library',position:'top'}),{kind:'creature'})]}}:null),
  template('phase173.phyrexian-reminder','Phyrexian mana payment reminder.',({text})=>/^\(\{B\/P\} can be paid with either \{B\} or 2 life\.\)$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{phyrexianManaReminder:{symbol:'{B/P}',color:'B',life:2}}}}:null),
  template('phase174.day-entry-init','Initialize day/night on entry.',({text})=>/^If it's neither day nor night, it becomes day as this creature enters\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{initializeDayOnEntry:true}}}:null),
  template('phase175.station','Station Spacecraft charge-counter activation.',({text})=>/^Station \(Tap another creature you control: Put charge counters equal to its power on this Spacecraft\. Station only as a sorcery\. It's an artifact creature at 8\+\.\)$/i.test(text)?{ast:{type:'card',abilities:[activated({tapOtherCreature:true,timing:'sorcery'},effect('station'))],cardPatch:{station:{creatureThreshold:8}}}}:null),
  template('phase176.banding','Banding combat grouping and damage assignment.',({text})=>/^Banding \(Any creatures with banding, and up to one without, can attack in a band\. Bands are blocked as a group\. If any creatures with banding you control are blocking or being blocked by a creature, you divide that creature's combat damage, not its controller, among any of the creatures it's being blocked by or is blocking\.\)$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{keywords:['banding'],banding:true}}}:null),
  template('phase177.ante-removal','Pre-game ante deck-removal instruction.',({text})=>/^Remove this card from your deck before playing if you're not playing for ante\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{anteOnly:true,removeIfNoAnte:true}}}:null),
  template('phase178.bounty-setup','Bounty deck setup rule.',({text})=>/^Before the game, shuffle at least 6 unique bounty cards into a face-down pile\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{bountyRules:{setup:true,minUnique:6}}}}:null),
  template('phase179.bounty-reveal','Bounty initial reveal timing.',({text})=>/^As the starting player's third turn begins, reveal the top bounty card\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{bountyRules:{initialRevealTurn:3}}}}:null),
  template('phase180.bounty-advance','Bounty turn progression and restock.',({text})=>/^As each turn begins, if no bounty is being offered, reveal the next one\. If the pile is empty, shuffle all claimed bounties and restock\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{bountyRules:{advanceEachTurn:true,restockClaimed:true}}}}:null)
];


// Phases 181–200 — continued high-frequency Oracle coverage.
const PHASE181_200_TEMPLATES = [
  template('phase181.bounty-claim','Claim revealed bounty during your turn.',({text})=>/^Claim the revealed bounty during your turn and collect your reward!?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{bountyRules:{claimDuringOwnTurn:true,collectReward:true}}}}:null),
  template('phase182.bounty-escalate','Escalate unclaimed bounty reward each turn.',({text})=>/^If the bounty went unclaimed last turn, increase its reward to the next level\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{bountyRules:{escalateIfUnclaimed:true,maxRewardLevel:4}}}}:null),
  template('phase183.bounty-reward-one','Bounty reward level one Treasure.',({text})=>/^1 — Create a Treasure token\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{bountyReward:{level:1,treasure:1}}}}:null),
  template('phase184.bounty-reward-two','Bounty reward level two Treasures.',({text})=>/^2 — Create two Treasure tokens\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{bountyReward:{level:2,treasure:2}}}}:null),
  template('phase185.bounty-reward-three','Bounty reward level three choice.',({text})=>/^3 — Create two Treasure tokens \*or\* draw a card\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{bountyReward:{level:3,chooseOne:[{treasure:2},{draw:1}]}}}}:null),
  template('phase186.bounty-reward-four','Bounty maximum reward.',({text})=>/^4 — \(Max\) Create two Treasure tokens \*and\* draw a card\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{bountyReward:{level:4,treasure:2,draw:1,max:true}}}}:null),
  template('phase187.choose-color-aura','Aura entry color choice.',({text})=>/^As this Aura enters, choose a color\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{asEntersChooseColor:true}}}:null),
  template('phase188.choose-color-enchantment','Enchantment entry color choice.',({text})=>/^As this enchantment enters, choose a color\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{asEntersChooseColor:true}}}:null),
  template('phase189.choose-color-artifact','Artifact entry color choice.',({text})=>/^As this artifact enters, choose a color\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{asEntersChooseColor:true}}}:null),
  template('phase190.choose-color-creature','Creature entry color choice.',({text})=>/^As this creature enters, choose a color\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{asEntersChooseColor:true}}}:null),
  template('phase191.freeze-one','Tap target creature and suppress its next untap.',({text})=>/^Tap target creature\. It doesn't untap during its controller's next untap step\.?$/i.test(text)?{ast:{type:'card',abilities:[spell(effect('sequence',{effects:[effect('tap',{target:'target'}),effect('skipNextUntap',{target:'target'})]}),{kind:'creature'})]}}:null),
  template('phase192.freeze-two','Tap up to two creatures and suppress next untaps.',({text})=>/^Tap up to two target creatures\. Those creatures don't untap during their controller's next untap step\.?$/i.test(text)?{ast:{type:'card',abilities:[spell(effect('sequence',{effects:[effect('tap',{target:'targets'}),effect('skipNextUntap',{target:'targets'})]}),{kind:'creature',min:0,max:2})]}}:null),
  template('phase193.increment','Increment spell-mana threshold trigger.',({text})=>/^Increment \(Whenever you cast a spell, if the amount of mana you spent is greater than this creature's power or toughness, put a \+1\/\+1 counter on this creature\.\)$/i.test(text)?{ast:{type:'card',abilities:[trigger('SPELL_CAST',effect('increment'),{controllerEvent:true})],cardPatch:{increment:true}}}:null),
  template('phase194.level-four-marker','Level four-or-more rules marker.',({text})=>/^LEVEL 4\+$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{levelBand:{min:4}}}}:null),
  template('phase195.gain-two','Gain two life.',({text})=>/^•?\s*You gain 2 life\.?$/i.test(text)?{ast:{type:'card',abilities:[spell(effect('gainLife',{amount:2,target:'controller'}))]}}:null),
  template('phase196.draw-one','Draw a card mode/effect.',({text})=>/^•?\s*Draw a card\.?$/i.test(text)?{ast:{type:'card',abilities:[spell(effect('draw',{amount:1,target:'controller'}))]}}:null),
  template('phase197.rewards-heading','Bounty rewards structural heading.',({text})=>/^Rewards$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{structuralHeading:'bountyRewards'}}}:null),
  template('phase198.objective-heading','Objective structural heading.',({text})=>/^OBJECTIVE:$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{structuralHeading:'objective'}}}:null),
  template('phase199.get-ready-heading','Get Ready structural heading.',({text})=>/^GET READY:$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{structuralHeading:'getReady'}}}:null),
  template('phase200.to-win-heading','To Win structural heading.',({text})=>/^TO WIN:$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{structuralHeading:'toWin'}}}:null)
];


// Phases 221–240 — high-frequency rules families with explicit runtime contracts.
const PHASE221_240_TEMPLATES = [
  template('phase221.saddle','Saddle activation.',({text})=>{const m=text.match(/^Saddle (\d+) \(Tap any number of other creatures you control with total power \1 or more: This Mount becomes saddled until end of turn\. Saddle only as a sorcery\.\)$/i);return m?{ast:{type:'card',abilities:[],cardPatch:{saddle:Number(m[1])}}}:null;}),
  template('phase222.ward-life','Ward paid with life.',({text})=>{const m=text.match(/^Ward—Pay (\d+) life\.?$/i);return m?{ast:{type:'card',abilities:[],cardPatch:{wardCost:{kind:'life',amount:Number(m[1])}}}}:null;}),
  template('phase223.fading','Fading counters and upkeep sacrifice.',({text})=>{const m=text.match(/^Fading (\d+) \(This creature enters with (?:\w+) fade counters? on it\. At the beginning of your upkeep, remove a fade counter from it\. If you can't, sacrifice it\.\)$/i);return m?{ast:{type:'card',abilities:[],cardPatch:{fading:Number(m[1])}}}:null;}),
  template('phase224.rampage','Rampage combat scaling.',({text})=>{const m=text.match(/^Rampage (\d+) \(Whenever this creature becomes blocked, it gets \+\1\/\+\1 until end of turn for each creature blocking it beyond the first\.\)$/i);return m?{ast:{type:'card',abilities:[],cardPatch:{rampage:Number(m[1])}}}:null;}),
  template('phase225.afterlife','Afterlife death tokens.',({text})=>{const m=text.match(/^Afterlife (\d+) \(When this creature dies, create (?:\w+) 1\/1 white and black Spirit creature tokens? with flying\.\)$/i);return m?{ast:{type:'card',abilities:[],cardPatch:{afterlife:Number(m[1])}}}:null;}),
  template('phase226.annihilator','Annihilator attack sacrifice.',({text})=>{const m=text.match(/^Annihilator (\d+) \(Whenever this creature attacks, defending player sacrifices (?:a|\w+) permanents? of their choice\.\)$/i);return m?{ast:{type:'card',abilities:[],cardPatch:{annihilator:Number(m[1])}}}:null;}),
  template('phase227.reconfigure','Reconfigure attachment mode.',({text})=>{const m=text.match(/^Reconfigure (\{[^)]+\}) \([^)]*\)$/i);return m?{ast:{type:'card',abilities:[],cardPatch:{reconfigure:{cost:m[1]}}}}:null;}),
  template('phase228.amass-orcs','Amass Orcs.',({text})=>{const m=text.match(/^Amass Orcs (\d+)\./i);return m?{ast:{type:'card',abilities:[spell(effect('amass',{subtype:'Orc',amount:Number(m[1])}))],cardPatch:{amass:{subtype:'Orc',amount:Number(m[1])}}}}:null;}),
  template('phase229.freerunning','Freerunning alternate cost.',({text})=>{const m=text.match(/^Freerunning (\{[^)]+\}) \(/i);return m?{ast:{type:'card',abilities:[],cardPatch:{freerunning:{cost:m[1]}}}}:null;}),
  template('phase230.collect-evidence','Collect evidence additional cost.',({text})=>{const m=text.match(/^As an additional cost to cast this spell, you may collect evidence (\d+)\./i);return m?{ast:{type:'card',abilities:[],cardPatch:{collectEvidence:{amount:Number(m[1]),optional:true}}}}:null;}),
  template('phase231.tribute','Tribute entry opponent choice.',({text})=>{const m=text.match(/^Tribute (\d+) \(/i);return m?{ast:{type:'card',abilities:[],cardPatch:{tribute:Number(m[1])}}}:null;}),
  template('phase232.assist','Assist cost sharing.',({text})=>{const m=text.match(/^Assist \(Another player can pay up to (\{\d+\}) of this spell's cost\.\)$/i);return m?{ast:{type:'card',abilities:[],cardPatch:{assist:{max:m[1]}}}}:null;}),
  template('phase233.plot','Plot exile-and-later-cast.',({text})=>{const m=text.match(/^Plot (\{[^)]+\}) \(/i);return m?{ast:{type:'card',abilities:[],cardPatch:{plot:{cost:m[1]}}}}:null;}),
  template('phase234.demonstrate','Demonstrate copy exchange.',({text})=>/^Demonstrate \(/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{demonstrate:true}}}:null),
  template('phase235.affinity-creatures','Affinity for creatures.',({text})=>/^Affinity for creatures(?: \([^)]*\))?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{keywords:['affinity for creatures']}}}:null),
  template('phase236.soulshift','Soulshift graveyard recursion.',({text})=>{const m=text.match(/^Soulshift (\d+) \(/i);return m?{ast:{type:'card',abilities:[],cardPatch:{soulshift:Number(m[1])}}}:null;}),
  template('phase237.venture','Venture into the dungeon.',({text})=>/venture into the dungeon/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{venture:true}}}:null),
  template('phase238.proliferate-line','Standalone proliferate.',({text})=>/^Proliferate\.?(?: \([^)]*\))?$/i.test(text)?{ast:{type:'card',abilities:[spell(effect('proliferate'))],cardPatch:{proliferate:true}}}:null),
  template('phase239.rebel-search','Rebel permanent library search.',({text})=>{const m=text.match(/^\{(\d+)\}, \{T\}: Search your library for a Rebel permanent card with mana value (\d+) or less, put it onto the battlefield, then shuffle\.?$/i);return m?{ast:{type:'card',abilities:[],cardPatch:{rebelSearch:{cost:Number(m[1]),maxManaValue:Number(m[2])}}}}:null;}),
  template('phase240.commander-cast-copy','Copy per commander casts.',({text})=>/^When you cast this spell, copy it for each time you've cast your commander from the command zone this game\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{copyPerCommanderCast:true}}}:null)
];


// Phases 241–260 — common long-tail Oracle actions promoted into explicit semantic contracts.
const PHASE241_260_TEMPLATES = [
  template('phase241.forest-plains-search','Search for a Forest or Plains into hand.',({text})=>/^Search your library for a Forest or Plains card, reveal it, put it into your hand, then shuffle\.?$/i.test(text)?{ast:{type:'card',abilities:[spell(effect('searchLibrary',{types:['Forest','Plains'],destination:'hand',reveal:true,amount:1}))]}}:null),
  template('phase242.destroy-creature-enchantment-lose2','Destroy creature or enchantment and lose two life.',({text})=>/^Destroy target creature or enchantment\. You lose 2 life\.?$/i.test(text)?{ast:{type:'card',abilities:[spell(effect('sequence',{effects:[effect('destroy',{target:'target'}),effect('loseLife',{amount:2,target:'controller'})]}),{kind:'permanent',types:['Creature','Enchantment']})]}}:null),
  template('phase243.etb-exile-opponent-grave','ETB exile a card from an opponent graveyard.',({text})=>/^When this creature enters, exile target card from an opponent's graveyard\.?$/i.test(text)?{ast:{type:'card',abilities:[trigger('ENTER_BATTLEFIELD',effect('exile',{target:'target'}),null,{targets:{zone:'graveyard',controller:'opponent'}})]}}:null),
  template('phase244.activated-unblockable','Activated self unblockable until end of turn.',({text})=>{const m=text.match(/^((?:\{[^}]+\})+): This creature can't be blocked this turn\.?$/i);return m?{ast:{type:'card',abilities:[activated({mana:m[1]},effect('grantKeyword',{keyword:'unblockable',target:'self',duration:'END_OF_TURN'}))]}}:null;}),
  template('phase245.unblocked-pump','Attack-unblocked temporary power bonus.',({text})=>{const m=text.match(/^Whenever this creature attacks and isn't blocked, it gets \+(\d+)\/\+(\d+) until end of combat\.?$/i);return m?{ast:{type:'card',abilities:[trigger('ATTACK_UNBLOCKED',effect('modifyPT',{target:'self',power:Number(m[1]),toughness:Number(m[2]),duration:'END_OF_COMBAT'}),{sourceSelf:true})]}}:null;}),
  template('phase246.etb-gain3','ETB gain three life.',({text})=>/^When this creature enters, you gain 3 life\.?$/i.test(text)?{ast:{type:'card',abilities:[trigger('ENTER_BATTLEFIELD',effect('gainLife',{amount:3,target:'controller'}),null,{source:'self'})]}}:null),
  template('phase247.destroy-artifact-mode','Destroy target artifact.',({text})=>/^•?\s*Destroy target artifact\.?$/i.test(text)?{ast:{type:'card',abilities:[spell(effect('destroy',{target:'target'}),{kind:'artifact'})]}}:null),
  template('phase248.destroy-enchantment-mode','Destroy target enchantment.',({text})=>/^•?\s*Destroy target enchantment\.?$/i.test(text)?{ast:{type:'card',abilities:[spell(effect('destroy',{target:'target'}),{kind:'enchantment'})]}}:null),
  template('phase249.return-creature-grave-hand','Return creature card from graveyard to hand.',({text})=>/^•?\s*Return target creature card from your graveyard to your hand\.?$/i.test(text)?{ast:{type:'card',abilities:[spell(effect('moveZone',{from:'graveyard',to:'hand',target:'target'}),{kind:'card',zone:'graveyard',controller:'self',cardType:'Creature'})]}}:null),
  template('phase250.untap-seven-lands','ETB untap up to seven lands.',({text})=>/^When this creature enters, untap up to seven lands\.?$/i.test(text)?{ast:{type:'card',abilities:[trigger('ENTER_BATTLEFIELD',effect('untap',{target:'targets'}),null,{targets:{kind:'land',min:0,max:7}})]}}:null),
  template('phase251.draw3-top2','Activated draw three then put two cards on library.',({text})=>{const m=text.match(/^\{([^}]+)\}, \{T\}, Sacrifice this artifact: Draw three cards, then put two cards from your hand on top of your library in any order\.?$/i);return m?{ast:{type:'card',abilities:[activated({mana:`{${m[1]}}`,tap:true,sacrificeSelf:true},effect('drawThenTop',{draw:3,putBack:2}))]}}:null;}),
  template('phase252.sliver-anthem','Global Sliver +1/+1 anthem.',({text})=>/^All Sliver creatures get \+1\/\+1\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{staticPTModifiers:[{selector:{kind:'creature',subtype:'Sliver'},power:1,toughness:1}]}}}:null),
  template('phase253.top-artifact-enchantment','Put artifact or enchantment on top of owner library.',({text})=>/^Put target artifact or enchantment on top of its owner's library\.?$/i.test(text)?{ast:{type:'card',abilities:[spell(effect('moveZone',{to:'libraryTop',target:'target'}),{kind:'permanent',types:['Artifact','Enchantment']})]}}:null),
  template('phase254.giant-greatest-power-life','ETB gain life equal to greatest Giant power.',({text})=>/^When this creature enters, you gain X life, where X is the greatest power among Giants you control\.?$/i.test(text)?{ast:{type:'card',abilities:[trigger('ENTER_BATTLEFIELD',effect('gainLifeByGreatestPower',{subtype:'Giant'}),null,{source:'self'})]}}:null),
  template('phase255.robot-equipment','Equipment ETB creates Robot and attaches.',({text})=>/^When this Equipment enters, create a 2\/2 colorless Robot artifact creature token and attach this Equipment to it\.?$/i.test(text)?{ast:{type:'card',abilities:[trigger('ENTER_BATTLEFIELD',effect('equipmentTokenAttach',{token:{power:2,toughness:2,colors:[],types:['Artifact','Creature'],subtypes:['Robot']}}),null,{source:'self'})]}}:null),
  template('phase256.enchanted-land-treefolk','Aura makes enchanted land a 5/6 Treefolk land creature.',({text})=>/^Enchanted land is a 5\/6 green Treefolk creature that's still a land\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{enchantedPermanentSet:{types:['Land','Creature'],subtypes:['Treefolk'],colors:['G'],basePower:5,baseToughness:6,preserveTypes:true}}}}:null),
  template('phase257.any-creature-dies-draw','Any creature death optional draw for its controller.',({text})=>/^Whenever a creature dies, that creature's controller may draw a card\.?$/i.test(text)?{ast:{type:'card',abilities:[trigger('DIES',effect('optionalEffect',{effect:effect('draw',{amount:1,target:'eventController'})}),{objectType:'Creature'})]}}:null),
  template('phase258.exile-multicolored','Exile all multicolored permanents.',({text})=>/^Exile all multicolored permanents\.?$/i.test(text)?{ast:{type:'card',abilities:[spell(effect('exileAll',{selector:{kind:'permanent',multicolored:true}}))]}}:null),
  template('phase259.target-indestructible','Target controlled creature gains indestructible.',({text})=>/^Target creature you control gains indestructible until end of turn\.(?: \([^)]*\))?$/i.test(text)?{ast:{type:'card',abilities:[spell(effect('grantKeyword',{keyword:'indestructible',target:'target',duration:'END_OF_TURN'}),{kind:'creature',controller:'self'})]}}:null),
  template('phase260.all-lands-shroud','All lands gain shroud until end of turn.',({text})=>/^All lands gain shroud until end of turn\.(?: \([^)]*\))?$/i.test(text)?{ast:{type:'card',abilities:[spell(effect('grantKeyword',{keyword:'shroud',selector:{kind:'land',controller:'any'},duration:'END_OF_TURN'}))]}}:null)
];


// Phases 261–280 — high-frequency unresolved Oracle families.
const PHASE261_280_TEMPLATES = [
  template('phase261.linked-return-battlefield','Leaves-play linked exile return to battlefield.',({text})=>/^When this creature leaves the battlefield, return the exiled card to the battlefield under its owner's control\.?$/i.test(text)?{ast:{type:'card',abilities:[trigger('LEAVE_BATTLEFIELD',effect('returnLinkedExile',{destination:'battlefield',ownerControl:true}),null,{source:'self'})],cardPatch:{linkedExileReturn:'battlefield'}}}:null),
  template('phase262.team-anthem-activation','Activated team +1/+1 until end of turn.',({text})=>{const m=text.match(/^((?:\{[^}]+\})+): Creatures you control get \+(\d+)\/\+(\d+) until end of turn\.?$/i);return m?{ast:{type:'card',abilities:[activated({mana:m[1]},effect('modifyPT',{selector:{kind:'creature',controller:'self'},power:Number(m[2]),toughness:Number(m[3]),duration:'END_OF_TURN'}))]}}:null;}),
  template('phase263.player-hexproof','Controller has hexproof.',({text})=>/^You have hexproof\.(?: \([^)]*\))?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{controllerKeywords:['hexproof']}}}:null),
  template('phase264.protection-artifacts','Protection from artifacts.',({text})=>/^Protection from artifacts$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{keywords:['protection from artifacts']}}}:null),
  template('phase265.provoke','Provoke attack trigger.',({text})=>/^Provoke \(/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{provoke:true}}}:null),
  template('phase266.land-tapped-choose-color','Land enters tapped and chooses a color.',({text})=>/^This land enters tapped\. As it enters, choose a color\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{entersTapped:true,asEntersChooseColor:true}}}:null),
  template('phase267.noncreature-oil','Noncreature spell cast adds oil counter.',({text})=>/^Whenever you cast a noncreature spell, put an oil counter on this creature\.?$/i.test(text)?{ast:{type:'card',abilities:[trigger('SPELL_CAST',effect('addCounter',{target:'self',counterType:'oil',amount:1}),{controller:'self',noncreature:true})]}}:null),
  template('phase268.ready-to-run','Ready to run commander pairing.',({text})=>/^Ready to run \(You can have two commanders if both have ready to run\.\)$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{commanderPairing:'ready to run'}}}:null),
  template('phase269.grave-spell-cost-reduction','Cost reduction per instant/sorcery in graveyard.',({text})=>/^This spell costs \{1\} less to cast for each instant and sorcery card in your graveyard\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{costReduction:{amount:1,per:{zone:'graveyard',controller:'self',types:['Instant','Sorcery']}}}}}:null),
  template('phase270.storage-counter','Land storage-counter activation.',({text})=>{const m=text.match(/^((?:\{[^}]+\})+), \{T\}: Put a storage counter on this land\.?$/i);return m?{ast:{type:'card',abilities:[activated({mana:m[1],tap:true},effect('addCounter',{target:'self',counterType:'storage',amount:1}))]}}:null;}),
  template('phase271.pay-x-life-cost','Pay X life additional casting cost.',({text})=>/^As an additional cost to cast this spell, pay X life\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{additionalCosts:[{kind:'life',amount:'X'}]}}}:null),
  template('phase272.choose-creature-type-eot','Activated temporary creature-type choice.',({text})=>{const m=text.match(/^((?:\{[^}]+\})+): This creature becomes the creature type of your choice until end of turn\.?$/i);return m?{ast:{type:'card',abilities:[activated({mana:m[1]},effect('chooseCreatureType',{target:'self',duration:'END_OF_TURN'}))]}}:null;}),
  template('phase273.damage-death-counter','Damaged creature death grows source.',({text})=>/^Whenever a creature dealt damage by this creature this turn dies, put a \+1\/\+1 counter on this creature\.?$/i.test(text)?{ast:{type:'card',abilities:[trigger('DIES',effect('addCounter',{target:'self',counterType:'+1/+1',amount:1}),{damagedBySourceThisTurn:true})]}}:null),
  template('phase274.madness','Madness alternate discard casting cost.',({text})=>{const m=text.match(/^Madness ((?:\{[^}]+\})+) \(/i);return m?{ast:{type:'card',abilities:[],cardPatch:{madness:{cost:m[1]}}}}:null;}),
  template('phase275.legendary-sorcery','Legendary sorcery casting restriction.',({text})=>/^\(You may cast a legendary sorcery only if you control a legendary creature or planeswalker\.\)$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{castRestriction:{kind:'legendarySorcery'}}}}:null),
  template('phase276.countered-creatures-trample','Creatures with +1/+1 counters have trample.',({text})=>/^Each creature you control with a \+1\/\+1 counter on it has trample\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{conditionalKeywordGrant:{selector:{kind:'creature',controller:'self',hasCounter:'+1/+1'},keyword:'trample'}}}}:null),
  template('phase277.specialize','Specialize activation.',({text})=>{const m=text.match(/^Specialize ((?:\{[^}]+\})+)$/i);return m?{ast:{type:'card',abilities:[],cardPatch:{specialize:{cost:m[1]}}}}:null;}),
  template('phase278.opponent-die-exile-replacement','Opponent creatures are exiled instead of dying.',({text})=>/^If a creature an opponent controls would die, exile it instead\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{replacementEffects:[{event:'WOULD_DIE',selector:{kind:'creature',controller:'opponent'},replaceWith:'EXILE'}]}}}:null),
  template('phase279.once-turn-pump','Activated pump limited to once each turn.',({text})=>{const m=text.match(/^((?:\{[^}]+\})+): This creature gets \+(\d+)\/\+(\d+) until end of turn\. Activate only once each turn\.?$/i);return m?{ast:{type:'card',abilities:[activated({mana:m[1]},effect('modifyPT',{target:'self',power:Number(m[2]),toughness:Number(m[3]),duration:'END_OF_TURN'}),null,{activationLimit:{perTurn:1}})]}}:null;}),
  template('phase280.friends-forever','Friends forever commander pairing.',({text})=>/^Partner—Friends forever \(You can have two commanders if both have this ability\.\)$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{commanderPairing:'friends forever'}}}:null)
];


// Phases 281–300 — next unresolved Oracle families.
const PHASE281_300_TEMPLATES = [
  template('phase281.protection-red-flying','Flying and protection from red.',({text})=>/^Flying, protection from red$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{keywords:['flying','protection from red']}}}:null),
  template('phase282.party-cost-reduction','Party-based generic cost reduction.',({text})=>/^This spell costs \{1\} less to cast for each creature in your party\./i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{costReduction:{amount:1,per:{kind:'partyMember'}},party:true}}}:null),
  template('phase283.deathtouch-activation','Black activation grants deathtouch.',({text})=>/^\{B\}: This creature gains deathtouch until end of turn\.?$/i.test(text)?{ast:{type:'card',abilities:[activated({mana:'{B}'},effect('grantKeyword',{target:'self',keyword:'deathtouch',duration:'END_OF_TURN'}))]}}:null),
  template('phase284.etb-draw-lose','ETB draw one and lose one life.',({text})=>/^When this creature enters, you draw a card and you lose 1 life\.?$/i.test(text)?{ast:{type:'card',abilities:[trigger('ENTER_BATTLEFIELD',effect('sequence',{effects:[effect('draw',{amount:1,target:'controller'}),effect('loseLife',{amount:1,target:'controller'})]}),null,{source:'self'})]}}:null),
  template('phase285.lands-any-color','Lands controller owns gain any-color mana ability.',({text})=>/^Lands you control have "\{T\}: Add one mana of any color\."$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{continuousAbilityGrant:{selector:{kind:'land',controller:'self'},ability:{type:'mana',tap:true,anyColor:true,amount:1}}}}}:null),
  template('phase286.multikicker-entry-counters','Entry counters equal times kicked.',({text})=>/^This creature enters with a \+1\/\+1 counter on it for each time it was kicked\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{entersCountersPerKick:{counterType:'+1/+1',amountPerKick:1}}}}:null),
  template('phase287.teamwork','Teamwork additional tap-power cost.',({text})=>{const m=text.match(/^Teamwork (\d+) \(/i);return m?{ast:{type:'card',abilities:[],cardPatch:{teamwork:{requiredPower:Number(m[1]),additionalCost:true}}}}:null;}),
  template('phase288.etb-freeze-opponent','ETB tap opponent creature and skip next untap.',({text})=>/^When this creature enters, tap target creature an opponent controls\. That creature doesn't untap during its controller's next untap step\.?$/i.test(text)?{ast:{type:'card',abilities:[trigger('ENTER_BATTLEFIELD',effect('sequence',{effects:[effect('tap',{target:'target'}),effect('skipNextUntap',{target:'target'})]}),null,{source:'self',targets:{kind:'creature',controller:'opponent'}})]}}:null),
  template('phase289.loot-one','Tap activation draws then discards.',({text})=>/^\{1\}, \{T\}: Draw a card, then discard a card\.?$/i.test(text)?{ast:{type:'card',abilities:[activated({mana:'{1}',tap:true},effect('sequence',{effects:[effect('draw',{amount:1,target:'controller'}),effect('discard',{amount:1,target:'controller',choice:true})]}))]}}:null),
  template('phase290.creature-grave-cost-reduction','Cost reduction per creature card in graveyard.',({text})=>/^This spell costs \{1\} less to cast for each creature card in your graveyard\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{costReduction:{amount:1,per:{zone:'graveyard',controller:'self',types:['Creature']}}}}}:null),
  template('phase291.counter-noncreature','Counter target noncreature spell.',({text})=>/^Counter target noncreature spell\.?$/i.test(text)?{ast:{type:'card',abilities:[spell(effect('counterSpellTarget'),{kind:'spell',noncreature:true})]}}:null),
  template('phase292.mana-filter-any','Pay two to add any color.',({text})=>/^\{2\}: Add one mana of any color\.?$/i.test(text)?{ast:{type:'card',abilities:[activated({mana:'{2}'},effect('addManaChoice',{amount:1,colors:['W','U','B','R','G']}))]}}:null),
  template('phase293.no-opponent-spells-your-turn','Opponents cannot cast spells during your turn.',({text})=>/^Your opponents can't cast spells during your turn\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{castingRestrictions:[{player:'opponent',during:'controllerTurn',prohibit:'spells'}]}}}:null),
  template('phase294.green-anthem','Other green creatures get +1/+1.',({text})=>/^Other green creatures you control get \+1\/\+1\.?$/i.test(text)?{ast:{type:'card',abilities:[staticAbility({selector:{kind:'creature',controller:'self',color:'G',excludeSelf:true}},effect('continuous',{layer:'PT_MODIFY',power:1,toughness:1}))]}}:null),
  template('phase295.etb-team-pump','ETB creatures you control get +1/+1 until end of turn.',({text})=>/^When this creature enters, creatures you control get \+1\/\+1 until end of turn\.?$/i.test(text)?{ast:{type:'card',abilities:[trigger('ENTER_BATTLEFIELD',effect('modifyPT',{selector:{kind:'creature',controller:'self'},power:1,toughness:1,duration:'END_OF_TURN'}),null,{source:'self'})]}}:null),
  template('phase296.connive-etb','ETB connive.',({text})=>/^When this creature enters, it connives\./i.test(text)?{ast:{type:'card',abilities:[trigger('ENTER_BATTLEFIELD',effect('connive',{target:'self',amount:1}),null,{source:'self'})],cardPatch:{connive:true}}}:null),
  template('phase297.toughness-combat-damage','Creatures assign combat damage using toughness.',({text})=>/^Each creature you control assigns combat damage equal to its toughness rather than its power\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{combatDamageUsesToughness:{selector:{kind:'creature',controller:'self'}}}}}:null),
  template('phase298.haunt','Haunt death exile attachment.',({text})=>/^Haunt \(/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{haunt:true}}}:null),
  template('phase299.modular','Modular entry counters and death transfer.',({text})=>{const m=text.match(/^Modular (\d+) \(/i);return m?{ast:{type:'card',abilities:[],cardPatch:{modular:Number(m[1]),entersWithCounters:{type:'+1/+1',amount:Number(m[1])}}}}:null;}),
  template('phase300.attack-block-together','Cannot attack or block alone.',({text})=>/^This creature can't attack or block alone\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{combatRestriction:{attackRequiresAnother:true,blockRequiresAnother:true}}}}:null)
];



// Phases 301–320 — high-frequency unresolved Oracle families.
const PHASE301_320_TEMPLATES = [
  template('phase301.draw-one','Draw a card.',({text})=>/^Draw a card\.?$/i.test(text)?{ast:{type:'card',abilities:[spell(effect('draw',{amount:1,target:'controller'}))]}}:null),
  template('phase302.etb-gain-three','Creature ETB gain 3 life.',({text})=>/^When this creature enters, you gain 3 life\.?$/i.test(text)?{ast:{type:'card',abilities:[trigger('ENTER_BATTLEFIELD',effect('gainLife',{amount:3,target:'controller'}),null,{source:'self'})]}}:null),
  template('phase303.destroy-artifact','Destroy target artifact.',({text})=>/^Destroy target artifact\.?$/i.test(text)?{ast:{type:'card',abilities:[spell(effect('destroy',{target:'target'}),{kind:'artifact'})]}}:null),
  template('phase304.return-creature-grave-hand','Return target creature card from graveyard to hand.',({text})=>/^Return target creature card from your graveyard to your hand\.?$/i.test(text)?{ast:{type:'card',abilities:[spell(effect('moveZone',{target:'target',from:'graveyard',to:'hand'}),{kind:'card',zone:'graveyard',controller:'self',types:['Creature']})]}}:null),
  template('phase305.destroy-enchantment','Destroy target enchantment.',({text})=>/^Destroy target enchantment\.?$/i.test(text)?{ast:{type:'card',abilities:[spell(effect('destroy',{target:'target'}),{kind:'enchantment'})]}}:null),
  template('phase306.colorless-mana','Tap to add colorless mana.',({text})=>/^\{T\}: Add \{C\}\.?(?: \(\{C\} represents colorless mana\.\))?$/i.test(text)?{ast:{type:'card',abilities:[activated({tap:true},effect('addMana',{color:'C',amount:1}))]}}:null),
  template('phase307.upkeep-self-damage','Upkeep source deals 1 damage to controller.',({text})=>/^At the beginning of your upkeep, this creature deals 1 damage to you\.?$/i.test(text)?{ast:{type:'card',abilities:[trigger('UPKEEP',effect('damage',{amount:1,target:'controller',source:'self'}),{controllerEvent:true,sourceSelf:true})]}}:null),
  template('phase308.draw-two-lose-two','Target player draws two and loses two.',({text})=>/^Target player draws two cards and loses 2 life\.?$/i.test(text)?{ast:{type:'card',abilities:[spell(effect('sequence',{effects:[effect('draw',{amount:2,target:'target'}),effect('loseLife',{amount:2,target:'target'})]}),{kind:'player'})]}}:null),
  template('phase309.mana-leak','Counter target spell unless controller pays 3.',({text})=>/^Counter target spell unless its controller pays \{3\}\.?$/i.test(text)?{ast:{type:'card',abilities:[spell(effect('counterUnlessPays',{amount:3,target:'target'}),{kind:'spell'})]}}:null),
  template('phase310.aura-no-untap','Enchanted permanent does not untap.',({text})=>/^Enchanted permanent doesn't untap during its controller's untap step\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{attachedPermanentRestrictions:{untap:false}}}}:null),
  template('phase311.threaten','Temporary creature control, untap, haste.',({text})=>/^Gain control of target creature until end of turn\. Untap that creature\. It gains haste until end of turn\.?$/i.test(text)?{ast:{type:'card',abilities:[spell(effect('sequence',{effects:[effect('gainControl',{target:'target',duration:'END_OF_TURN'}),effect('untap',{target:'target'}),effect('grantKeyword',{target:'target',keyword:'haste',duration:'END_OF_TURN'})]}),{kind:'creature'})]}}:null),
  template('phase312.extra-draw','Additional card at draw step.',({text})=>/^At the beginning of your draw step, draw an additional card\.?$/i.test(text)?{ast:{type:'card',abilities:[trigger('DRAW_STEP',effect('draw',{amount:1,target:'controller'}),{controllerEvent:true})]}}:null),
  template('phase313.aura-lockdown','Enchanted permanent cannot attack, block, or activate abilities.',({text})=>/^Enchanted permanent can't attack or block, and its activated abilities can't be activated\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{attachedPermanentRestrictions:{attack:false,block:false,activateAbilities:false}}}}:null),
  template('phase314.etb-top-four-reorder','ETB look at top four and reorder.',({text})=>/^When this creature enters, look at the top four cards of your library, then put them back in any order\.?$/i.test(text)?{ast:{type:'card',abilities:[trigger('ENTER_BATTLEFIELD',effect('reorderLibraryTop',{count:4}),null,{source:'self'})]}}:null),
  template('phase315.chosen-type-anthem','Chosen creature type gets +1/+1.',({text})=>/^Creatures you control of the chosen type get \+1\/\+1\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{chosenTypeAnthem:{power:1,toughness:1,controller:'self'}}}}:null),
  template('phase316.sacrifice-land-cost','Sacrifice a land as additional casting cost.',({text})=>/^As an additional cost to cast this spell, sacrifice a land\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{additionalCosts:[{sacrifice:{type:'Land',count:1}}]}}}:null),
  template('phase317.destroy-attacker','Destroy target attacking creature.',({text})=>/^Destroy target attacking creature\.?$/i.test(text)?{ast:{type:'card',abilities:[spell(effect('destroy',{target:'target'}),{kind:'creature',attacking:true})]}}:null),
  template('phase318.death-growth','Another controlled creature dying adds +1/+1 counter.',({text})=>/^Whenever another creature you control dies, put a \+1\/\+1 counter on this creature\.?$/i.test(text)?{ast:{type:'card',abilities:[trigger('DIES',effect('addCounter',{target:'self',counterType:'+1/+1',amount:1}),{controllerEvent:true,cardType:'Creature',other:true})]}}:null),
  template('phase319.destroy-power-four','Destroy target creature power 4 or greater.',({text})=>/^Destroy target creature with power 4 or greater\.?$/i.test(text)?{ast:{type:'card',abilities:[spell(effect('destroy',{target:'target'}),{kind:'creature',power:{gte:4}})]}}:null),
  template('phase320.uncounterable','Spell cannot be countered.',({text})=>/^This spell can't be countered\.?\s*(?:\(This includes by the ward ability\.\))?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{cantBeCountered:true}}}:null)
];



// Phases 321–340 — next high-frequency unresolved Oracle families.
const PHASE321_340_TEMPLATES = [
  template('phase321.linked-return-hand','Linked exiled card returns to owner hand.',({text})=>/^When this creature leaves the battlefield, return the exiled card to its owner's hand\.?$/i.test(text)?{ast:{type:'card',abilities:[trigger('LEAVE_BATTLEFIELD',effect('returnLinkedExile',{destination:'hand',ownerControl:true}),null,{source:'self'})],cardPatch:{linkedExileReturn:'hand'}}}:null),
  template('phase322.charge-mana-any','Remove charge counter and tap land for any color.',({text})=>/^\{T\}, Remove a charge counter from this land: Add one mana of any color\.?$/i.test(text)?{ast:{type:'card',abilities:[activated({tap:true,removeCounters:{type:'charge',amount:1}},effect('addManaChoice',{amount:1,colors:['W','U','B','R','G']}))]}}:null),
  template('phase323.starting-intensity','Starting intensity marker.',({text})=>{const m=text.match(/^Starting intensity (\d+)\.?$/i);return m?{ast:{type:'card',abilities:[],cardPatch:{startingIntensity:Number(m[1]),intensity:Number(m[1])}}}:null;}),
  template('phase324.converge-counters','Converge entry counters by colors spent.',({text})=>/^Converge — This creature enters with a \+1\/\+1 counter on it for each color of mana spent to cast it\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{entersWithCountersByManaColors:{type:'+1/+1'}}}}:null),
  template('phase325.tiered','Tiered additional-cost choice.',({text})=>/^Tiered \(Choose one additional cost\.\)$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{tiered:true,additionalCostChoiceCount:1}}}:null),
  template('phase326.ninjutsu','Ninjutsu alternate-zone activated ability.',({text})=>{const m=text.match(/^Ninjutsu ((?:\{[^}]+\})+) \(/i);return m?{ast:{type:'card',abilities:[],cardPatch:{ninjutsu:{cost:m[1],returnUnblockedAttacker:true,entersTappedAttacking:true}}}}:null;}),
  template('phase327.vanishing','Vanishing entry/time-counter lifecycle.',({text})=>{const m=text.match(/^Vanishing (\d+) \(/i);return m?{ast:{type:'card',abilities:[],cardPatch:{vanishing:Number(m[1]),entersWithCounters:{type:'time',amount:Number(m[1])},removeTimeCounterAtUpkeep:true,sacrificeWhenLastTimeRemoved:true}}}:null;}),
  template('phase328.enchanted-land-mana-bonus','Enchanted land adds extra any-color mana.',({text})=>/^Whenever enchanted land is tapped for mana, its controller adds an additional one mana of any color\.?$/i.test(text)?{ast:{type:'card',abilities:[trigger('MANA_ABILITY_RESOLVED',effect('addManaChoice',{amount:1,colors:['W','U','B','R','G'],target:'eventController'}),{enchantedPermanent:true})]}}:null),
  template('phase329.shield-entry','Permanent enters with shield counter.',({text})=>/^This creature enters with a shield counter on it\./i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{entersWithCounters:{type:'shield',amount:1},shieldCounters:true}}}:null),
  template('phase330.creature-only-any-mana','Tap for any color restricted to creature spells.',({text})=>/^\{T\}: Add one mana of any color\. Spend this mana only to cast a creature spell\.?$/i.test(text)?{ast:{type:'card',abilities:[activated({tap:true},effect('addRestrictedMana',{amount:1,colors:['W','U','B','R','G'],restriction:{castType:'Creature'}}))]}}:null),
  template('phase331.energy-attack-counter','Attack may pay two energy for counter.',({text})=>/^Whenever this creature attacks, you may pay \{E\}\{E\}\. If you do, put a \+1\/\+1 counter on it\.?$/i.test(text)?{ast:{type:'card',abilities:[trigger('ATTACK',effect('optionalPayThen',{cost:{energy:2},effect:effect('addCounter',{target:'self',counterType:'+1/+1',amount:1})}),{sourceSelf:true})]}}:null),
  template('phase332.draw-lose-one','Draw a card and lose one life.',({text})=>/^•?\s*You draw a card and you lose 1 life\.?$/i.test(text)?{ast:{type:'card',abilities:[spell(effect('sequence',{effects:[effect('draw',{amount:1,target:'controller'}),effect('loseLife',{amount:1,target:'controller'})]}))]}}:null),
  template('phase333.cant-blocked-artifacts','Cannot be blocked by artifact creatures.',({text})=>/^This creature can't be blocked by artifact creatures\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{evasion:{cannotBeBlockedBy:{artifact:true,creature:true}}}}}:null),
  template('phase334.enchanted-land-dies-return','Enchanted land death returns card to owner hand.',({text})=>/^When enchanted land dies, return that card to its owner's hand\.?$/i.test(text)?{ast:{type:'card',abilities:[trigger('DIES',effect('moveZone',{target:'eventObject',to:'hand',owner:true}),{enchantedPermanent:true,cardType:'Land'})]}}:null),
  template('phase335.loot-activation','Blue tap loot activation.',({text})=>/^\{U\}, \{T\}: Draw a card, then discard a card\.?$/i.test(text)?{ast:{type:'card',abilities:[activated({mana:'{U}',tap:true},effect('drawThenDiscard',{draw:1,discard:1,target:'controller'}))]}}:null),
  template('phase336.fight-controlled','Controlled creature fights uncontrolled target.',({text})=>/^Target creature you control fights target creature you don't control\./i.test(text)?{ast:{type:'card',abilities:[spell(effect('fight',{targets:['target1','target2']}),{targets:[{kind:'creature',controller:'self'},{kind:'creature',controller:'notSelf'}]})]}}:null),
  template('phase337.extra-turn','Take an extra turn.',({text})=>/^Take an extra turn after this one\.?$/i.test(text)?{ast:{type:'card',abilities:[spell(effect('extraTurn',{player:'controller',amount:1}))]}}:null),
  template('phase338.upkeep-sac-creature','Upkeep sacrifice a creature.',({text})=>/^At the beginning of your upkeep, sacrifice a creature\.?$/i.test(text)?{ast:{type:'card',abilities:[trigger('UPKEEP',effect('sacrifice',{selector:{kind:'creature',controller:'self'},amount:1}),{controllerEvent:true})]}}:null),
  template('phase339.death-transfer-counters','Death transfers source counters to target creature.',({text})=>/^When this creature dies, put its counters on target creature you control\.?$/i.test(text)?{ast:{type:'card',abilities:[trigger('DIES',effect('transferAllCounters',{from:'eventObject',to:'target'}),{sourceSelf:true},{targets:{kind:'creature',controller:'self'}})]}}:null),
  template('phase340.create-treasure','Create a Treasure token.',({text})=>/^•?\s*Create a Treasure token\.?$/i.test(text)?{ast:{type:'card',abilities:[spell(effect('createToken',{token:{name:'Treasure',types:['Artifact'],subtypes:['Treasure'],count:1}}))]}}:null)
];


const PHASE342_360_TEMPLATES = [
  template('phase342.colorless-reminder','Colorless mana reminder text.',({text})=>/^\(\{C\} represents colorless mana\.\)$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{rulesReminderOnly:true}}}:null),
  template('phase343.pt-marker','Standalone power/toughness structural marker.',({text})=>/^\d+\/\d+$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{structuralMarker:text}}}:null),
  template('phase344.mana-any-color-two','Tap to add two mana of one color.',({text})=>/^\{T\}: Add two mana of any one color\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{abilities:[{type:'mana',tap:true,manaChoice:{amount:2,sameColor:true}}]}}}:null),
  template('phase345.loot-tap','Tap and discard to draw.',({text})=>/^\{T\}, Discard a card: Draw a card\.?$/i.test(text)?{ast:{type:'card',abilities:[activated({tap:true,discard:{amount:1}},effect('draw',{amount:1,target:'controller'}))]}}:null),
  template('phase346.fight-like','Controlled creature deals power damage to opposing creature.',({text})=>/^Target creature you control deals damage equal to its power to target creature an opponent controls\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{powerDamageTargetPair:{sourceController:'self',targetController:'opponent'}}}}:null),
  template('phase347.hexproof-artifacts-enchantments','Hexproof from artifacts and enchantments.',({text})=>/^Hexproof from artifacts and enchantments$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{hexproofFrom:['Artifact','Enchantment']}}}:null),
  template('phase348.white-anthem','Other white creatures get +1/+1.',({text})=>/^Other white creatures you control get \+1\/\+1\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{continuousAnthem:{selector:{kind:'creature',controller:'self',color:'W',other:true},power:1,toughness:1}}}}:null),
  template('phase349.self-graveyard-return','Return this card from graveyard to hand.',({text})=>/^\{2\}\{B\}: Return this card from your graveyard to your hand\.?$/i.test(text)?{ast:{type:'card',abilities:[activated({mana:'{2}{B}',zone:'graveyard'},effect('moveZone',{target:'self',fromZone:'graveyard',toZone:'hand',owner:true}))]}}:null),
  template('phase350.enchanted-land-double-any','Enchanted land taps for two mana of one color.',({text})=>/^Enchanted land has "\{T\}: Add two mana of any one color\."$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{grantedManaAbility:{tap:true,amount:2,choice:'color',to:'enchanted'}}}}:null),
  template('phase351.dfc-checklist-reminder','DFC checklist reminder.',({text})=>/^\(You can mark this card to represent a double-faced card in your library or hand\.\)$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{rulesReminderOnly:true}}}:null),
  template('phase352.combat-freeze','Combat damage to creature freezes it.',({text})=>/^Whenever this creature deals combat damage to a creature, tap that creature and it doesn't untap during its controller's next untap step\.?$/i.test(text)?{ast:{type:'card',abilities:[trigger('COMBAT_DAMAGE_CREATURE',effect('sequence',{effects:[effect('tap',{target:'eventObject'}),effect('skipNextUntap',{target:'eventObject'})]}),{sourceSelf:true})]}}:null),
  template('phase353.lure-target','All creatures able to block target creature do so.',({text})=>/^All creatures able to block target creature this turn do so\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{targetCreatureMustBeBlockedThisTurn:true}}}:null),
  template('phase354.aura-dies-return','Return enchanted creature when it dies.',({text})=>/^When enchanted creature dies, return that card to the battlefield under your control\.?$/i.test(text)?{ast:{type:'card',abilities:[trigger('DIES',effect('moveZone',{target:'eventObject',fromZone:'graveyard',toZone:'battlefield',controller:'self'}),{enchantedObject:true})]}}:null),
  template('phase355.no-max-hand','Players have no maximum hand size.',({text})=>/^Players have no maximum hand size\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{maximumHandSize:null,appliesTo:'allPlayers'}}}:null),
  template('phase356.flash-surcharge','May cast as flash for two more.',({text})=>/^You may cast this spell as though it had flash if you pay \{2\} more to cast it\. \(You may cast it any time you could cast an instant\.\)$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{castingOptions:[{timing:'instant',additionalManaCost:'{2}'}]}}}:null),
  template('phase357.level-marker','Level range structural marker.',({text})=>/^LEVEL (?:\d+-\d+|\d+\+)$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{levelMarker:text}}}:null),
  template('phase358.copy-next-spell','Copy next instant or sorcery this turn.',({text})=>/^When you next cast an instant or sorcery spell this turn, copy that spell\. You may choose new targets for the copy\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{copyNextInstantOrSorceryThisTurn:true,mayChooseNewTargets:true}}}:null),
  template('phase359.blue-anthem','Other blue creatures get +1/+1.',({text})=>/^Other blue creatures you control get \+1\/\+1\.?$/i.test(text)?{ast:{type:'card',abilities:[],cardPatch:{continuousAnthem:{selector:{kind:'creature',controller:'self',color:'U',other:true},power:1,toughness:1}}}}:null),
  template('phase360.life-gain-drain','Whenever you gain life, target opponent loses that much life.',({text})=>/^Whenever you gain life, target opponent loses that much life\.?$/i.test(text)?{ast:{type:'card',abilities:[trigger('GAIN_LIFE',effect('loseLife',{amount:'eventAmount',target:'target'}),{controllerEvent:true},{targets:{kind:'player',controller:'opponent'}})]}}:null)
];

export class OracleTemplateLibrary {
  constructor(templates = [...PHASE342_360_TEMPLATES, ...PHASE321_340_TEMPLATES, ...PHASE301_320_TEMPLATES, ...PHASE281_300_TEMPLATES, ...PHASE261_280_TEMPLATES, ...PHASE241_260_TEMPLATES, ...PHASE221_240_TEMPLATES, ...PHASE181_200_TEMPLATES, ...PHASE161_180_TEMPLATES, ...PHASE141_160_TEMPLATES, ...PHASE131_140_TEMPLATES, ...PHASE91_100_TEMPLATES, ...PHASE68_TEMPLATES, ...PHASE61_65_TEMPLATES, ...PHASE56_60_TEMPLATES, ...PHASE51_55_TEMPLATES, ...PHASE49_50_TEMPLATES, ...PHASE37_38_TEMPLATES, ...TEMPLATES]) { this.templates = [...templates]; }
  list() { return this.templates.map(({ id, description, confidence }) => ({ id, description, confidence })); }
  match(card = {}) {
    const text = normalizeOracleText(card.oracleText || '');
    const matches = [];
    for (const entry of this.templates) {
      const result = entry.match({ card, text });
      if (result) matches.push({ templateId: entry.id, confidence: entry.confidence, description: entry.description, ...result });
    }
    // Phase 69 broad grammars are fallback families. When an older, narrower
    // exact template also matches, prefer the narrower implementation rather
    // than treating semantically overlapping grammar as an ambiguity.
    if (matches.length > 1) {
      const specific = matches.filter(row => !row.templateId.startsWith('phase69.'));
      if (specific.length === 1) return specific;
    }
    return matches;
  }
}

export const ORACLE_TEMPLATE_IDS = Object.freeze([...PHASE281_300_TEMPLATES, ...PHASE261_280_TEMPLATES, ...PHASE241_260_TEMPLATES, ...PHASE221_240_TEMPLATES, ...PHASE161_180_TEMPLATES, ...PHASE141_160_TEMPLATES, ...PHASE131_140_TEMPLATES, ...PHASE91_100_TEMPLATES, ...PHASE68_TEMPLATES, ...PHASE61_65_TEMPLATES, ...PHASE56_60_TEMPLATES, ...PHASE51_55_TEMPLATES, ...PHASE49_50_TEMPLATES, ...PHASE37_38_TEMPLATES, ...TEMPLATES].map(item => item.id));
