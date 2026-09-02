export class CombatEngine {
  #internalToken;
  constructor(engine, internalToken) { this.engine = engine; this.#internalToken = internalToken; }
  #assertInternal(token) { if (token !== this.#internalToken) throw new Error('Combat mutation is internal; use GameEngine.perform()'); }

  #keywords(permanent) {
    return this.engine.static.derivedStats(permanent).keywords.map(x => x.toLowerCase());
  }

  #isCreature(permanent) {
    return !!permanent && this.engine.static.isType(permanent, 'Creature');
  }

  legalAttackers(pid) {
    return this.engine.state.players[pid].battlefield.filter(p => {
      const k = this.#keywords(p);
      return this.#isCreature(p) && !p.tapped && (!p.summoningSick || k.includes('haste'));
    });
  }

  legalDefenders(pid) {
    return this.engine.opponents(pid);
  }

  normalizeAttackTargets(pid, ids, attackTargets = {}) {
    const defenders = this.legalDefenders(pid);
    if (!defenders.length && ids.length) throw new Error('There is no legal defending player');
    const fallback = defenders[0] || null;
    const normalized = {};
    for (const id of ids) {
      const target = attackTargets?.[id] || fallback;
      if (!target || !defenders.includes(target)) throw new Error('Each attacker must attack a living opponent');
      normalized[id] = target;
    }
    return normalized;
  }

  declareAttackers(pid, ids, attackTargets, token) {
    // Backward compatibility: old callers pass (pid, ids, token).
    if (token === undefined && attackTargets === this.#internalToken) { token = attackTargets; attackTargets = {}; }
    this.#assertInternal(token);
    if (!Array.isArray(ids) || new Set(ids).size !== ids.length) throw new Error('Duplicate attacker');
    const legalAttackers = this.legalAttackers(pid);
    const legal = new Set(legalAttackers.map(x => x.instanceId));
    if (ids.some(x => !legal.has(x))) throw new Error('Illegal attacker');
    const targets = this.normalizeAttackTargets(pid, ids, attackTargets || {});

    for (const permanent of legalAttackers) {
      if (!permanent.mustAttackPlayer) continue;
      if (!this.engine.state.players[permanent.mustAttackPlayer] || this.engine.state.players[permanent.mustAttackPlayer].lost) {
        permanent.mustAttackPlayer = null;
        continue;
      }
      if (!ids.includes(permanent.instanceId)) throw new Error('A creature that must attack this opponent this turn must attack if able');
      if (targets[permanent.instanceId] !== permanent.mustAttackPlayer) throw new Error('A creature that must attack a specific opponent must attack that opponent');
    }

    for (const player of Object.values(this.engine.state.players)) {
      for (const permanent of player.battlefield) {
        permanent.attacking = false;
        permanent.attackTarget = null;
      }
    }

    const combat = this.engine.state.combat;
    combat.attackers = [];
    combat.attackTargets = {};
    combat.blockers = {};
    combat.blocked = {};
    combat.damageAssignments = {};
    combat.defendingPlayers = [];
    combat.blockerQueue = [];
    combat.currentDefender = null;

    for (const id of ids) {
      const p = this.engine.findPermanent(id);
      p.attacking = true;
      p.attackTarget = targets[id];
      if (p.mustAttackPlayer) p.mustAttackPlayer = null;
      const ks = this.#keywords(p);
      if (!ks.includes('vigilance')) this.engine.tapPermanent(p);
      combat.attackers.push(id);
      combat.attackTargets[id] = targets[id];
      this.engine.emit('CREATURE_ATTACKED', { controller: pid, target: p, object: p, defendingPlayer: targets[id] });
    }

    combat.defendingPlayers = this.engine.playerIds().filter(id => Object.values(targets).includes(id) && !this.engine.state.players[id].lost);
    this.engine.emit('DECLARE_ATTACKERS', { controller: pid, attackers: [...ids], attackTargets: structuredClone(targets) });
    return ids;
  }

  canBlock(blocker, attacker) {
    if (!this.#isCreature(blocker) || !this.#isCreature(attacker) || blocker.tapped) return false;
    const defender = this.engine.state.combat.attackTargets?.[attacker.instanceId] || attacker.attackTarget || this.engine.opponent(attacker.controller);
    if (defender && blocker.controller !== defender) return false;
    const bk = this.#keywords(blocker);
    const ak = this.#keywords(attacker);
    if (ak.includes('unblockable') || ak.includes("can't be blocked")) return false;
    if (ak.includes('islandwalk')) {
      const defendingPlayer = this.engine.state.players[blocker.controller];
      if (defendingPlayer?.battlefield.some(card => !card.phasedOut && this.engine.static.isType(card, 'Land') && this.engine.static.hasSubtype(card, 'Island'))) return false;
    }
    if (ak.includes('flying') && !bk.includes('flying') && !bk.includes('reach')) return false;
    return true;
  }

  attackersForDefender(pid) {
    return this.engine.state.combat.attackers.filter(aid => {
      const attacker = this.engine.findPermanent(aid);
      return attacker && (this.engine.state.combat.attackTargets?.[aid] || attacker.attackTarget || this.engine.opponent(attacker.controller)) === pid;
    });
  }

  validateBlockers(pid, map) {
    const player = this.engine.state.players[pid];
    if (!player || player.lost || map == null || typeof map !== 'object' || Array.isArray(map)) throw new Error('Invalid blocker map');

    const attackers = new Set(this.attackersForDefender(pid));
    const used = new Set();
    for (const [aid, bids0] of Object.entries(map)) {
      if (!attackers.has(aid)) throw new Error('Blocking nonattacker or attacker aimed at another player');
      const attacker = this.engine.findPermanent(aid);
      if (!attacker?.attacking || !this.#isCreature(attacker)) throw new Error('Blocking nonattacker');
      const bids = Array.isArray(bids0) ? bids0 : [bids0];
      if (new Set(bids).size !== bids.length) throw new Error('Duplicate blocker assignment');

      const blockers = bids.map(id => player.battlefield.find(x => x.instanceId === id));
      if (blockers.some(x => !x || used.has(x.instanceId) || !this.canBlock(x, attacker))) throw new Error('Illegal blocker');

      const menace = this.#keywords(attacker).includes('menace');
      if (menace && blockers.length === 1) throw new Error('Menace requires two blockers');
      for (const blocker of blockers) used.add(blocker.instanceId);
    }
    return true;
  }

  declareBlockers(pid, map, token) {
    this.#assertInternal(token);
    this.validateBlockers(pid, map);

    for (const p of this.engine.state.players[pid].battlefield) p.blocking = null;

    const combat = this.engine.state.combat;
    const defenderAttackers = this.attackersForDefender(pid);
    for (const aid of defenderAttackers) {
      const raw = map?.[aid];
      const bids = raw == null ? [] : (Array.isArray(raw) ? [...raw] : [raw]);
      combat.blockers[aid] = bids;
      combat.blocked[aid] = bids.length > 0;
      if (bids.length <= 1) combat.damageAssignments[aid] = [...bids];
      for (const id of bids) this.engine.findPermanent(id).blocking = aid;
    }

    this.engine.emit('DECLARE_BLOCKERS', { controller: pid, blockers: structuredClone(map || {}), defendingPlayer: pid });
    return structuredClone(map || {});
  }

  requiredDamageAssignmentOrders() {
    const result = {};
    for (const aid of this.engine.state.combat.attackers) {
      const bids = this.engine.state.combat.blockers?.[aid] || [];
      if (bids.length > 1) result[aid] = [...bids];
    }
    return result;
  }

  validateDamageAssignmentOrder(pid, orders) {
    if (pid !== this.engine.state.activePlayer) throw new Error('Only the attacking player chooses blocker damage order');
    const required = this.requiredDamageAssignmentOrders();
    const requiredIds = Object.keys(required);
    if (!orders || typeof orders !== 'object' || Array.isArray(orders)) throw new Error('Damage assignment orders are required');
    if (Object.keys(orders).length !== requiredIds.length || Object.keys(orders).some(aid => !required[aid])) {
      throw new Error('Choose a damage assignment order for every multiply-blocked attacker');
    }
    for (const aid of requiredIds) {
      const order = orders[aid];
      const declared = required[aid];
      if (!Array.isArray(order) || order.length !== declared.length || new Set(order).size !== order.length) {
        throw new Error('Invalid blocker damage assignment order');
      }
      const declaredSet = new Set(declared);
      if (order.some(id => !declaredSet.has(id))) throw new Error('Damage assignment order must contain exactly the declared blockers');
    }
    return true;
  }

  setDamageAssignmentOrder(pid, orders, token) {
    this.#assertInternal(token);
    this.validateDamageAssignmentOrder(pid, orders);
    for (const [aid, order] of Object.entries(orders)) this.engine.state.combat.damageAssignments[aid] = [...order];
    return structuredClone(this.engine.state.combat.damageAssignments);
  }

  needsFirstStrikeStep() {
    const ids = [
      ...this.engine.state.combat.attackers,
      ...Object.values(this.engine.state.combat.blockers || {}).flatMap(x => Array.isArray(x) ? x : [x])
    ];
    return ids.some(id => {
      const p = this.engine.findPermanent(id);
      if (!p) return false;
      const k = this.#keywords(p);
      return k.includes('first strike') || k.includes('double strike');
    });
  }

  #participatesInDamageStep(permanent, firstStrike) {
    const keywords = this.#keywords(permanent);
    return firstStrike
      ? keywords.includes('first strike') || keywords.includes('double strike')
      : !keywords.includes('first strike') || keywords.includes('double strike');
  }

  #assignAttackerDamage(attacker, defenderId, firstStrike, damageEvents) {
    if (!this.#participatesInDamageStep(attacker, firstStrike)) return;
    if (!defenderId || this.engine.state.players[defenderId]?.lost) return;

    const stats = this.engine.static.derivedStats(attacker);
    let remaining = Math.max(0, stats.power);
    if (remaining <= 0) return;

    const keywords = stats.keywords.map(x => x.toLowerCase());
    const combat = this.engine.state.combat;
    const aid = attacker.instanceId;
    const wasBlocked = !!combat.blocked?.[aid];
    const declaredOrder = combat.damageAssignments?.[aid] || combat.blockers?.[aid] || [];
    const liveBlockers = declaredOrder.map(id => this.engine.findPermanent(id)).filter(Boolean);

    if (!wasBlocked) {
      damageEvents.push(this.engine.dealDamageToPlayer(defenderId, remaining, attacker, { combat: true }));
      return;
    }

    if (!liveBlockers.length) {
      if (keywords.includes('trample')) damageEvents.push(this.engine.dealDamageToPlayer(defenderId, remaining, attacker, { combat: true }));
      return;
    }

    for (let index = 0; index < liveBlockers.length && remaining > 0; index++) {
      const blocker = liveBlockers[index];
      const blockerStats = this.engine.static.derivedStats(blocker);
      const lethal = keywords.includes('deathtouch') ? 1 : Math.max(0, blockerStats.toughness - blocker.damageMarked);
      const isLast = index === liveBlockers.length - 1;
      const amount = isLast && !keywords.includes('trample') ? remaining : Math.min(remaining, lethal);
      if (amount > 0) damageEvents.push(this.engine.dealDamageToPermanent(blocker, amount, attacker, { combat: true }));
      remaining -= amount;
    }

    if (remaining > 0 && keywords.includes('trample')) damageEvents.push(this.engine.dealDamageToPlayer(defenderId, remaining, attacker, { combat: true }));
  }

  #assignBlockerDamage(attacker, blocker, firstStrike, damageEvents) {
    if (!this.#participatesInDamageStep(blocker, firstStrike)) return;
    const power = Math.max(0, this.engine.static.derivedStats(blocker).power);
    if (power > 0) damageEvents.push(this.engine.dealDamageToPermanent(attacker, power, blocker, { combat: true }));
  }

  damageStep(firstStrike = false, token) {
    this.#assertInternal(token);
    return this.engine._withDeferredTriggers(() => {
      const state = this.engine.state;
      const attackerPlayer = state.activePlayer;
      const damageEvents = [];

      for (const aid of state.combat.attackers) {
        const attacker = this.engine.findPermanent(aid);
        if (!attacker) continue;
        const defenderPlayer = state.combat.attackTargets?.[aid] || attacker.attackTarget || this.engine.opponent(attackerPlayer);
        const declared = state.combat.damageAssignments?.[aid] || state.combat.blockers?.[aid] || [];
        const liveBlockers = declared.map(id => this.engine.findPermanent(id)).filter(Boolean);
        this.#assignAttackerDamage(attacker, defenderPlayer, firstStrike, damageEvents);
        for (const blocker of liveBlockers) this.#assignBlockerDamage(attacker, blocker, firstStrike, damageEvents);
      }

      this.engine.emit('COMBAT_DAMAGE', {
        controller: attackerPlayer,
        firstStrike,
        combat: true,
        damageEvents: damageEvents.filter(Boolean)
      });
      this.engine.stateBasedActions();
    });
  }

  cleanup(token) {
    this.#assertInternal(token);
    for (const p of Object.values(this.engine.state.players)) {
      for (const c of p.battlefield) {
        c.attacking = false;
        c.attackTarget = null;
        c.blocking = null;
      }
    }
    this.engine.state.combat = { attackers: [], attackTargets: {}, blockers: {}, blocked: {}, damageAssignments: {}, defendingPlayers: [], blockerQueue: [], currentDefender: null };
  }
}
