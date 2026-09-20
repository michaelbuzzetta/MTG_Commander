const COLORS = ['W','U','B','R','G','C'];

export function normalizeRestrictedManaUnit(unit = {}) {
  return {
    id: unit.id || null,
    color: COLORS.includes(unit.color) ? unit.color : 'C',
    amount: Math.max(1, Number(unit.amount || 1)),
    sourceId: unit.sourceId || null,
    restriction: unit.restriction || null,
    chosenType: unit.chosenType || null,
    snow: !!unit.snow,
    tags: [...(unit.tags || [])]
  };
}

export function ensureRestrictedMana(player) {
  player.restrictedMana ||= [];
  return player.restrictedMana;
}

export function manaUnitsFromPlayer(player) {
  const units = [];
  for (const color of COLORS) {
    for (let i = 0; i < Number(player.manaPool?.[color] || 0); i++) units.push({ color, restricted: false, snow: false, sourceId: null });
  }
  for (const raw of ensureRestrictedMana(player)) {
    const unit = normalizeRestrictedManaUnit(raw);
    for (let i = 0; i < unit.amount; i++) units.push({ ...unit, restricted: true, amount: 1 });
  }
  return units;
}

export function restrictionAllowsUnit(unit, context = {}, engine = null) {
  if (!unit?.restriction) return true;
  const restriction = unit.restriction;
  if (restriction === 'creatureSpell') return context.kind === 'cast' && !!context.card && engine?.isObjectType(context.card, 'Creature');
  if (restriction === 'chosenCreatureTypeSpell') {
    return context.kind === 'cast' && !!unit.chosenType && !!context.card && engine?.objectHasSubtype(context.card, unit.chosenType);
  }
  if (restriction === 'chosenCreatureTypeSpellOrAbility') {
    if (!unit.chosenType) return false;
    if (context.kind === 'cast') return !!context.card && engine?.objectHasSubtype(context.card, unit.chosenType);
    if (context.kind === 'ability') return !!context.source && engine?.objectHasSubtype(context.source, unit.chosenType);
    return false;
  }
  if (typeof restriction === 'function') return !!restriction(context, engine);
  return false;
}
