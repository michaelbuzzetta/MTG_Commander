import { parseManaCost, isType, hasKeyword, hasSubtype } from './utils.js';

const EXACT_COLORS = ['W', 'U', 'B', 'R', 'G', 'C'];
const COLORED_MANA = ['W', 'U', 'B', 'R', 'G'];
const GENERIC_SPEND_ORDER = ['C', 'W', 'U', 'B', 'R', 'G'];

const cloneRequirements = req => ({
  W: req.W || 0,
  U: req.U || 0,
  B: req.B || 0,
  R: req.R || 0,
  G: req.G || 0,
  C: req.C || 0,
  generic: req.generic || 0
});

const requirementsKey = req => [req.W, req.U, req.B, req.R, req.G, req.C, req.generic].join(',');
const isSatisfied = req => EXACT_COLORS.every(c => req[c] <= 0) && req.generic <= 0;
const manaAmount = mana => Object.values(mana || {}).reduce((sum, n) => sum + (Number(n) || 0), 0);

function applyManaToRequirements(requirements, mana) {
  const next = cloneRequirements(requirements);
  let surplus = 0;

  for (const c of EXACT_COLORS) {
    let available = Number(mana?.[c] || 0);
    if (available <= 0) continue;
    const exact = Math.min(available, next[c]);
    next[c] -= exact;
    available -= exact;
    surplus += available;
  }

  if (surplus > 0 && next.generic > 0) next.generic = Math.max(0, next.generic - surplus);
  return next;
}

function comparePlans(a, b) {
  if (!b) return -1;
  if (a.activations.length !== b.activations.length) return a.activations.length - b.activations.length;
  if (a.flexibleActivations !== b.flexibleActivations) return a.flexibleActivations - b.flexibleActivations;
  if (a.totalProduced !== b.totalProduced) return a.totalProduced - b.totalProduced;
  return a.orderScore - b.orderScore;
}

export class ManaEngine {
  static canPay(player, cost, tax = 0) {
    const r = parseManaCost(cost);
    r.generic += tax;
    const pool = { ...player.manaPool };

    for (const c of EXACT_COLORS) {
      if ((pool[c] || 0) < r[c]) return false;
      pool[c] -= r[c];
    }
    return Object.values(pool).reduce((a, b) => a + b, 0) >= r.generic;
  }

  static pay(player, cost, tax = 0) {
    if (!this.canPay(player, cost, tax)) return false;
    const r = parseManaCost(cost);
    r.generic += tax;

    for (const c of EXACT_COLORS) player.manaPool[c] -= r[c];
    for (const c of GENERIC_SPEND_ORDER) {
      const n = Math.min(player.manaPool[c] || 0, r.generic);
      player.manaPool[c] -= n;
      r.generic -= n;
    }
    return true;
  }

  static clear(player) {
    for (const c of Object.keys(player.manaPool)) player.manaPool[c] = 0;
  }

  static add(player, mana) {
    for (const [c, n] of Object.entries(mana || {})) {
      player.manaPool[c] = (player.manaPool[c] || 0) + n;
    }
  }

  static anyColorChoices(player, ability = {}) {
    const configured = Array.isArray(ability.colors) && ability.colors.length
      ? ability.colors
      : (player.colorIdentity || []);
    return [...new Set(configured.filter(c => COLORED_MANA.includes(c)))];
  }

  static canUseManaAbility(player, permanent, definition, ability, engine = null) {
    if (!permanent || !definition || ability?.type !== 'mana') return false;
    const requiresTap = ability.tap !== false;
    if (requiresTap && permanent.tapped) return false;
    const creature = engine ? engine.static.isType(permanent, 'Creature') : isType(definition, 'Creature');
    const keywords = engine ? engine.static.derivedStats(permanent).keywords : (definition.keywords || []);
    if (requiresTap && creature && permanent.summoningSick && !keywords.some(keyword => String(keyword).toLowerCase() === 'haste') && !hasKeyword(definition, 'Haste')) return false;
    if (ability.anyColor && this.anyColorChoices(player, ability).length === 0) return false;
    if (ability.condition?.controlLandsMin != null) {
      const lands = player.battlefield.filter(card => engine ? engine.static.isType(card, 'Land') : String(card?.zone || '') === 'battlefield').length;
      if (lands < Number(ability.condition.controlLandsMin)) return false;
    }
    return true;
  }

  static restrictionAllows(permanent, ability, db, engine, paymentContext = null) {
    const restriction = ability?.spendRestriction;
    if (!restriction) return true;
    if (!paymentContext || !engine) return false;
    const chosenType = permanent?.chosenType;
    if (!chosenType) return false;
    const matchesChosenType = object => {
      const definition = object?.cardId ? db[object.cardId] : object;
      return !!definition && hasSubtype(definition, chosenType);
    };
    const isCreatureObject = object => {
      const definition = object?.cardId ? db[object.cardId] : object;
      return !!definition && isType(definition, 'Creature');
    };
    if (restriction === 'chosenCreatureTypeSpell') {
      return paymentContext.kind === 'cast' && isCreatureObject(paymentContext.card) && matchesChosenType(paymentContext.card);
    }
    if (restriction === 'chosenCreatureTypeSpellOrAbility') {
      if (paymentContext.kind === 'cast') return isCreatureObject(paymentContext.card) && matchesChosenType(paymentContext.card);
      if (paymentContext.kind === 'ability') return isCreatureObject(paymentContext.source) && matchesChosenType(paymentContext.source);
      return false;
    }
    return false;
  }

