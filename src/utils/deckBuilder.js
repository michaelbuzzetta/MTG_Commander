const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G'];
const BASIC_BY_COLOR = { W: 'plains', U: 'island', B: 'swamp', R: 'mountain', G: 'forest' };

const STRATEGY_PATTERNS = [
  { key: 'human-tribal', label: 'Human Tribal', patterns: [/\bhuman(?:s)?\b/i] },
  { key: 'merfolk-tribal', label: 'Merfolk Tribal', patterns: [/\bmerfolk\b/i] },
  { key: 'wizard-tribal', label: 'Wizard Tribal', patterns: [/\bwizard(?:s)?\b/i] },
  { key: 'dragon-tribal', label: 'Dragon Tribal', patterns: [/\bdragon(?:s)?\b/i] },
  { key: 'artifact', label: 'Artifacts', patterns: [/\bartifact(?:s)?\b/i, /\bhistoric\b/i] },
  { key: 'enchantment', label: 'Enchantments', patterns: [/\benchantment(?:s)?\b/i] },
  { key: 'sagas', label: 'Sagas', patterns: [/\bsaga(?:s)?\b/i, /\blore counter/i] },
  { key: 'legends', label: 'Legends', patterns: [/\blegendary\b/i, /\bhistoric\b/i] },
  { key: 'tokens', label: 'Tokens', patterns: [/\btoken(?:s)?\b/i, /\bcreate\b[^.]*\bcreature/i] },
  { key: 'counters', label: '+1/+1 Counters', patterns: [/\+1\/\+1 counter/i, /\bproliferate\b/i, /\bcounters? on\b/i] },
  { key: 'equipment', label: 'Equipment / Auras', patterns: [/\bequipment\b/i, /\baura(?:s)?\b/i, /\battached\b/i] },
  { key: 'graveyard', label: 'Graveyard', patterns: [/\bgraveyard\b/i, /\breturn .+ from your graveyard/i, /\breanimate/i] },
  { key: 'spellslinger', label: 'Spellslinger', patterns: [/\binstant(?:s)?\b/i, /\bsorcer(?:y|ies)\b/i, /whenever you cast (?:an? )?spell/i] },
  { key: 'combat', label: 'Combat', patterns: [/\battacks?\b/i, /\bcombat\b/i, /\battacking\b/i] },
  { key: 'lifegain', label: 'Life Gain', patterns: [/\bgain(?:s|ed)? life\b/i, /\blifelink\b/i] },
  { key: 'sacrifice', label: 'Sacrifice', patterns: [/\bsacrifice\b/i, /\bdies\b/i] },
  { key: 'lands', label: 'Lands', patterns: [/\bland(?:s)?\b/i, /\blandfall\b/i] },
  { key: 'draw', label: 'Card Draw', patterns: [/\bdraw (?:a|one|two|three|\d+) cards?\b/i, /\bcard draw\b/i] },
];

const KNOWN_TRIBES = [
  'Human','Merfolk','Wizard','Dragon','Warrior','Cleric','Soldier','Elf','Goblin','Zombie','Vampire','Angel','Demon','Spirit','Beast','Druid','Artificer','Monk','Pirate','Rogue','Knight','God','Doctor','Advisor','Bard','Phyrexian','Elemental','Dinosaur','Cat','Dog','Bear','Bird','Shark','Snake','Rat','Insect','Saproling'
];

const rolePriority = ['Land', 'Ramp', 'Card Draw', 'Removal', 'Board Wipe', 'Protection', 'Tutor', 'Synergy'];

function textFor(def) {
  return `${def?.name || ''}\n${def?.typeLine || ''}\n${def?.oracleText || def?.customRulesText || ''}`;
}

function lowerText(def) { return textFor(def).toLowerCase(); }

function isBasicLand(def) { return /\bBasic Land\b/i.test(def?.typeLine || ''); }
function isLand(def) { return /\bLand\b/i.test(def?.typeLine || ''); }
function isCreature(def) { return /\bCreature\b/i.test(def?.typeLine || ''); }

