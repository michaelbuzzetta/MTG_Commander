import { parseManaSymbols } from './ManaSymbol.js';
import { getObjectCardDefinition } from '../state/CardFace.js';

function resolveVariables(cost = '', variables = {}) {
  return String(cost || '').replace(/\{X\}/gi, () => `{${Math.max(0, Number(variables.X ?? variables.x ?? 0))}}`);
}

function adjustmentTotal(items = [], context = {}) {
  return items.reduce((sum, item) => {
    if (typeof item === 'number') return sum + item;
    if (!item) return sum;
    if (typeof item.compute === 'function') return sum + Number(item.compute(context) || 0);
    const amount = Number(item.generic ?? item.amount ?? 0);
    const times = Number(item.per ?? item.multiplier ?? 1);
    return sum + amount * times;
  }, 0);
}

function adjustGeneric(cost = '', adjustment = 0) {
  const symbols = parseManaSymbols(cost);
  let generic = 0;
  const rest = [];
  for (const symbol of symbols) {
    if (symbol.kind === 'generic') generic += symbol.amount;
    else if (symbol.kind === 'variable') rest.push(`{${symbol.raw}}`);
    else rest.push(`{${symbol.raw}}`);
  }
  generic = Math.max(0, generic + Number(adjustment || 0));
  return `${generic ? `{${generic}}` : ''}${rest.join('')}`;
}

export class CostEngine {
  constructor(engine, registry = null) { this.engine = engine; this.registry = registry; }

  determineSpellCost(playerId, card, {
    zone = card?.zone,
    mode = null,
    targets = [],
    castOption = null,
    variables = {},
    additionalCosts = [],
    costIncreases = [],
    costReductions = [],
    minimumGeneric = 0,
    castFaceIndex = null
  } = {}) {
    const engine = this.engine;
    const rootDefinition = engine.db[card.cardId] || {};
    const faceCard = Number.isInteger(castFaceIndex)
      ? { ...card, zone: 'stack', faceState: { ...(card.faceState || {}), castFaceIndex } }
      : card;
    const definition = Number.isInteger(castFaceIndex) ? getObjectCardDefinition(rootDefinition, faceCard, 'stack') : rootDefinition;
    const selectedMode = mode ? engine._modeFor(definition, mode) : null;
    const castingOption = (definition.castingOptions || []).find(option => option.castOption === castOption) || ((castOption === 'morph' || castOption === 'disguise') && definition.faceDownCasting?.castOption === castOption ? definition.faceDownCasting : null);
    const free = !!card.freeCast || castOption === 'hideaway' || castOption === 'withoutManaCost' || !!castingOption?.withoutManaCost;
    const baseOrAlternativeCost = free ? '' : (castOption === 'foretold' && definition.foretellCost
      ? definition.foretellCost
      : (castingOption?.manaCost ?? selectedMode?.manaCost ?? definition.manaCost ?? ''));
    // Additional mana costs (Kicker and future declarative mechanics) are paid
    // in addition to the spell's normal/alternative mana cost, never instead of it.
    const additionalManaCost = free ? '' : String(castingOption?.additionalManaCost || '');
    const alternativeCost = resolveVariables(`${baseOrAlternativeCost}${additionalManaCost}`, variables);
    const commanderTax = card.isCommander && zone === 'command' ? Number(engine.commanders ? engine.commanders.taxFor(playerId, card, { zone }) : (engine.state.players[playerId].commanderTax || 0)) : 0;
    const modeIncrease = Number(selectedMode?.extraGeneric || 0);
    const targetTax = Number(engine.static.targetingTax(playerId, targets) || 0);
    const staticReduction = Number(engine.static.spellGenericCostReduction(playerId, card, definition) || 0);
    const mechanicReduction = Number(engine.mechanics?.affinityReduction(playerId, definition) || 0);
    const increases = commanderTax + modeIncrease + targetTax + adjustmentTotal(costIncreases, { engine, playerId, card, definition, variables });
    const reductions = staticReduction + mechanicReduction + adjustmentTotal(costReductions, { engine, playerId, card, definition, variables });
    let finalManaCost = adjustGeneric(alternativeCost, increases - reductions);
    if (minimumGeneric > 0) {
      const currentGeneric = parseManaSymbols(finalManaCost).filter(s => s.kind === 'generic').reduce((sum, s) => sum + s.amount, 0);
      if (currentGeneric < minimumGeneric) finalManaCost = adjustGeneric(finalManaCost, minimumGeneric - currentGeneric);
    }
    return Object.freeze({
      kind: 'locked-cost',
      playerId,
      cardInstanceId: card.instanceId,
      cardId: card.cardId,
      zone,
      mode: selectedMode?.id || mode || null,
      castOption: castOption || null,
      castFaceIndex: Number.isInteger(castFaceIndex) ? castFaceIndex : null,
      baseManaCost: definition.manaCost || '',
      alternativeManaCost: alternativeCost,
      finalManaCost,
      variables: Object.freeze({ ...variables }),
      xValue: Number(variables.X ?? variables.x ?? 0),
      nonManaCosts: Object.freeze(additionalCosts.map(item => structuredClone(item))),
      stages: Object.freeze({ commanderTax, modeIncrease, targetTax, staticReduction, mechanicReduction, increases, reductions, minimumGeneric })
    });
  }

