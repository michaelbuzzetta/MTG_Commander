export class CombatEngine {
  #internalToken;
  constructor(engine, internalToken) { this.engine = engine; this.#internalToken = internalToken; }
  #assertInternal(token) { if (token !== this.#internalToken) throw new Error('Combat mutation is internal; use GameEngine.perform()'); }

  #keywords(permanent) { return this.engine.static.derivedStats(permanent).keywords.map(x => String(x).toLowerCase()); }
  #isCreature(permanent) { return !!permanent && this.engine.static.isType(permanent, 'Creature'); }
  #chars(permanent) { return this.engine.continuous.characteristics(permanent); }
  #definition(permanent) { return this.engine.static.definitionFor(permanent) || {}; }

  #combatFlag(permanent, name, fallback = null) {
    if (permanent?.[name] != null) return permanent[name];
    const def = this.#definition(permanent);
    if (def?.[name] != null) return def[name];
    if (def?.combat?.[name] != null) return def.combat[name];
    return fallback;
  }

  legalAttackers(pid) {
    return (this.engine.state.players[pid]?.battlefield || []).filter(permanent => {
      const keywords = this.#keywords(permanent);
      if (!this.#isCreature(permanent) || permanent.tapped || permanent.phasedOut) return false;
      if (permanent.summoningSick && !this.engine.mechanics.canIgnoreSummoningSickness(permanent)) return false;
      if (keywords.includes('defender') && !this.#combatFlag(permanent, 'canAttackWithDefender', false)) return false;
      if (this.#combatFlag(permanent, 'cantAttack', false)) return false;
      return true;
    });
  }

  legalDefendingEntities(pid) {
    const entities = [];
    for (const opponentId of this.engine.opponents(pid)) {
      const opponent = this.engine.state.players[opponentId];
      if (!opponent || opponent.lost) continue;
      entities.push({ id: opponentId, type: 'player', defendingPlayer: opponentId, controller: opponentId });
      for (const permanent of opponent.battlefield || []) {
        if (permanent.phasedOut) continue;
        if (this.engine.static.isType(permanent, 'Planeswalker')) entities.push({ id: permanent.instanceId, type: 'planeswalker', defendingPlayer: opponentId, controller: opponentId });
        if (this.engine.static.isType(permanent, 'Battle')) {
          const defender = permanent.defendingPlayer || permanent.protector || permanent.controller;
          if (defender && this.engine.state.players[defender] && !this.engine.state.players[defender].lost) entities.push({ id: permanent.instanceId, type: 'battle', defendingPlayer: defender, controller: permanent.controller });
        }
      }
    }
    return entities;
  }

  legalDefenders(pid) { return this.legalDefendingEntities(pid).map(entity => entity.id); }

  defendingEntity(targetId, attackerPid = this.engine.state.activePlayer) {
    return this.legalDefendingEntities(attackerPid).find(entity => entity.id === targetId) || null;
  }

  #legalTargetsForAttacker(pid, permanent) {
    const cantPlayers = new Set([...(this.#combatFlag(permanent, 'cantAttackPlayers', []) || [])]);
    return this.legalDefendingEntities(pid).filter(entity => {
      if (cantPlayers.has(entity.defendingPlayer) || cantPlayers.has(entity.id)) return false;
      const only = this.#combatFlag(permanent, 'canOnlyAttackPlayer', null);
      if (only && entity.defendingPlayer !== only && entity.id !== only) return false;
      return true;
    });
  }

  #attackRequirementScore(permanent, entity) {
    let score = 0;
    const mustPlayer = this.#combatFlag(permanent, 'mustAttackPlayer', null);
    const mustTarget = this.#combatFlag(permanent, 'mustAttackTarget', null);
    if (mustPlayer && entity.defendingPlayer === mustPlayer) score++;
    if (mustTarget && entity.id === mustTarget) score++;
    const goaders = this.#combatFlag(permanent, 'goadedBy', []) || [];
    const list = Array.isArray(goaders) ? goaders : [goaders];
    for (const goader of list.filter(Boolean)) if (entity.defendingPlayer !== goader) score++;
    return score;
  }

  #mustAttack(permanent) {
    const goaded = this.#combatFlag(permanent, 'goadedBy', []);
    return !!this.#combatFlag(permanent, 'mustAttack', false)
      || !!this.#combatFlag(permanent, 'mustAttackPlayer', null)
      || !!this.#combatFlag(permanent, 'mustAttackTarget', null)
      || (Array.isArray(goaded) ? goaded.length > 0 : !!goaded);
  }

  normalizeAttackTargets(pid, ids, attackTargets = {}) {
    const all = this.legalDefendingEntities(pid);
    if (!all.length && ids.length) throw new Error('There is no legal defending entity');
    const normalized = {};
    for (const id of ids) {
      const permanent = this.engine.findPermanent(id);
      const options = this.#legalTargetsForAttacker(pid, permanent);
      const fallback = options[0]?.id || null;
      const target = attackTargets?.[id] || fallback;
      const chosen = options.find(entity => entity.id === target);
      if (!chosen) throw new Error('Each attacker must attack a legal defending player, planeswalker, or battle');
      normalized[id] = chosen.id;
    }
    return normalized;
  }

  validateAttackers(pid, ids, attackTargets = {}, attackPayments = {}) {
    if (!Array.isArray(ids) || new Set(ids).size !== ids.length) throw new Error('Duplicate attacker');
    const legalAttackers = this.legalAttackers(pid);
    const legal = new Set(legalAttackers.map(x => x.instanceId));
    if (ids.some(x => !legal.has(x))) throw new Error('Illegal attacker');
    const targets = this.normalizeAttackTargets(pid, ids, attackTargets || {});

    for (const permanent of legalAttackers) {
      const options = this.#legalTargetsForAttacker(pid, permanent);
      const selected = ids.includes(permanent.instanceId);
      const cantAlone = !!this.#combatFlag(permanent, 'cantAttackAlone', false);
      if (selected && cantAlone && ids.length < 2) throw new Error('A creature that cannot attack alone needs another attacker');

      if (this.#mustAttack(permanent) && options.length) {
        const requirementCanBeMet = !cantAlone || legalAttackers.some(other => other.instanceId !== permanent.instanceId);
        if (requirementCanBeMet && !selected) throw new Error('A creature that must attack must attack if able');
        if (selected) {
          const scores = options.map(entity => this.#attackRequirementScore(permanent, entity));
          const best = Math.max(0, ...scores);
          const chosen = options.find(entity => entity.id === targets[permanent.instanceId]);
          if (chosen && this.#attackRequirementScore(permanent, chosen) < best) throw new Error('Attack declaration does not satisfy the maximum number of attack requirements');
        }
      }

      if (selected) {
        const tax = Number(this.#combatFlag(permanent, 'attackTax', 0) || 0);
        if (tax > 0 && attackPayments?.[permanent.instanceId] !== true) throw new Error(`Attacking with ${permanent.instanceId} requires paying its attack cost`);
      }
    }
    return targets;
  }

  declareAttackers(pid, ids, attackTargets, attackPayments, token) {
    // Backward compatibility: old callers pass (pid, ids, token) or (pid, ids, targets, token).
    if (token === undefined && attackPayments === this.#internalToken) { token = attackPayments; attackPayments = {}; }
    if (token === undefined && attackTargets === this.#internalToken) { token = attackTargets; attackTargets = {}; attackPayments = {}; }
    this.#assertInternal(token);
    const targets = this.validateAttackers(pid, ids, attackTargets || {}, attackPayments || {});

    for (const player of Object.values(this.engine.state.players)) for (const permanent of player.battlefield) { permanent.attacking = false; permanent.attackTarget = null; }

    const combat = this.engine.state.combat;
    combat.attackers = []; combat.attackTargets = {}; combat.attackDefendingPlayers = {}; combat.defendingEntities = {};
    combat.blockers = {}; combat.blocked = {}; combat.damageAssignments = {}; combat.defendingPlayers = []; combat.blockerQueue = []; combat.currentDefender = null;

    for (const id of ids) {
      const permanent = this.engine.findPermanent(id);
      const entity = this.defendingEntity(targets[id], pid);
      permanent.attacking = true; permanent.attackTarget = targets[id];
      if (permanent.mustAttackPlayer) permanent.mustAttackPlayer = null;
      if (this.engine.mechanics.tapsWhenAttacking(permanent)) this.engine.tapPermanent(permanent);
      combat.attackers.push(id); combat.attackTargets[id] = targets[id]; combat.attackDefendingPlayers[id] = entity?.defendingPlayer || targets[id];
      if (entity) combat.defendingEntities[entity.id] = structuredClone(entity);
      this.engine.emit('CREATURE_ATTACKED', { controller: pid, target: permanent, object: permanent, defendingPlayer: entity?.defendingPlayer || targets[id], defendingEntity: targets[id] });
    }

    combat.defendingPlayers = this.engine.playerIds().filter(id => Object.values(combat.attackDefendingPlayers).includes(id) && !this.engine.state.players[id].lost);
    this.engine.emit('DECLARE_ATTACKERS', { controller: pid, attackers: [...ids], attackTargets: structuredClone(targets), defendingPlayers: [...combat.defendingPlayers] });
    return ids;
  }

  #defendingPlayerFor(attacker) {
    return this.engine.state.combat.attackDefendingPlayers?.[attacker.instanceId]
      || this.defendingEntity(this.engine.state.combat.attackTargets?.[attacker.instanceId] || attacker.attackTarget, attacker.controller)?.defendingPlayer
      || this.engine.opponent(attacker.controller);
  }

  canBlock(blocker, attacker) {
    if (!this.#isCreature(blocker) || !this.#isCreature(attacker) || blocker.tapped || blocker.phasedOut) return false;
    const defender = this.#defendingPlayerFor(attacker);
    if (defender && blocker.controller !== defender) return false;
    const ak = this.#keywords(attacker);
    const defendingPlayer = this.engine.state.players[blocker.controller];
    const landwalkTypes = [['plainswalk','Plains'], ['islandwalk','Island'], ['swampwalk','Swamp'], ['mountainwalk','Mountain'], ['forestwalk','Forest']];
    for (const [keyword, subtype] of landwalkTypes) {
      if (!ak.includes(keyword)) continue;
      if (defendingPlayer?.battlefield.some(card => !card.phasedOut && this.engine.static.isType(card, 'Land') && this.engine.static.hasSubtype(card, subtype))) return false;
    }
    if (!this.engine.mechanics.keywordBlockLegality(blocker, attacker).ok) return false;
    if (this.#combatFlag(attacker, 'cantBeBlocked', false)) return false;
    const cantBy = this.#combatFlag(attacker, 'cantBeBlockedBy', []) || [];
    if (Array.isArray(cantBy) && cantBy.includes(blocker.cardId)) return false;
    return true;
  }

  legalBlockers(pid, attackerId) {
    const attacker = this.engine.findPermanent(attackerId);
    if (!attacker) return [];
    return (this.engine.state.players[pid]?.battlefield || []).filter(blocker => this.canBlock(blocker, attacker));
  }

  attackersForDefender(pid) {
    return this.engine.state.combat.attackers.filter(aid => {
      const attacker = this.engine.findPermanent(aid);
      return attacker && this.#defendingPlayerFor(attacker) === pid;
    });
  }

  #blockCapacity(blocker) {
    const extra = Number(this.#combatFlag(blocker, 'canBlockAdditional', 0) || 0);
    return Math.max(1, 1 + extra);
  }

  #mustBlockTarget(blocker) { return this.#combatFlag(blocker, 'mustBlockAttacker', null); }

  validateBlockers(pid, map) {
    const player = this.engine.state.players[pid];
    if (!player || player.lost || map == null || typeof map !== 'object' || Array.isArray(map)) throw new Error('Invalid blocker map');
    const attackers = new Set(this.attackersForDefender(pid));
    const usage = new Map();

    for (const [aid, bids0] of Object.entries(map)) {
      if (!attackers.has(aid)) throw new Error('Blocking nonattacker or attacker aimed at another defending player');
      const attacker = this.engine.findPermanent(aid);
      if (!attacker?.attacking || !this.#isCreature(attacker)) throw new Error('Blocking nonattacker');
      const bids = Array.isArray(bids0) ? bids0 : [bids0];
      if (new Set(bids).size !== bids.length) throw new Error('Duplicate blocker assignment');
      const blockers = bids.map(id => player.battlefield.find(x => x.instanceId === id));
      if (blockers.some(x => !x || !this.canBlock(x, attacker))) throw new Error('Illegal blocker');
      for (const blocker of blockers) {
        const next = Number(usage.get(blocker.instanceId) || 0) + 1;
        if (next > this.#blockCapacity(blocker)) throw new Error('A blocker cannot block more attackers than its block capacity allows');
        usage.set(blocker.instanceId, next);
      }
      const requiredBlockers = this.engine.mechanics.requiredBlockerCount(attacker);
      if (blockers.length > 0 && blockers.length < requiredBlockers) throw new Error(`${this.engine.db[attacker.cardId]?.name || 'Attacker'} requires at least ${requiredBlockers} blockers`);
      if (this.#combatFlag(attacker, 'cantBeBlockedByMoreThanOne', false) && blockers.length > 1) throw new Error('Attacker cannot be blocked by more than one creature');
    }

    // Blocking requirements are checked after all assignments, maximizing legal
    // requirements by requiring each able must-block creature and each attacker
    // that must be blocked if able.
    for (const blocker of player.battlefield || []) {
      if (!this.#isCreature(blocker) || blocker.tapped || blocker.phasedOut) continue;
      const targetId = this.#mustBlockTarget(blocker);
      const mustBlock = !!this.#combatFlag(blocker, 'mustBlock', false) || !!targetId;
      if (!mustBlock) continue;
      const legalTargets = [...attackers].filter(aid => this.canBlock(blocker, this.engine.findPermanent(aid)) && (!targetId || aid === targetId));
      if (!legalTargets.length) continue;
      const assigned = [...usage.keys()].includes(blocker.instanceId) && Object.entries(map).some(([aid, bids]) => (Array.isArray(bids) ? bids : [bids]).includes(blocker.instanceId) && (!targetId || aid === targetId));
      if (!assigned) throw new Error('A creature that must block must block if able');
    }
    for (const aid of attackers) {
      const attacker = this.engine.findPermanent(aid);
      if (!this.#combatFlag(attacker, 'mustBeBlockedIfAble', false)) continue;
      const anyAble = (player.battlefield || []).some(blocker => this.canBlock(blocker, attacker));
      const bids = map?.[aid] == null ? [] : (Array.isArray(map[aid]) ? map[aid] : [map[aid]]);
      if (anyAble && bids.length === 0) throw new Error('Attacker must be blocked if able');
    }
    return true;
  }

  declareBlockers(pid, map, token) {
    this.#assertInternal(token); this.validateBlockers(pid, map);
    for (const permanent of this.engine.state.players[pid].battlefield) permanent.blocking = null;
    const combat = this.engine.state.combat;
    for (const aid of this.attackersForDefender(pid)) {
      const raw = map?.[aid]; const bids = raw == null ? [] : (Array.isArray(raw) ? [...raw] : [raw]);
      combat.blockers[aid] = bids; combat.blocked[aid] = bids.length > 0;
      if (bids.length <= 1) combat.damageAssignments[aid] = [...bids];
      for (const id of bids) {
        const blocker = this.engine.findPermanent(id);
        if (blocker) blocker.blocking = blocker.blocking == null ? aid : (Array.isArray(blocker.blocking) ? [...blocker.blocking, aid] : [blocker.blocking, aid]);
      }
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
    const required = this.requiredDamageAssignmentOrders(), requiredIds = Object.keys(required);
    if (!orders || typeof orders !== 'object' || Array.isArray(orders)) throw new Error('Damage assignment orders are required');
    if (Object.keys(orders).length !== requiredIds.length || Object.keys(orders).some(aid => !required[aid])) throw new Error('Choose a damage assignment order for every multiply-blocked attacker');
    for (const aid of requiredIds) {
      const order = orders[aid], declared = required[aid];
      if (!Array.isArray(order) || order.length !== declared.length || new Set(order).size !== order.length) throw new Error('Invalid blocker damage assignment order');
      const declaredSet = new Set(declared); if (order.some(id => !declaredSet.has(id))) throw new Error('Damage assignment order must contain exactly the declared blockers');
    }
    return true;
  }

  setDamageAssignmentOrder(pid, orders, token) {
    this.#assertInternal(token); this.validateDamageAssignmentOrder(pid, orders);
    for (const [aid, order] of Object.entries(orders)) this.engine.state.combat.damageAssignments[aid] = [...order];
    return structuredClone(this.engine.state.combat.damageAssignments);
  }

  needsFirstStrikeStep() {
    const ids = [...this.engine.state.combat.attackers, ...Object.values(this.engine.state.combat.blockers || {}).flatMap(x => Array.isArray(x) ? x : [x])];
    return ids.some(id => { const permanent = this.engine.findPermanent(id); return !!permanent && this.engine.mechanics.needsFirstStrikeStep(permanent); });
  }

  #participatesInDamageStep(permanent, firstStrike) {
    return this.engine.mechanics.participatesInCombatDamageStep(permanent, firstStrike);
  }

  #damageSpecForDefendingEntity(targetId, amount, source) {
    if (this.engine.state.players[targetId]) return { targetPlayer: targetId, amount, source, combat: true };
    const target = this.engine.findPermanent(targetId);
    return target ? { targetId: target.instanceId, amount, source, combat: true } : null;
  }

  #assignAttackerDamage(attacker, defenderId, firstStrike, damageEvents) {
    if (!this.#participatesInDamageStep(attacker, firstStrike)) return;
    const playerTarget = this.engine.state.players[defenderId];
    if (!defenderId || playerTarget?.lost) return;
    if (!playerTarget && !this.engine.findPermanent(defenderId)) return;
    const stats = this.engine.static.derivedStats(attacker); let remaining = Math.max(0, stats.power); if (remaining <= 0) return;
    const keywords = stats.keywords.map(x => String(x).toLowerCase()), combat = this.engine.state.combat, aid = attacker.instanceId;
    const wasBlocked = !!combat.blocked?.[aid], declaredOrder = combat.damageAssignments?.[aid] || combat.blockers?.[aid] || [], liveBlockers = declaredOrder.map(id => this.engine.findPermanent(id)).filter(Boolean);
    if (!wasBlocked) { damageEvents.push(this.#damageSpecForDefendingEntity(defenderId, remaining, attacker)); return; }
    if (!liveBlockers.length) { if (this.engine.mechanics.hasTrample(attacker)) damageEvents.push(this.#damageSpecForDefendingEntity(defenderId, remaining, attacker)); return; }
    for (let index = 0; index < liveBlockers.length && remaining > 0; index++) {
      const blocker = liveBlockers[index];
      const lethal = this.engine.mechanics.lethalDamageForBlocker(attacker, blocker);
      const isLast = index === liveBlockers.length - 1, amount = isLast && !this.engine.mechanics.hasTrample(attacker) ? remaining : Math.min(remaining, lethal);
      if (amount > 0) damageEvents.push({ targetId: blocker.instanceId, amount, source: attacker, combat: true }); remaining -= amount;
    }
    if (remaining > 0 && this.engine.mechanics.hasTrample(attacker)) damageEvents.push(this.#damageSpecForDefendingEntity(defenderId, remaining, attacker));
  }

  #assignBlockerDamage(attacker, blocker, firstStrike, damageEvents) {
    if (!this.#participatesInDamageStep(blocker, firstStrike)) return;
    const power = Math.max(0, this.engine.static.derivedStats(blocker).power);
    if (power > 0) damageEvents.push({ targetId: attacker.instanceId, amount: power, source: blocker, combat: true });
  }

  damageStep(firstStrike = false, token) {
    this.#assertInternal(token);
    return this.engine._withDeferredTriggers(() => {
      const state = this.engine.state, attackerPlayer = state.activePlayer, damageEvents = [];
      for (const aid of state.combat.attackers) {
        const attacker = this.engine.findPermanent(aid); if (!attacker) continue;
        const defenderEntity = state.combat.attackTargets?.[aid] || attacker.attackTarget || this.engine.opponent(attackerPlayer);
        const declared = state.combat.damageAssignments?.[aid] || state.combat.blockers?.[aid] || [], liveBlockers = declared.map(id => this.engine.findPermanent(id)).filter(Boolean);
        this.#assignAttackerDamage(attacker, defenderEntity, firstStrike, damageEvents);
        for (const blocker of liveBlockers) this.#assignBlockerDamage(attacker, blocker, firstStrike, damageEvents);
      }
      return this.engine.damage.resolveBatch(damageEvents.filter(Boolean), {
        cause: 'combat-damage',
        combat: true,
        stabilize: true,
        emitType: 'COMBAT_DAMAGE',
        emitPayload: { controller: attackerPlayer, firstStrike, combat: true }
      });
    });
  }

  cleanup(token) {
    this.#assertInternal(token);
    for (const player of Object.values(this.engine.state.players)) for (const permanent of player.battlefield) { permanent.attacking = false; permanent.attackTarget = null; permanent.blocking = null; }
    this.engine.state.combat = { attackers: [], attackTargets: {}, attackDefendingPlayers: {}, defendingEntities: {}, blockers: {}, blocked: {}, damageAssignments: {}, defendingPlayers: [], blockerQueue: [], currentDefender: null };
  }
}
