import test from 'node:test';
import assert from 'node:assert/strict';
import { db, decks } from './helpers.js';
import { GameEngine } from '../src/engine/GameEngine.js';
import { AIController } from '../src/ai/AIController.js';

const playable = decks.filter(deck => deck.playable !== false);
const seededRng = seed => {
  let state = seed >>> 0;
  return () => ((state = (1664525 * state + 1013904223) >>> 0) / 0x100000000);
};

function progressHash(engine) {
  const s = engine.state;
  return JSON.stringify({
    turn: s.turn,
    phase: s.phase,
    active: s.activePlayer,
    priority: s.priorityPlayer,
    pending: s.pendingChoice?.type || null,
    turnAction: s.turnActionPending,
    stack: s.stack.map(item => item.id || item.type),
    players: Object.fromEntries(Object.entries(s.players).map(([id, p]) => [id, {
      life: p.life,
      library: p.library.length,
      hand: p.hand.length,
      graveyard: p.graveyard.length,
      battlefield: p.battlefield.map(card => [card.instanceId, card.tapped, card.damageMarked, card.counters]).sort()
    }]))
  });
}

test('Category 10 BUG-068 stress: deterministic AI games make measurable progress and detect repeated-state deadlocks', () => {
  assert.ok(playable.length >= 2);
  for (let game = 0; game < 50; game++) {
    const deckA = playable[game % playable.length];
    const deckB = playable[(game + 1) % playable.length];
    const e = new GameEngine(deckA, deckB, db, { rng: seededRng(0xC0FFEE + game) });
    e.start();

    const targetTurn = 8;
    const actionCap = 700;
    let actions = 0;
    let phaseTransitions = 0;
    let lastPhaseKey = `${e.state.turn}:${e.state.phase}`;
    const seen = new Map();

    while (!e.state.winner && e.state.turn < targetTurn && actions < actionCap) {
      const before = progressHash(e);
      const count = (seen.get(before) || 0) + 1;
      seen.set(before, count);
      assert.ok(count <= 3, `game ${game} repeated the same full engine state ${count} times at turn ${e.state.turn} ${e.state.phase}`);

      const pid = e.state.priorityPlayer;
      assert.ok(pid, `game ${game} has no priority player before reaching an acceptable termination state`);
      const action = new AIController(e, pid).choose();
      assert.ok(action, `game ${game} produced no action for ${pid} at ${e.state.phase}`);
      assert.doesNotThrow(() => e.perform(pid, action), `game ${game} action ${action.type} should be legal`);
      actions++;

      for (const p of Object.values(e.state.players)) {
        assert.ok(Number.isFinite(p.life));
        assert.ok(p.library.length >= 0 && p.hand.length >= 0);
        assert.equal(new Set(p.battlefield.map(card => card.instanceId)).size, p.battlefield.length);
      }

      const phaseKey = `${e.state.turn}:${e.state.phase}`;
      if (phaseKey !== lastPhaseKey) { phaseTransitions++; lastPhaseKey = phaseKey; }
    }

    assert.ok(e.state.winner || e.state.turn >= targetTurn, `game ${game} hit action cap ${actionCap} without reaching turn ${targetTurn} or a winner (turn=${e.state.turn}, phase=${e.state.phase}, actions=${actions})`);
    assert.ok(phaseTransitions >= 10 || e.state.winner, `game ${game} did not demonstrate enough phase progress`);
  }
});
