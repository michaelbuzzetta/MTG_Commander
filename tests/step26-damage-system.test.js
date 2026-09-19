import test from 'node:test';
import assert from 'node:assert/strict';
import { engine, putBattlefield, setPhase } from './helpers.js';
import { ENGINE_EVENT } from '../src/engine/events/EventTypes.js';
import { DamageEvent } from '../src/engine/damage/index.js';

function define(e, id, def = {}) {
  e._registerRuntimeCardDefinition(id, { id, name: id, typeLine: 'Creature — Test', power: 2, toughness: 2, keywords: [], abilities: [], ...def });
}

test('Step 26: DamageEvent exposes normalized source, recipient, controller, commander identity, combat/type, and keyword metadata', () => {
  const e = engine();
  define(e, 'step26-source', { keywords: ['deathtouch', 'lifelink', 'infect'] });
  const source = putBattlefield(e, 'player', 'step26-source', { isCommander: true, commanderIdentity: 'cmd-step26' });
  const payload = DamageEvent.request(e, { targetPlayer: 'ai', amount: 3, source, combat: true });
  const event = { eventId: 'evt-test', payload, provenance: { parentEventId: 'evt-parent' } };
  const damage = DamageEvent.fromEngineEvent(e, event);
  assert.equal(damage.sourceController, 'player');
  assert.equal(damage.commanderIdentity, 'cmd-step26');
  assert.deepEqual(damage.recipient, { kind: 'player', id: 'ai' });
  assert.equal(damage.amount, 3);
  assert.equal(damage.combat, true);
  assert.equal(damage.damageType, 'combat');
  assert.equal(damage.parentEventId, 'evt-parent');
  assert.equal(damage.properties.deathtouch, true);
  assert.equal(damage.properties.lifelink, true);
  assert.equal(damage.properties.infect, true);
});

test('Step 26: noncombat damage uses the same DEAL_DAMAGE event path as combat damage', () => {
  const e = engine();
  const source = putBattlefield(e, 'player', 'grizzly-bears');
  e.dealDamageToPlayer('ai', 2, source);
  e.dealDamageToPlayer('ai', 2, source, { combat: true });
  const rows = e.getEventLogSnapshot().filter(row => row.type === ENGINE_EVENT.DEAL_DAMAGE).slice(-2);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].payload.combat, false);
  assert.equal(rows[1].payload.combat, true);
  assert.equal(rows[0].payload.dealtAmount, 2);
  assert.equal(rows[1].payload.dealtAmount, 2);
});

test('Step 26: replacement and prevention transform damage before the recorded dealt amount', () => {
  const e = engine();
  const target = putBattlefield(e, 'ai', 'grizzly-bears');
  e.replacements.register({
    id: 'step26-double', eventTypes: ENGINE_EVENT.DEAL_DAMAGE, affectedPlayer: () => 'ai',
    transform: event => ({ ...event, payload: { ...event.payload, amount: Number(event.payload.amount) * 2 } })
  });
  e.prevention.addDamageShield(target, 3, { expires: null });
  const result = e.dealDamageToPermanent(target, 2, null);
  assert.equal(result.amount, 1);
  assert.equal(result.prevented, 3);
  const row = e.getEventLogSnapshot().filter(r => r.type === ENGINE_EVENT.DEAL_DAMAGE).at(-1);
  assert.equal(row.payload.amount, 1);
  assert.equal(row.payload.dealtAmount, 1);
  assert.equal(row.payload.preventedAmount, 3);
  assert.equal(target.damageMarked, 1);
});

test('Step 26: replacement effects can redirect a damage recipient before commit', () => {
  const e = engine();
  const target = putBattlefield(e, 'ai', 'grizzly-bears');
  e.replacements.register({
    id: 'step26-redirect-player', eventTypes: ENGINE_EVENT.DEAL_DAMAGE, affectedPlayer: () => 'ai',
    transform: event => ({ ...event, payload: { ...event.payload, targetPlayer: 'ai', targetId: null, target: null } })
  });
  const before = e.state.players.ai.life;
  e.dealDamageToPermanent(target, 2, null);
  assert.equal(target.damageMarked, 0);
  assert.equal(e.state.players.ai.life, before - 2);
  const row = e.getEventLogSnapshot().filter(r => r.type === ENGINE_EVENT.DEAL_DAMAGE).at(-1);
  assert.equal(row.payload.targetPlayer, 'ai');
  assert.equal(row.payload.damageConsequence, 'life-loss');
});

