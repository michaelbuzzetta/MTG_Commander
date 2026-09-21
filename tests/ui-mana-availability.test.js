import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../src/engine/GameEngine.js';

test('mana availability snapshot includes floating mana and only currently usable sources', () => {
  const engine = Object.create(GameEngine.prototype);
  engine.state = { players: { player: { manaPool: { W: 1, U: 0, B: 0, R: 0, G: 0, C: 0 } } } };
  engine.db = {};
  engine.mana = {
    manaSources() {
      return [
        { options: [{ mana: { U: 1 } }] },
        { options: [{ mana: { R: 1 } }, { mana: { G: 1 } }] },
        { options: [{ mana: { C: 2 } }] }
      ];
    }
  };

  assert.deepEqual(engine.getManaAvailabilitySnapshot('player'), { W: 1, U: 1, B: 0, R: 1, G: 1, C: 2 });
});
