import { expandManaCostAlternatives, manaCostHasAdvancedSymbols } from './ManaSymbol.js';
import { manaUnitsFromPlayer, restrictionAllowsUnit } from './ManaPool.js';

const COLORS = ['W','U','B','R','G','C'];
const manaAmount = mana => Object.values(mana || {}).reduce((sum, n) => sum + Number(n || 0), 0);

function requirementTotal(req) {
  return COLORS.reduce((sum, c) => sum + Number(req.exact[c] || 0), 0) + Number(req.generic || 0) + Number(req.snow || 0);
}

function unitKey(units, caps) {
  const counts = Object.fromEntries(COLORS.map(c => [c, 0]));
  let snow = 0;
  for (const unit of units) {
    counts[unit.color] = Math.min(caps[unit.color], counts[unit.color] + 1);
    if (unit.snow) snow = Math.min(caps.snow, snow + 1);
  }
  return `${COLORS.map(c => counts[c]).join(',')}|${snow}`;
}

function paymentAssignment(units, req) {
  const used = new Set();
  const assignments = [];
  const requirements = [];
  // Snow is more restrictive than colored symbols because only a subset of
  // units can satisfy it, so assign snow first and backtrack if needed.
  for (let i = 0; i < req.snow; i++) requirements.push({ kind: 'snow' });
  for (const color of COLORS) for (let i = 0; i < req.exact[color]; i++) requirements.push({ kind: 'color', color });

  const search = index => {
    if (index >= requirements.length) {
      const left = units.filter((_, i) => !used.has(i));
      if (left.length < req.generic) return false;
      assignments.push(...left.slice(0, req.generic).map(unit => ({ requirement: { kind: 'generic' }, unit })));
      return true;
    }
    const r = requirements[index];
    for (let i = 0; i < units.length; i++) {
      if (used.has(i)) continue;
      const unit = units[i];
      if (r.kind === 'snow' ? !unit.snow : unit.color !== r.color) continue;
      used.add(i);
      assignments.push({ requirement: r, unit });
      if (search(index + 1)) return true;
      assignments.pop();
      used.delete(i);
    }
    return false;
  };

  return search(0) ? assignments : null;
}

function activationUnits(option, source) {
  const units = [];
  for (const [color, count] of Object.entries(option.mana || {})) {
    for (let i = 0; i < Number(count || 0); i++) units.push({
      color,
      snow: !!option.ability?.snow || !!option.ability?.snowMana,
      restricted: false,
      sourceId: source.permanent.instanceId,
      activation: true
    });
  }
  return units;
}

function comparePlans(a, b) {
  if (!b) return -1;
  if (a.lifePayment !== b.lifePayment) return a.lifePayment - b.lifePayment;
  if (a.activations.length !== b.activations.length) return a.activations.length - b.activations.length;
  if (a.flexibleActivations !== b.flexibleActivations) return a.flexibleActivations - b.flexibleActivations;
  if (a.totalProduced !== b.totalProduced) return a.totalProduced - b.totalProduced;
  return a.orderScore - b.orderScore;
}

export class PaymentPlanner {
  constructor(engine) { this.engine = engine; }

  plan(playerId, lockedCost, {
    context = {},
    reservedSourceIds = [],
    preferredSourceIds = null
  } = {}) {
    const player = this.engine.state.players[playerId];
    if (!player) return null;
    const cost = lockedCost?.finalManaCost ?? lockedCost?.cost ?? '';
    const variables = lockedCost?.variables || {};
    const alternatives = expandManaCostAlternatives(cost, { variables });
    const reserved = new Set(reservedSourceIds || []);
    const preferred = preferredSourceIds ? new Set(preferredSourceIds) : null;
    let best = null;

    for (const alternative of alternatives) {
      if (alternative.life > player.life) continue;
      const initialUnits = manaUnitsFromPlayer(player).filter(unit => restrictionAllowsUnit(unit, context, this.engine));
      const initialAssignment = paymentAssignment(initialUnits, alternative);
      if (initialAssignment) {
        const candidate = {
          lockedCost: structuredClone(lockedCost),
          alternative: structuredClone(alternative),
          activations: [],
          assignments: initialAssignment,
          lifePayment: alternative.life,
          flexibleActivations: 0,
          totalProduced: 0,
          orderScore: 0
        };
        if (!best || comparePlans(candidate, best) < 0) best = candidate;
        continue;
      }

      const sources = this.engine.mana.manaSources(player, this.engine.db, this.engine, context)
        .filter(source => !reserved.has(source.permanent.instanceId))
        .filter(source => !preferred || preferred.has(source.permanent.instanceId));
      const total = Math.max(1, requirementTotal(alternative));
      const caps = Object.fromEntries(COLORS.map(c => [c, Math.max(1, Number(alternative.exact[c] || 0) + Number(alternative.generic || 0) + Number(alternative.snow || 0))]));
      caps.snow = Math.max(1, Number(alternative.snow || 0));
      let states = new Map([[unitKey(initialUnits, caps), {
        units: initialUnits,
        activations: [],
        flexibleActivations: 0,
        totalProduced: 0,
        orderScore: 0
      }]]);

      for (const source of sources) {
        const next = new Map(states);
        for (const state of states.values()) {
          for (let optionIndex = 0; optionIndex < source.options.length; optionIndex++) {
            const option = source.options[optionIndex];
            const added = activationUnits(option, source);
            if (!added.length) continue;
            const candidate = {
              units: [...state.units, ...added].slice(0, initialUnits.length + total + 6),
              activations: [...state.activations, {
                permanentId: source.permanent.instanceId,
                ability: structuredClone(option.ability),
                manaColor: option.manaColor,
                mana: { ...option.mana },
                requiresTap: option.requiresTap !== false
              }],
              flexibleActivations: state.flexibleActivations + (option.flexible ? 1 : 0),
              totalProduced: state.totalProduced + manaAmount(option.mana),
              orderScore: state.orderScore + source.sourceIndex * 100 + optionIndex
            };
            const key = unitKey(candidate.units, caps);
            const current = next.get(key);
            if (!current || candidate.activations.length < current.activations.length || (candidate.activations.length === current.activations.length && candidate.orderScore < current.orderScore)) next.set(key, candidate);
          }
        }
        states = next;
      }

      for (const state of states.values()) {
        const assignment = paymentAssignment(state.units, alternative);
        if (!assignment) continue;
        const candidate = {
          lockedCost: structuredClone(lockedCost), alternative: structuredClone(alternative),
          activations: state.activations, assignments: assignment, lifePayment: alternative.life,
          flexibleActivations: state.flexibleActivations, totalProduced: state.totalProduced, orderScore: state.orderScore
        };
        if (!best || comparePlans(candidate, best) < 0) best = candidate;
      }
    }

    if (!best && !manaCostHasAdvancedSymbols(cost)) {
      // Preserve compatibility if a future ordinary mana source has metadata
      // the Step-7 unit planner does not understand yet.
      const legacy = this.engine.mana.solvePayment(player, this.engine.db, cost, 0, this.engine, context);
      if (legacy) return {
        lockedCost: structuredClone(lockedCost), alternative: null,
        activations: legacy.activations.map(x => ({ permanentId: x.permanentId, ability: structuredClone(x.ability), manaColor: x.manaColor, mana: { ...x.mana }, requiresTap: x.requiresTap !== false })),
        assignments: null, lifePayment: 0, legacy: true
      };
    }
    return best;
  }
}