test('Step 26: changing the source recomputes lifelink/deathtouch metadata unless explicitly overridden', () => {
  const e = engine();
  define(e, 'plain-source');
  define(e, 'linked-source', { keywords: ['lifelink', 'deathtouch'] });
  const plain = putBattlefield(e, 'player', 'plain-source');
  const linked = putBattlefield(e, 'player', 'linked-source');
  const target = putBattlefield(e, 'ai', 'grizzly-bears');
  const life = e.state.players.player.life;
  e.replacements.register({
    id: 'step26-source-change', eventTypes: ENGINE_EVENT.DEAL_DAMAGE, affectedPlayer: () => 'ai',
    transform: event => ({ ...event, payload: { ...event.payload, source: linked } })
  });
  e.dealDamageToPermanent(target, 1, plain);
  assert.equal(e.state.players.player.life, life + 1);
  assert.equal(target.deathtouchMarked, true);
});

test('Step 26: infect damage to a player creates poison counters instead of life loss', () => {
  const e = engine();
  define(e, 'infect-source', { keywords: ['infect'] });
  const source = putBattlefield(e, 'player', 'infect-source');
  const life = e.state.players.ai.life;
  const result = e.dealDamageToPlayer('ai', 4, source);
  assert.equal(e.state.players.ai.life, life);
  assert.equal(e.counters.count('ai', 'poison'), 4);
  assert.equal(result.consequence, 'poison-counters');
});

test('Step 26: infect and wither damage to creatures use -1/-1 counters instead of marked damage', () => {
  for (const keyword of ['infect', 'wither']) {
    const e = engine();
    define(e, `${keyword}-source`, { keywords: [keyword] });
    const source = putBattlefield(e, 'player', `${keyword}-source`);
    const target = putBattlefield(e, 'ai', 'giant-spider');
    e.dealDamageToPermanent(target, 2, source);
    assert.equal(target.damageMarked, 0);
    assert.equal(e.counters.count(target, '-1/-1'), 2);
  }
});

test('Step 26: infect does not replace loyalty/defense damage consequences', () => {
  const e = engine();
  define(e, 'infect-source', { keywords: ['infect'] });
  define(e, 'walker26', { typeLine: 'Legendary Planeswalker — Test', loyalty: 5, power: null, toughness: null });
  define(e, 'battle26', { typeLine: 'Battle — Siege', defense: 6, power: null, toughness: null });
  const source = putBattlefield(e, 'player', 'infect-source');
  const walker = putBattlefield(e, 'ai', 'walker26', { counters: { loyalty: 5 } });
  const battle = putBattlefield(e, 'ai', 'battle26', { counters: { defense: 6 } });
  e.dealDamageToPermanent(walker, 2, source);
  e.dealDamageToPermanent(battle, 3, source);
  assert.equal(e.counters.count(walker, 'loyalty'), 3);
  assert.equal(e.counters.count(battle, 'defense'), 3);
  assert.equal(e.counters.count(walker, '-1/-1'), 0);
  assert.equal(e.counters.count(battle, '-1/-1'), 0);
});

test('Step 26: lifelink gains life from actual post-prevention damage only', () => {
  const e = engine();
  define(e, 'lifelink26', { keywords: ['lifelink'] });
  const source = putBattlefield(e, 'player', 'lifelink26');
  const target = putBattlefield(e, 'ai', 'giant-spider');
  e.prevention.addDamageShield(target, 2, { expires: null });
  const before = e.state.players.player.life;
  e.dealDamageToPermanent(target, 5, source);
  assert.equal(target.damageMarked, 3);
  assert.equal(e.state.players.player.life, before + 3);
});

