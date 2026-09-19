import test from 'node:test';
import assert from 'node:assert/strict';
import { engine, putBattlefield } from './helpers.js';
import { LAYER } from '../src/engine/continuous/index.js';

test('Step 11: temporary continuous effects derive characteristics without overwriting base state', () => {
  const e = engine();
  const bear = putBattlefield(e, 'player', 'grizzly-bears');
  const base = e.getDerivedStats(bear);
  const id = e.continuous.register({
    layer: LAYER.PT_MODIFY,
    duration: 'custom',
    filter: ({ target }) => target.instanceId === bear.instanceId,
    transform: { powerDelta: 3, toughnessDelta: 1 }
  });
  assert.deepEqual(base, { power: 2, toughness: 2, keywords: [] });
  assert.equal(e.getDerivedStats(bear).power, 5);
  assert.equal(bear.modifiers.power, 0, 'derived effects do not overwrite the permanent');
  e.continuous.unregister(id);
  assert.equal(e.getDerivedStats(bear).power, 2);
});

test('Step 11: layers apply type changes before later characteristic queries', () => {
  const e = engine();
  const land = putBattlefield(e, 'player', 'forest');
  e.continuous.register({
    layer: LAYER.TYPE,
    duration: 'custom',
    filter: ({ target }) => target.instanceId === land.instanceId,
    transform: { addTypes: ['Creature'], addSubtypes: ['Elemental'] }
  });
  e.continuous.register({
    layer: LAYER.PT_SET,
    duration: 'custom',
    filter: ({ target, characteristics }) => target.instanceId === land.instanceId && characteristics.types.includes('Creature'),
    transform: { setPower: 3, setToughness: 3 }
  });
  assert.equal(e.isObjectType(land, 'Creature'), true);
  assert.equal(e.objectHasSubtype(land, 'Elemental'), true);
  assert.equal(e.getDerivedStats(land).power, 3);
  assert.ok(e.getLegalAttackers('player').some(card => card.instanceId === land.instanceId));
});

test('Step 11: timestamps order otherwise independent effects in the same layer', () => {
  const e = engine();
  const bear = putBattlefield(e, 'player', 'grizzly-bears');
  e.continuous.register({ id: 'older', layer: LAYER.PT_SET, timestamp: 10, duration: 'custom', filter: ({ target }) => target.instanceId === bear.instanceId, transform: { setPower: 4 } });
  e.continuous.register({ id: 'newer', layer: LAYER.PT_SET, timestamp: 20, duration: 'custom', filter: ({ target }) => target.instanceId === bear.instanceId, transform: { setPower: 7 } });
  assert.equal(e.getDerivedStats(bear).power, 7);
});

test('Step 11: dependencies override timestamp order inside a layer', () => {
  const e = engine();
  const bear = putBattlefield(e, 'player', 'grizzly-bears');
  e.continuous.register({ id: 'late-first', layer: LAYER.PT_SET, timestamp: 20, duration: 'custom', filter: ({ target }) => target.instanceId === bear.instanceId, transform: { setPower: 7 } });
  e.continuous.register({ id: 'dependent-last', layer: LAYER.PT_SET, timestamp: 10, dependsOn: ['late-first'], duration: 'custom', filter: ({ target }) => target.instanceId === bear.instanceId, transform: { setPower: 9 } });
  assert.equal(e.getDerivedStats(bear).power, 9);
});

test('Step 11: ability-removal effects remove keywords in layer six', () => {
  const e = engine();
  const god = putBattlefield(e, 'player', 'indestructible-god');
  assert.ok(e.getDerivedStats(god).keywords.map(x => x.toLowerCase()).includes('indestructible'));
  e.continuous.register({
    layer: LAYER.ABILITY,
    timestamp: 9999,
    duration: 'custom',
    filter: ({ target }) => target.instanceId === god.instanceId,
    transform: { removeAbilities: true }
  });
  assert.equal(e.getDerivedStats(god).keywords.length, 0);
});

test('Step 11: characteristic-defining hand-size power/toughness is dynamic', () => {
  const e = engine();
  e._registerRuntimeCardDefinition('hand-avatar', {
    id: 'hand-avatar', name: 'Hand Avatar', typeLine: 'Creature — Avatar', power: 0, toughness: 0,
    dynamicPowerToughness: 'handSize', keywords: [], abilities: []
  });
  const avatar = putBattlefield(e, 'player', 'hand-avatar');
  const expected = e.state.players.player.hand.length;
  assert.equal(e.getDerivedStats(avatar).power, expected);
  e.state.players.player.hand.pop();
  assert.equal(e.getDerivedStats(avatar).power, expected - 1);
});