export function isCommanderCandidate(def) {
  if (!def || (def.supported === false && !def.catalogCard)) return false;
  if (def.catalogCard && def.legalities?.commander && def.legalities.commander !== 'legal') return false;
  const type = def.typeLine || '';
  const text = def.oracleText || '';
  return (/\bLegendary\b/i.test(type) && /\bCreature\b/i.test(type)) || /can be your commander/i.test(text);
}

export function commanderLegal(def, commander) {
  if (!def || !commander || (def.supported === false && !def.catalogCard)) return false;
  if (def.catalogCard && def.legalities?.commander && def.legalities.commander !== 'legal') return false;
  const commanderColors = new Set(commander.colorIdentity || []);
  return (def.colorIdentity || []).every(color => commanderColors.has(color));
}

export function classifyCardRoles(def) {
  if (!def) return ['Synergy'];
  if (isLand(def)) return ['Land'];
  const text = lowerText(def);
  const roles = [];
  const hasManaAbility = (def.abilities || []).some(ability => ability?.type === 'mana');

  if (
    hasManaAbility ||
    /\badd \{?[wubrgc]/i.test(def.oracleText || '') ||
    /search your library for (?:a|an|up to one|two) (?:basic )?land/i.test(def.oracleText || '') ||
    /spells? you cast cost \{?\d/i.test(def.oracleText || '')
  ) roles.push('Ramp');

  if (/\bdraw (?:a|one|two|three|four|\d+) cards?\b/i.test(text) || /\bwhenever\b[^.]*\bdraw a card\b/i.test(text) || /\blook at the top\b[^.]*\bput .+ into your hand\b/i.test(text)) roles.push('Card Draw');
  if (/\bdestroy target\b/i.test(text) || /\bexile target\b/i.test(text) || /\bcounter target (?:spell|ability)\b/i.test(text) || /\breturn target\b[^.]*\bto (?:its|their) owner's hand\b/i.test(text)) roles.push('Removal');
  if (/\bdestroy all\b/i.test(text) || /\bexile all\b/i.test(text) || /\ball creatures get -\d/i.test(text) || /\beach creature gets -\d/i.test(text)) roles.push('Board Wipe');
  if (/\bhexproof\b/i.test(text) || /\bindestructible\b/i.test(text) || /\bphase out\b/i.test(text) || /\bprotection from\b/i.test(text) || /\bregenerate\b/i.test(text)) roles.push('Protection');
  if (/search your library for (?!a basic land|a land|an? .* land)[^.]+card/i.test(text)) roles.push('Tutor');
  if (!roles.length) roles.push('Synergy');
  return roles;
}

function detectedTribes(commander) {
  const oracle = commander?.oracleText || '';
  return KNOWN_TRIBES.filter(tribe => new RegExp(`\\b${tribe}(?:s)?\\b`, 'i').test(oracle));
}

export function detectCommanderProfile(commander) {
  if (!commander) return { strategies: [], tribes: [], colors: [], concepts: [] };
  const oracle = commander.oracleText || '';
  const strategies = STRATEGY_PATTERNS
    .filter(strategy => strategy.patterns.some(pattern => pattern.test(oracle)))
    .map(strategy => ({ key: strategy.key, label: strategy.label }));

  const tribes = detectedTribes(commander);
  const concepts = [];
  if (/\+1\/\+1 counter/i.test(oracle)) concepts.push('+1/+1 counters');
  if (/\bproliferate\b/i.test(oracle)) concepts.push('proliferate');
  if (/\btoken/i.test(oracle)) concepts.push('tokens');
  if (/\benter(?:s|ing)? the battlefield\b|\benters\b/i.test(oracle)) concepts.push('ETB');
  if (/\battacks?\b/i.test(oracle)) concepts.push('attacking');
  if (/\bcast\b/i.test(oracle)) concepts.push('casting');
  if (/\bgraveyard\b/i.test(oracle)) concepts.push('graveyard');
  if (/\bsacrifice\b/i.test(oracle)) concepts.push('sacrifice');
  if (/\bhistoric\b/i.test(oracle)) concepts.push('historic');

  return {
    colors: [...(commander.colorIdentity || [])],
    strategies,
    tribes,
    concepts,
  };
}

function strategyMatches(def, strategyKey) {
  const text = textFor(def);
  switch (strategyKey) {
    case 'human-tribal': return /\bHuman\b/i.test(def.typeLine || '') || /\bHumans?\b/i.test(text);
    case 'merfolk-tribal': return /\bMerfolk\b/i.test(def.typeLine || '') || /\bMerfolk\b/i.test(text);
    case 'wizard-tribal': return /\bWizard\b/i.test(def.typeLine || '') || /\bWizards?\b/i.test(text);
    case 'dragon-tribal': return /\bDragon\b/i.test(def.typeLine || '') || /\bDragons?\b/i.test(text);
    case 'artifact': return /\bArtifact\b/i.test(def.typeLine || '') || /\bartifact/i.test(text) || /\bhistoric\b/i.test(text);
    case 'enchantment': return /\bEnchantment\b/i.test(def.typeLine || '') || /\benchantment/i.test(text);
    case 'sagas': return /\bSaga\b/i.test(def.typeLine || '') || /\bsaga/i.test(text) || /\blore counter/i.test(text);
    case 'legends': return /\bLegendary\b/i.test(def.typeLine || '') || /\blegendary/i.test(text) || /\bhistoric/i.test(text);
    case 'tokens': return /\btoken/i.test(text) || /\bcreate\b/i.test(text);
    case 'counters': return /counter/i.test(text) || /\bproliferate\b/i.test(text);
    case 'equipment': return /\bEquipment\b|\bAura\b/i.test(def.typeLine || '') || /\bequipment\b|\baura\b|\battach/i.test(text);
    case 'graveyard': return /\bgraveyard\b|\bdies\b|\breturn .+ from your graveyard/i.test(text);
    case 'spellslinger': return /\bInstant\b|\bSorcery\b/i.test(def.typeLine || '') || /whenever you cast|instant|sorcery/i.test(text);
    case 'combat': return /\battack|combat|double strike|first strike|trample|menace|vigilance/i.test(text);
    case 'lifegain': return /\bgain .+ life|lifelink/i.test(text);
    case 'sacrifice': return /\bsacrifice|dies\b/i.test(text);
    case 'lands': return isLand(def) || /\blandfall\b|land enters|play an additional land|search your library for .+ land/i.test(text);
    case 'draw': return /\bdraw .+ card/i.test(text);
    default: return false;
  }
}

function commanderPipDemand(commander) {
  const demand = Object.fromEntries(COLOR_ORDER.map(color => [color, 0]));
  for (const color of commander?.colorIdentity || []) demand[color] += 2;
  const text = `${commander?.manaCost || ''} ${commander?.oracleText || ''}`;
  for (const symbol of text.matchAll(/\{([WUBRG])\}/g)) demand[symbol[1]] += 1;
  return demand;
}

export function scoreCardForCommander(def, commander, { strategyKey = null } = {}) {
  if (!commanderLegal(def, commander) || def.id === commander.id) return { score: -Infinity, reasons: [], roles: [] };
  const profile = detectCommanderProfile(commander);
  const cardText = textFor(def);
  const oracle = def.oracleText || '';
  const roles = classifyCardRoles(def);
  let score = 8;
  const reasons = [];

  // Cards that directly share a creature type explicitly named in the commander's rules text are highly relevant.
  for (const tribe of profile.tribes) {
    if (new RegExp(`\\b${tribe}\\b`, 'i').test(def.typeLine || '')) {
      score += 36;
      reasons.push(`${tribe} synergy`);
    } else if (new RegExp(`\\b${tribe}(?:s)?\\b`, 'i').test(cardText)) {
      score += 22;
      reasons.push(`supports ${tribe}s`);
    }
  }

  const matchedStrategies = profile.strategies.filter(strategy => strategyMatches(def, strategy.key));
  score += matchedStrategies.length * 15;
  if (matchedStrategies.length) reasons.push(...matchedStrategies.slice(0, 2).map(strategy => strategy.label));

  if (strategyKey && strategyMatches(def, strategyKey)) {
    score += 22;
    const strategy = STRATEGY_PATTERNS.find(item => item.key === strategyKey);
    if (strategy) reasons.unshift(`${strategy.label} focus`);
  }

  // Reward cards whose text mirrors the commander's most meaningful verbs/mechanics.
  const commanderOracle = commander.oracleText || '';
  const mirrored = [
    ['+1/+1 counter', /\+1\/\+1 counter/i],
    ['proliferate', /\bproliferate\b/i],
    ['tokens', /\btoken/i],
    ['ETB', /\benters\b|enter the battlefield/i],
    ['attack', /\battack/i],
    ['graveyard', /\bgraveyard\b/i],
    ['sacrifice', /\bsacrifice\b/i],
    ['historic', /\bhistoric\b|\bLegendary\b|\bArtifact\b|\bSaga\b/i],
  ];
  for (const [label, pattern] of mirrored) {
    if (pattern.test(commanderOracle) && pattern.test(cardText)) {
      score += 8;
      if (!reasons.some(reason => reason.toLowerCase().includes(label.toLowerCase()))) reasons.push(`${label} synergy`);
    }
  }

  // Core Commander infrastructure remains useful, but synergy should outrank generic staples.
  if (roles.includes('Ramp')) { score += 6; reasons.push('ramp'); }
  if (roles.includes('Card Draw')) { score += 6; reasons.push('card advantage'); }
  if (roles.includes('Removal')) { score += 5; reasons.push('interaction'); }
  if (roles.includes('Protection')) { score += 5; reasons.push('protection'); }
  if (roles.includes('Board Wipe')) { score += 4; reasons.push('board control'); }
  if (roles.includes('Tutor')) { score += 4; reasons.push('consistency'); }

  // Efficient spells get a modest bump. Do not let this dominate synergy.
  const mv = Number(def.manaValue || 0);
  if (!isLand(def)) {
    if (mv <= 2) score += 4;
    else if (mv <= 4) score += 3;
    else if (mv >= 7) score -= 3;
  }

  // Creature cards are modestly better for creature-centric tribal/combat commanders.
  if (isCreature(def) && (profile.tribes.length || profile.strategies.some(item => ['tokens','combat','counters'].includes(item.key)))) score += 3;

  // Keep universal colorless staples useful without letting them monopolize the top row.
  if ((def.colorIdentity || []).length === 0 && /^(Sol Ring|Arcane Signet|Command Tower)$/i.test(def.name || '')) score += 8;

  return {
    score: Math.max(0, Math.round(score)),
    reasons: [...new Set(reasons)].slice(0, 4),
    roles,
  };
}

export function recommendationList(db, commander, { strategyKey = null, search = '', role = 'Recommended', limit = 120 } = {}) {
  if (!commander) return [];
  const needle = String(search || '').trim().toLowerCase();
  const entries = Object.values(db || {})
    .filter(def => def && def.id !== commander.id && commanderLegal(def, commander))
    .map(def => ({ def, ...scoreCardForCommander(def, commander, { strategyKey }) }))
    .filter(entry => Number.isFinite(entry.score))
    .filter(entry => !needle || lowerText(entry.def).includes(needle))
    .filter(entry => role === 'Recommended' || role === 'All' || entry.roles.includes(role))
    .sort((a, b) => b.score - a.score || Number(a.def.manaValue || 0) - Number(b.def.manaValue || 0) || String(a.def.name).localeCompare(String(b.def.name)));

  return entries.slice(0, limit);
}

function selectedQuantityMap(entries = []) {
  const map = new Map();
  for (const entry of entries) map.set(entry.id, Number(entry.quantity || 0));
  return map;
}

function addUnique(output, selected, candidate, amount = 1) {
  if (!candidate?.def?.id || selected.has(candidate.def.id)) return false;
  if (isBasicLand(candidate.def)) return false;
  selected.add(candidate.def.id);
  output.push({ id: candidate.def.id, quantity: amount });
  return true;
}

function fillRole(output, selected, recommendations, role, target) {
  const current = output.reduce((count, entry) => count + (entry._roles?.includes(role) ? entry.quantity : 0), 0);
  let need = Math.max(0, target - current);
  if (!need) return;
  for (const candidate of recommendations) {
    if (need <= 0) break;
    if (!candidate.roles.includes(role)) continue;
    if (addUnique(output, selected, candidate)) {
      output.at(-1)._roles = candidate.roles;
      need -= 1;
    }
  }
}

function countCards(entries) { return entries.reduce((sum, entry) => sum + Number(entry.quantity || 0), 0); }

function colorPipsFromCards(entries, db, commander) {
  const pips = commanderPipDemand(commander);
  for (const entry of entries) {
    const def = db[entry.id];
    if (!def || isLand(def)) continue;
    const text = `${def.manaCost || ''}`;
    for (const match of text.matchAll(/\{([WUBRG])\}/g)) pips[match[1]] += Number(entry.quantity || 1);
  }
  return pips;
}

function distributeBasics(total, colors, pips) {
  if (total <= 0) return {};
  const active = colors.length ? colors : [];
  if (!active.length) return {};
  const weights = active.map(color => ({ color, weight: Math.max(1, pips[color] || 0) }));
  const weightTotal = weights.reduce((sum, item) => sum + item.weight, 0);
  const result = Object.fromEntries(active.map(color => [color, 0]));
  const fractions = [];
  let assigned = 0;
  for (const item of weights) {
    const exact = total * item.weight / weightTotal;
    const whole = Math.floor(exact);
    result[item.color] = whole;
    assigned += whole;
    fractions.push({ color: item.color, fraction: exact - whole });
  }
  fractions.sort((a, b) => b.fraction - a.fraction || COLOR_ORDER.indexOf(a.color) - COLOR_ORDER.indexOf(b.color));
  for (let i = 0; assigned < total; i += 1, assigned += 1) result[fractions[i % fractions.length].color] += 1;
  return result;
}

export function autoBuildCommanderDeck(db, commander, { strategyKey = null, existing = [] } = {}) {
  if (!commander) return [];
  const recommendations = recommendationList(db, commander, { strategyKey, role: 'All', limit: 1000 });
  const output = [];
  const selected = new Set();

  // Preserve user-selected legal cards first.
  for (const entry of existing) {
    const def = db[entry.id];
    if (!def || def.id === commander.id || !commanderLegal(def, commander)) continue;
    if (isBasicLand(def)) {
      output.push({ id: def.id, quantity: Math.max(1, Number(entry.quantity || 1)), _roles: ['Land'] });
    } else if (!selected.has(def.id)) {
      selected.add(def.id);
      output.push({ id: def.id, quantity: 1, _roles: classifyCardRoles(def) });
    }
  }

  const nonlandTargets = {
    Ramp: 10,
    'Card Draw': 10,
    Removal: 8,
    'Board Wipe': 3,
    Protection: 5,
    Tutor: 3,
  };

  for (const [role, target] of Object.entries(nonlandTargets)) fillRole(output, selected, recommendations, role, target);

  // Fill remaining nonland slots with the best synergy cards. Aim for 62 nonlands / 37 lands.
  const targetNonlands = 62;
  for (const candidate of recommendations) {
    const nonlands = output.filter(entry => !isLand(db[entry.id])).reduce((sum, entry) => sum + entry.quantity, 0);
    if (nonlands >= targetNonlands) break;
    if (isLand(candidate.def) || isBasicLand(candidate.def)) continue;
    if (addUnique(output, selected, candidate)) output.at(-1)._roles = candidate.roles;
  }

  // Add a modest package of the best nonbasic lands, then use basics to reach the mana-base target.
  const currentLands = output.filter(entry => isLand(db[entry.id])).reduce((sum, entry) => sum + entry.quantity, 0);
  const nonlandCount = output.filter(entry => !isLand(db[entry.id])).reduce((sum, entry) => sum + entry.quantity, 0);
  const landTarget = Math.max(0, 99 - nonlandCount);
  const nonbasicLandNeed = Math.max(0, Math.min(12, landTarget - currentLands));
  let nonbasicAdded = 0;
  for (const candidate of recommendations) {
    if (nonbasicAdded >= nonbasicLandNeed) break;
    if (!isLand(candidate.def) || isBasicLand(candidate.def)) continue;
    if (addUnique(output, selected, candidate)) {
      output.at(-1)._roles = ['Land'];
      nonbasicAdded += 1;
    }
  }

  // Trim accidental user-provided basic excess if necessary.
  while (countCards(output) > 99) {
    const basic = [...output].reverse().find(entry => isBasicLand(db[entry.id]) && entry.quantity > 0);
    if (!basic) break;
    basic.quantity -= 1;
    if (basic.quantity <= 0) output.splice(output.indexOf(basic), 1);
  }

  let remaining = 99 - countCards(output);
  if (remaining > 0) {
    const colors = (commander.colorIdentity || []).filter(color => BASIC_BY_COLOR[color] && db[BASIC_BY_COLOR[color]]);
    if (colors.length) {
      const pips = colorPipsFromCards(output, db, commander);
      const basics = distributeBasics(remaining, colors, pips);
      for (const color of COLOR_ORDER) {
        const quantity = basics[color] || 0;
        if (quantity > 0) output.push({ id: BASIC_BY_COLOR[color], quantity, _roles: ['Land'] });
      }
    } else {
      // Colorless commanders have no matching basic land in this database; use additional legal uniques instead.
      for (const candidate of recommendations) {
        if (countCards(output) >= 99) break;
        if (isBasicLand(candidate.def)) continue;
        if (addUnique(output, selected, candidate)) output.at(-1)._roles = candidate.roles;
      }
    }
  }

  // Remove private planning metadata from the public deck representation.
  return output.map(({ id, quantity }) => ({ id, quantity })).filter(entry => entry.quantity > 0);
}

export function deckRoleSummary(entries, db) {
  const summary = Object.fromEntries(rolePriority.map(role => [role, 0]));
  for (const entry of entries || []) {
    const def = db[entry.id];
    if (!def) continue;
    const qty = Number(entry.quantity || 0);
    const roles = classifyCardRoles(def);
    for (const role of roles) summary[role] = (summary[role] || 0) + qty;
  }
  return summary;
}

export function deckManaCurve(entries, db) {
  const curve = [0, 0, 0, 0, 0, 0, 0, 0];
  for (const entry of entries || []) {
    const def = db[entry.id];
    if (!def || isLand(def)) continue;
    const mv = Math.max(0, Math.floor(Number(def.manaValue || 0)));
    curve[Math.min(7, mv)] += Number(entry.quantity || 0);
  }
  return curve;
}

export function deckCardCount(entries) { return countCards(entries || []); }

export function recommendedStrategyKey(profile) {
  return profile?.strategies?.[0]?.key || null;
}

export const BUILDER_ROLES = ['Recommended', 'All', 'Ramp', 'Card Draw', 'Removal', 'Board Wipe', 'Protection', 'Tutor', 'Land', 'Synergy'];
export const BUILDER_COLOR_ORDER = COLOR_ORDER;