test('Step 26: commander combat damage tracks actual dealt damage even with infect', () => {
  const e = engine();
  define(e, 'infect-commander26', { keywords: ['infect'] });
  const source = putBattlefield(e, 'player', 'infect-commander26', { isCommander: true, commanderIdentity: 'infect-cmd' });
  e.prevention.addDamageShield(e.state.players.ai, 2, { expires: null });
  e.dealDamageToPlayer('ai', 5, source, { combat: true });
  assert.equal(e.counters.count('ai', 'poison'), 3);
  assert.equal(e.state.players.ai.commanderDamage['infect-cmd'], 3);
});

test('Step 26: deathtouch is linked to actual positive damage and not fully prevented damage', () => {
  const e = engine();
  define(e, 'death26', { keywords: ['deathtouch'] });
  const source = putBattlefield(e, 'player', 'death26');
  const target = putBattlefield(e, 'ai', 'giant-spider');
  e.prevention.addDamageShield(target, 1, { expires: null });
  e.dealDamageToPermanent(target, 1, source);
  assert.notEqual(target.deathtouchMarked, true);
  e.dealDamageToPermanent(target, 1, source);
  assert.equal(target.deathtouchMarked, true);
});

test('Step 26: event observers see the transformed final amount and final recipient', () => {
  const e = engine();
  const source = putBattlefield(e, 'player', 'grizzly-bears');
  const seen = [];
  e.events.subscribe(ENGINE_EVENT.DEAL_DAMAGE, (_record, _engine, payload) => seen.push(payload));
  e.replacements.register({
    id: 'step26-observer-redirect', eventTypes: ENGINE_EVENT.DEAL_DAMAGE, affectedPlayer: () => 'ai',
    transform: event => ({ ...event, payload: { ...event.payload, amount: 4, targetPlayer: 'ai', targetId: null } })
  });
  e.prevention.addDamageShield(e.state.players.ai, 1, { expires: null });
  e.dealDamageToPlayer('ai', 1, source);
  assert.equal(seen.at(-1).amount, 3);
  assert.equal(seen.at(-1).dealtAmount, 3);
  assert.equal(seen.at(-1).targetPlayer, 'ai');
});

test('Step 26: a damage batch applies all lethal damage before the simultaneous SBA batch', () => {
  const e = engine();
  const a = putBattlefield(e, 'player', 'grizzly-bears');
  const b = putBattlefield(e, 'ai', 'grizzly-bears');
  const result = e.dealDamageBatch([
    { targetId: a.instanceId, amount: 2, source: b, combat: true },
    { targetId: b.instanceId, amount: 2, source: a, combat: true }
  ], { combat: true, stabilize: true, cause: 'step26-simultaneous' });
  assert.equal(result.results.length, 2);
  assert.equal(e.findPermanent(a.instanceId), null);
  assert.equal(e.findPermanent(b.instanceId), null);
  const batch = e.state.history.filter(row => row.type === 'SBA_BATCH').at(-1);
  assert.equal(batch.actions.filter(action => action.reason === 'lethal-damage').length, 2);
  const damageRows = e.getEventLogSnapshot().filter(r => r.type === ENGINE_EVENT.DEAL_DAMAGE && r.payload.batchId === result.batchId);
  assert.equal(damageRows.length, 2);
});

test('Step 26: simultaneous player-lethal damage does not stop the batch after the first recipient', () => {
  const e = engine();
  e.state.players.player.life = 2;
  e.state.players.ai.life = 2;
  const a = putBattlefield(e, 'player', 'grizzly-bears');
  const b = putBattlefield(e, 'ai', 'grizzly-bears');
  e.dealDamageBatch([
    { targetPlayer: 'player', amount: 2, source: b, combat: true },
    { targetPlayer: 'ai', amount: 2, source: a, combat: true }
  ], { combat: true, stabilize: true });
  assert.equal(e.state.players.player.life, 0);
  assert.equal(e.state.players.ai.life, 0);
  assert.equal(e.state.winner, 'draw');
});

