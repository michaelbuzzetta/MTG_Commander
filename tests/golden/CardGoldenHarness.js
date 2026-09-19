import assert from 'node:assert/strict';
import { makeCardInstance } from '../../src/engine/GameState.js';
import { engine, setPhase } from '../helpers.js';

export class CardGoldenHarness {
  constructor({ activePlayer = 'player', phase = 'PRECOMBAT_MAIN' } = {}) {
    this.engine = engine();
    // Golden tests intentionally add isolated physical test objects that are not
    // members of the two loaded deck lists. Runtime invariants are covered by
    // Step 32; the golden harness keeps all gameplay operations authoritative.
    this.engine.setInvariantChecks(false);
    setPhase(this.engine, phase, { activePlayer, priorityPlayer: activePlayer });
    this.engine.events.clearLog();
    this.engine.replacements?.clearTrace?.();
    this.engine.state.history = [];
    for (const player of Object.values(this.engine.state.players)) {
      Object.assign(player.manaPool, { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });
    }
  }

  definition(cardId) {
    const definition = this.engine.db[cardId];
    assert.ok(definition, `Golden fixture requires card definition ${cardId}`);
    return definition;
  }

  card(cardId, playerId = 'player', zone = 'battlefield', extra = {}) {
    const definition = this.definition(cardId);
    const instance = makeCardInstance(cardId, playerId, zone, {
      controller: playerId,
      summoningSick: false,
      createdTurn: this.engine.state.turn,
      controlledSinceTurn: this.engine.state.turn,
      ...extra
    }, definition);
    this.engine.zones.place(instance, zone, playerId);
    if (zone === 'battlefield') instance.summoningSick = extra.summoningSick ?? false;
    return instance;
  }

  permanent(cardId, playerId = 'player', extra = {}) {
    return this.card(cardId, playerId, 'battlefield', extra);
  }

  handCard(cardId, playerId = 'player', extra = {}) {
    return this.card(cardId, playerId, 'hand', extra);
  }

  giveMana(playerId = 'player', mana = {}) {
    const pool = this.engine.state.players[playerId].manaPool;
    Object.assign(pool, { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, ...mana });
    return pool;
  }

  giveAbundantMana(playerId = 'player') {
    return this.giveMana(playerId, { W: 20, U: 20, B: 20, R: 20, G: 20, C: 20 });
  }

  givePriority(playerId = 'player', phase = null) {
    if (phase) setPhase(this.engine, phase, { activePlayer: playerId, priorityPlayer: playerId });
    else {
      this.engine.state.priorityPlayer = playerId;
      this.engine.state.passes = 0;
    }
  }

  setCounters(permanent, counterType, amount) {
    permanent.counters ||= {};
    permanent.counters[counterType] = Number(amount || 0);
    return permanent;
  }

  castFromHand(cardId, { playerId = 'player', targets = [], mana = null } = {}) {
    const card = this.handCard(cardId, playerId);
    if (mana) this.giveMana(playerId, mana);
    else this.giveAbundantMana(playerId);
    this.givePriority(playerId, this.engine.state.phase === 'PRECOMBAT_MAIN' ? null : 'PRECOMBAT_MAIN');
    this.engine.cast(playerId, card.instanceId, targets);
    return card;
  }

  resolveTopStack() {
    const e = this.engine;
    const startDepth = e.state.stack.length;
    assert.ok(startDepth > 0, 'resolveTopStack requires a non-empty stack');
    let guard = 0;
    while (e.state.stack.length >= startDepth && !e.state.pendingChoice && !e.state.winner) {
      assert.ok(e.state.priorityPlayer, 'priority must be assigned while resolving a stack object');
      e.passPriority(e.state.priorityPlayer);
      if (++guard > 16) throw new Error('Golden harness priority loop exceeded safety guard');
    }
    return e.state.stack.length;
  }

  castAndResolve(cardId, options = {}) {
    const card = this.castFromHand(cardId, options);
    this.resolveTopStack();
    return card;
  }

  zoneOf(ref) {
    return this.engine.zones.find(typeof ref === 'string' ? ref : ref?.instanceId)?.zone || null;
  }

  eventTypes() {
    return this.engine.getEventLogSnapshot().map(record => record.type);
  }

  assertEventSequence(expectedTypes, message = 'critical engine events must remain in rules order') {
    const actual = this.eventTypes();
    let cursor = -1;
    for (const type of expectedTypes) {
      const next = actual.indexOf(type, cursor + 1);
      assert.ok(next >= 0, `${message}: missing ${type}; saw ${actual.join(' -> ')}`);
      cursor = next;
    }
  }

  countBattlefieldByName(playerId, names) {
    const wanted = new Set(Array.isArray(names) ? names : [names]);
    const counts = Object.fromEntries([...wanted].map(name => [name, 0]));
    for (const permanent of this.engine.state.players[playerId].battlefield) {
      const name = this.engine.db[permanent.cardId]?.name;
      if (wanted.has(name)) counts[name] += 1;
    }
    return counts;
  }
}