  // Returns one source record per permanent, with all currently legal mana-production options.
  // Grouping by permanent guarantees the payment solver never taps the same permanent twice.
  static manaSources(player, db, engine = null, paymentContext = null) {
    const sources = [];
    for (let sourceIndex = 0; sourceIndex < player.battlefield.length; sourceIndex++) {
      const permanent = player.battlefield[sourceIndex];
      const definition = db[permanent.cardId];
      const options = [];

      const abilities = engine ? engine.static.effectiveAbilities(permanent) : (definition?.abilities || []);
      for (const ability of abilities) {
        if (!this.canUseManaAbility(player, permanent, definition, ability, engine)) continue;
        if (!this.restrictionAllows(permanent, ability, db, engine, paymentContext)) continue;
        // Auto-payment only executes tap/mana production directly. Mana abilities
        // with non-tap costs (such as sacrificing a Treasure) stay available as
        // normal explicit ACTIVATE_MANA actions so their costs and events run
        // through GameEngine instead of being silently bypassed by the solver.
        if (ability.cost?.sacrificeSelf || ability.cost?.mana || ability.manaCost) continue;
        const requiresTap = ability.tap !== false;
        if (ability.anyColor) {
          for (const manaColor of this.anyColorChoices(player, ability)) {
            options.push({
              ability,
              manaColor,
              mana: { [manaColor]: ability.amount || 1 },
              requiresTap,
              flexible: true
            });
          }
        } else if (manaAmount(ability.mana) > 0) {
          options.push({
            ability,
            manaColor: null,
            mana: { ...ability.mana },
            requiresTap,
            flexible: false
          });
        }
      }

      if (options.length) sources.push({ permanent, sourceIndex, options });
    }
    return sources;
  }

  // Backward-compatible flattened view for callers that want the legal production options.
  static manaAbilities(player, db, engine = null, paymentContext = null) {
    return this.manaSources(player, db, engine, paymentContext).flatMap(source => source.options.map(option => ({
      permanent: source.permanent,
      ability: option.ability,
      manaColor: option.manaColor,
      mana: option.mana,
      requiresTap: option.requiresTap
    })));
  }

  // Deterministic constrained payment solver. It consumes existing floating mana first,
  // then searches legal source choices while preferring fewer taps and fixed sources over
  // flexible any-color sources. The returned activation plan is used by both canAfford
  // and autoTapAndPay so those paths cannot disagree.
  static solvePayment(player, db, cost, tax = 0, engine = null, paymentContext = null) {
    const required = parseManaCost(cost);
    required.generic += tax;

    const initial = applyManaToRequirements(required, player.manaPool);
    if (isSatisfied(initial)) return { activations: [], remaining: initial };

    const sources = this.manaSources(player, db, engine, paymentContext);
    let states = new Map();
    states.set(requirementsKey(initial), {
      remaining: initial,
      activations: [],
      flexibleActivations: 0,
      totalProduced: 0,
      orderScore: 0
    });

    for (const source of sources) {
      const nextStates = new Map(states); // Skipping this source is always allowed.

      for (const plan of states.values()) {
        for (let optionIndex = 0; optionIndex < source.options.length; optionIndex++) {
          const option = source.options[optionIndex];
          const remaining = applyManaToRequirements(plan.remaining, option.mana);
          if (requirementsKey(remaining) === requirementsKey(plan.remaining)) continue; // No useful contribution.

          const candidate = {
            remaining,
            activations: [...plan.activations, {
              permanent: source.permanent,
              permanentId: source.permanent.instanceId,
              ability: option.ability,
              manaColor: option.manaColor,
              mana: { ...option.mana },
              requiresTap: option.requiresTap
            }],
            flexibleActivations: plan.flexibleActivations + (option.flexible ? 1 : 0),
            totalProduced: plan.totalProduced + manaAmount(option.mana),
            orderScore: plan.orderScore + source.sourceIndex * 100 + optionIndex
          };

          const key = requirementsKey(remaining);
          const current = nextStates.get(key);
          if (!current || comparePlans(candidate, current) < 0) nextStates.set(key, candidate);
        }
      }

      states = nextStates;
    }

    const solved = states.get('0,0,0,0,0,0,0');
    return solved ? { activations: solved.activations, remaining: solved.remaining } : null;
  }

  static canAfford(player, db, cost, tax = 0, engine = null, paymentContext = null) {
    return this.solvePayment(player, db, cost, tax, engine, paymentContext) !== null;
  }

  static autoTapAndPay(player, db, cost, tax = 0, engine = null, paymentContext = null) {
    const plan = this.solvePayment(player, db, cost, tax, engine, paymentContext);
    if (!plan) return false;

    const poolBefore = { ...player.manaPool };
    const tappedBefore = new Map(plan.activations.map(x => [x.permanentId, x.permanent.tapped]));

    try {
      for (const activation of plan.activations) {
        if (activation.requiresTap) {
          if (engine?.tapPermanent) engine.tapPermanent(activation.permanent);
          else activation.permanent.tapped = true;
        }
        this.add(player, activation.mana);
      }
      if (!this.pay(player, cost, tax)) throw new Error('Payment plan became invalid during execution');
      if (engine) engine._lastPaymentPlan = plan.activations.map(x => x.permanentId);
      return true;
    } catch {
      player.manaPool = poolBefore;
      for (const activation of plan.activations) activation.permanent.tapped = tappedBefore.get(activation.permanentId);
      return false;
    }
  }
}