test('Step 26: batch events carry a shared batch identity and deterministic sequence positions', () => {
  const e = engine();
  const source = putBattlefield(e, 'player', 'grizzly-bears');
  const result = e.dealDamageBatch([
    { targetPlayer: 'ai', amount: 1, source },
    { targetPlayer: 'ai', amount: 1, source }
  ], { stabilize: false });
  const rows = e.getEventLogSnapshot().filter(r => r.type === ENGINE_EVENT.DEAL_DAMAGE && r.payload.batchId === result.batchId);
  assert.deepEqual(rows.map(row => row.payload.batchIndex), [0, 1]);
  assert.ok(rows.every(row => row.payload.batchSize === 2));
});

test('Step 26: combat engine damage step emits one semantic damage batch and uses the shared damage service', () => {
  const e = engine();
  const attacker = putBattlefield(e, 'player', 'grizzly-bears');
  setPhase(e, 'DECLARE_ATTACKERS', { turnActionPending: 'DECLARE_ATTACKERS' });
  e.perform('player', { type: 'DECLARE_ATTACKERS', attackers: [attacker.instanceId] });
  e.perform('player', { type: 'PASS_PRIORITY' }); e.perform('ai', { type: 'PASS_PRIORITY' });
  e.perform('ai', { type: 'DECLARE_BLOCKERS', blockers: {} });
  e.perform('player', { type: 'PASS_PRIORITY' }); e.perform('ai', { type: 'PASS_PRIORITY' });
  const batch = e.getEventLogSnapshot().filter(row => row.type === 'DAMAGE_BATCH').at(-1);
  assert.ok(batch);
  const damage = e.getEventLogSnapshot().filter(row => row.type === ENGINE_EVENT.DEAL_DAMAGE && row.payload.combat).at(-1);
  assert.equal(damage.payload.batchId, batch.payload.batchId);
});

test('Step 26: specialty mechanic registry recognizes infect and wither without card-specific damage code', () => {
  const e = engine();
  assert.equal(e.mechanics.registry.resolve('infect').category, 'specialty');
  assert.equal(e.mechanics.registry.resolve('wither').category, 'specialty');
  assert.ok(e.mechanics.registry.resolve('infect').dependencies.includes('damage'));
});

test('Step 26: damage batch state survives serialization if a replacement-order choice pauses the batch', () => {
  const e = engine();
  const source = e.state.players.player.command[0];
  for (const id of ['step26-r1','step26-r2']) e.replacements.register({
    id, eventTypes: ENGINE_EVENT.DEAL_DAMAGE, affectedPlayer: () => 'ai', metadata: { effect: id },
    transform: event => ({ ...event, payload: { ...event.payload, amount: Number(event.payload.amount) + 1 } })
  });
  const result = e.dealDamageBatch([
    { targetPlayer: 'ai', amount: 1, source },
    { targetPlayer: 'ai', amount: 1, source }
  ], { stabilize: false });
  assert.equal(result.deferred, true);
  assert.ok(e.state.pendingDamageBatch);
  const serialized = JSON.parse(e.serializeState());
  assert.equal(serialized.state.pendingDamageBatch.specs.length, 2);
  while (e.state.pendingChoice?.type === 'REPLACEMENT_ORDER') {
    const choice = e.state.pendingChoice;
    e.perform('ai', { type: 'ORDER_REPLACEMENTS', replacementIds: [...choice.replacementIds] });
  }
  assert.equal(e.state.pendingDamageBatch, null);
  assert.equal(e.state.players.ai.life, 34); // each 1 damage receives both +1 replacements => 3 each
});

test('Step 26: replacement effects may change combat/noncombat damage type before commit', () => {
  const e = engine();
  const source = e.state.players.player.command[0];
  e.replacements.register({
    id: 'step26-change-damage-type',
    eventTypes: ENGINE_EVENT.DEAL_DAMAGE,
    affectedPlayer: () => 'ai',
    transform: event => ({ ...event, payload: { ...event.payload, combat: false } })
  });
  e.dealDamageToPlayer('ai', 2, source, { combat: true });
  const row = e.getEventLogSnapshot().filter(r => r.type === ENGINE_EVENT.DEAL_DAMAGE).at(-1);
  assert.equal(row.payload.combat, false);
  assert.equal(row.payload.damageType, 'noncombat');
  assert.equal(e.state.players.ai.commanderDamage[source.oracleId || source.cardId || source.id] || 0, 0);
});
