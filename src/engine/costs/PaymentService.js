import { PaymentPlanner } from './PaymentPlanner.js';
import { ensureRestrictedMana } from './ManaPool.js';

function snapshotResources(engine) { return structuredClone(engine.state); }

export class PaymentService {
  constructor(engine) { this.engine = engine; this.planner = new PaymentPlanner(engine); }

  validateNonManaCost(playerId, cost) {
    const e = this.engine, p = e.state.players[playerId];
    if (!p) throw new Error(`Unknown player ${playerId}`);
    const permanent = cost.permanentId ? e.findPermanent(cost.permanentId) : null;
    if (cost.type === 'tap') {
      if (!permanent || permanent.controller !== playerId || permanent.tapped) throw new Error('Cannot pay tap cost');
    } else if (cost.type === 'untap') {
      if (!permanent || permanent.controller !== playerId || !permanent.tapped) throw new Error('Cannot pay untap cost');
    } else if (cost.type === 'sacrifice') {
      if (!permanent || permanent.controller !== playerId) throw new Error('Cannot pay sacrifice cost');
    } else if (cost.type === 'discard') {
      const card = e.zones.find(cost.cardInstanceId);
      if (!card || card.zone !== 'hand' || card.player?.id !== playerId) throw new Error('Cannot pay discard cost');
    } else if (cost.type === 'payLife') {
      if (Number(cost.amount || 0) < 0 || p.life < Number(cost.amount || 0)) throw new Error('Cannot pay life cost');
    } else if (cost.type === 'exile') {
      const card = e.zones.find(cost.cardInstanceId);
      if (!card || card.zone !== (cost.fromZone || 'graveyard') || card.card.owner !== playerId) throw new Error('Cannot pay exile cost');
    } else if (cost.type === 'removeCounter') {
      if (!permanent) throw new Error('Counter cost source is unavailable');
      const type = cost.counter || cost.counterType || '+1/+1';
      if (Number(permanent.counters?.[type] || 0) < Number(cost.amount || 1)) throw new Error('Not enough counters to pay cost');
    } else if (cost.type === 'reveal') {
      const card = e.zones.find(cost.cardInstanceId);
      if (!card || card.zone !== (cost.fromZone || 'hand') || card.player?.id !== playerId) throw new Error('Cannot reveal that card as a cost');
    } else if (cost.type === 'return') {
      if (!permanent || permanent.controller !== playerId) throw new Error('Cannot return that permanent as a cost');
    } else throw new Error(`Unknown non-mana cost primitive ${cost.type}`);
    return true;
  }

  validateNonManaCosts(playerId, costs = []) {
    for (const cost of costs) this.validateNonManaCost(playerId, cost);
    return true;
  }

  reservedSourceIds(costs = []) {
    return [...new Set(costs.filter(cost => ['tap','untap','sacrifice','return'].includes(cost.type)).map(cost => cost.permanentId).filter(Boolean))];
  }

  canPayLockedCost(playerId, lockedCost, { context = {}, preferredSourceIds = null, reservedSourceIds = [] } = {}) {
    try { this.validateNonManaCosts(playerId, lockedCost.nonManaCosts || []); } catch { return false; }
    const reserved = [...new Set([...this.reservedSourceIds(lockedCost.nonManaCosts), ...(reservedSourceIds || [])])];
    return !!this.planner.plan(playerId, lockedCost, { context, reservedSourceIds: reserved, preferredSourceIds });
  }

  _commitNonManaCost(playerId, cost) {
    const e = this.engine;
    if (cost.type === 'tap') e.tapPermanent(e.findPermanent(cost.permanentId));
    else if (cost.type === 'untap') e.untapPermanent(e.findPermanent(cost.permanentId));
    else if (cost.type === 'sacrifice') e.sacrifice(e.findPermanent(cost.permanentId));
    else if (cost.type === 'discard') e.discardCard(playerId, cost.cardInstanceId, 'cost');
    else if (cost.type === 'payLife') e.changeLife(playerId, -Number(cost.amount || 0));
    else if (cost.type === 'exile') e._moveZoneNow(e.zones.find(cost.cardInstanceId)?.card, 'exile', playerId, { reason: 'cost-exile' });
    else if (cost.type === 'removeCounter') e.removeCounters(e.findPermanent(cost.permanentId), cost.counter || cost.counterType || '+1/+1', Number(cost.amount || 1), playerId);
    else if (cost.type === 'reveal') e.revealCard(e.zones.find(cost.cardInstanceId)?.card, { reason: 'cost-reveal' });
    else if (cost.type === 'return') e.moveToZone(e.findPermanent(cost.permanentId), 'hand', playerId, { reason: 'cost-return' });
  }

  _spendAdvanced(playerId, plan) {
    const e = this.engine, player = e.state.players[playerId];
    for (const activation of plan.activations || []) {
      const permanent = e.findPermanent(activation.permanentId);
      if (!permanent) throw new Error('Mana source disappeared during payment');
      if (activation.requiresTap) e.tapPermanent(permanent);
      e.mana.add(player, activation.mana);
    }
    if (plan.legacy) {
      const cost = plan.lockedCost.finalManaCost || '';
      if (!e.mana.pay(player, cost, 0)) throw new Error('Legacy payment plan became invalid');
      return;
    }
    const spend = Object.fromEntries(['W','U','B','R','G','C'].map(c => [c, 0]));
    for (const assignment of plan.assignments || []) {
      const unit = assignment.unit;
      if (unit.restricted) {
        const restricted = ensureRestrictedMana(player);
        const entry = restricted.find(item => item.id && item.id === unit.id) || restricted.find(item => item.color === unit.color && Number(item.amount || 0) > 0);
        if (!entry) throw new Error('Restricted mana unit disappeared during payment');
        entry.amount = Number(entry.amount || 1) - 1;
      } else spend[unit.color] += 1;
    }
    player.restrictedMana = ensureRestrictedMana(player).filter(item => Number(item.amount || 0) > 0);
    for (const [color, amount] of Object.entries(spend)) {
      if (Number(player.manaPool[color] || 0) < amount) throw new Error('Mana pool changed during payment');
      player.manaPool[color] -= amount;
    }
    if (plan.lifePayment) e.changeLife(playerId, -plan.lifePayment);
  }

  payLockedCost(playerId, lockedCost, { context = {}, preferredSourceIds = null, reservedSourceIds = [] } = {}) {
    this.validateNonManaCosts(playerId, lockedCost.nonManaCosts || []);
    const reserved = [...new Set([...this.reservedSourceIds(lockedCost.nonManaCosts), ...(reservedSourceIds || [])])];
    const plan = this.planner.plan(playerId, lockedCost, { context, reservedSourceIds: reserved, preferredSourceIds });
    if (!plan) return null;
    const rollback = snapshotResources(this.engine);
    try {
      for (const cost of lockedCost.nonManaCosts || []) this._commitNonManaCost(playerId, cost);
      this._spendAdvanced(playerId, plan);
      return structuredClone(plan);
    } catch (error) {
      this.engine.state = rollback;
      throw error;
    }
  }
}
