import test from 'node:test';
import assert from 'node:assert/strict';

import * as cardFace from '../src/engine/CardFace.js';
import * as gameObject from '../src/engine/GameObject.js';
import * as gameStateSchema from '../src/engine/GameStateSchema.js';
import * as serialization from '../src/engine/serialization.js';

test('legacy engine root re-exports resolve to canonical state modules', () => {
  assert.ok(Object.keys(cardFace).length > 0);
  assert.ok(Object.keys(gameObject).length > 0);
  assert.ok(Object.keys(gameStateSchema).length > 0);
  assert.ok(Object.keys(serialization).length > 0);
});