  determineAbilityCost(playerId, source, ability, { targets = [], selections = [], defaultTap = false } = {}) {
    const raw = ability.cost?.mana || ability.manaCost || '';
    const targetTax = Number(this.engine.static.targetingTax(playerId, targets) || 0);
    const nonManaCosts = [];
    const requiresTap = defaultTap ? ability.tap !== false : !!ability.tap;
    if (requiresTap) nonManaCosts.push({ type: 'tap', permanentId: source.instanceId });
    if (ability.cost?.life) nonManaCosts.push({ type: 'payLife', amount: Number(ability.cost.life) });
    if (ability.cost?.discard) {
      const ids = selections.slice(0, Number(ability.cost.discard));
      for (const id of ids) nonManaCosts.push({ type: 'discard', cardInstanceId: id });
    }
    if (ability.cost?.sacrifice) {
      const ids = selections.slice(0, Number(ability.cost.sacrifice));
      for (const id of ids) nonManaCosts.push({ type: 'sacrifice', permanentId: id });
    }
    if (ability.cost?.reveal) {
      const ids = selections.slice(0, Number(ability.cost.reveal));
      for (const id of ids) nonManaCosts.push({ type: 'reveal', cardInstanceId: id, fromZone: ability.cost.revealFrom || 'hand' });
    }
    if (ability.cost?.sacrificeSelf) nonManaCosts.push({ type: 'sacrifice', permanentId: source.instanceId });
    if (ability.cost?.discardSelf) nonManaCosts.push({ type: 'discard', cardInstanceId: source.instanceId });
    if (ability.cost?.removeCounterSelf) nonManaCosts.push({ type: 'removeCounter', permanentId: source.instanceId, ...ability.cost.removeCounterSelf });
    if (ability.selection?.tap !== false) for (const id of selections || []) nonManaCosts.push({ type: 'tap', permanentId: id });
    if (ability.cost?.removeCounterFromSelection) for (const id of selections || []) nonManaCosts.push({ type: 'removeCounter', permanentId: id, ...ability.cost.removeCounterFromSelection });
    if (ability.cost?.sacrificeSelection) for (const id of selections || []) nonManaCosts.push({ type: 'sacrifice', permanentId: id });
    if (ability.cost?.returnSelection) for (const id of selections || []) nonManaCosts.push({ type: 'return', permanentId: id });
    if (Array.isArray(ability.cost?.nonMana)) {
      for (const spec of ability.cost.nonMana) {
        if (!spec || !spec.type) continue;
        if (spec.fromSelection) {
          for (const id of selections || []) nonManaCosts.push({ ...structuredClone(spec), permanentId: id, fromSelection: undefined });
        } else nonManaCosts.push(structuredClone(spec));
      }
    }
    return Object.freeze({
      kind: 'locked-cost', playerId, sourceId: source.instanceId, finalManaCost: adjustGeneric(raw, targetTax), variables: Object.freeze({}),
      nonManaCosts: Object.freeze(nonManaCosts.map(item => structuredClone(item))), stages: Object.freeze({ targetTax })
    });
  }
}

export { adjustGeneric as adjustGenericManaCost };
