import test from 'node:test';
import assert from 'node:assert/strict';
import { engine, putBattlefield, setPhase } from './helpers.js';
import { makeCardInstance } from '../src/engine/GameState.js';
import { createStackObject } from '../src/engine/stack/index.js';
import { LAYER } from '../src/engine/continuous/index.js';

function register(e, id, extra = {}) {
  return e._registerRuntimeCardDefinition(id, {
    id, name: id, typeLine: 'Creature — Shapeshifter', manaCost: '{2}{U}', manaValue: 3,
    colorIdentity: ['U'], colors: ['U'], subtypes: ['Shapeshifter'], keywords: [], abilities: [],
    power: 2, toughness: 2, oracleText: 'Step 22 fixture.', supported: true,
    ...extra
  });
}

function permanent(e, pid, id, extra = {}) {
  const definition = e.db[id];
  const card = makeCardInstance(id, pid, 'battlefield', {
    tapped: false, summoningSick: false, counters: {}, damageMarked: 0,
    modifiers: { power: 0, toughness: 0, keywords: [] }, ...extra
  }, definition);
  e.zones.place(card, 'battlefield', pid);
  return card;
}

test('Step 22: CopiableValues are separate from mutable permanent state and printing identity', () => {
  const e = engine();
  register(e, 'step22-source', { name: 'Copy Source', power: 4, toughness: 5, keywords: ['flying'] });
  const source = permanent(e, 'player', 'step22-source', { tapped: true, counters: { '+1/+1': 3 }, damageMarked: 2 });
  const values = e.getCopiableValues(source.instanceId);
  assert.equal(values.name, 'Copy Source');
  assert.equal(values.power, 4);
  assert.equal(values.toughness, 5);
  assert.deepEqual(values.keywords, ['flying']);
  assert.equal('tapped' in values, false);
  assert.equal('counters' in values, false);
  assert.equal('damageMarked' in values, false);
  assert.equal(values.sourceCardId, 'step22-source');
});

test('Step 22: permanent copies use base/copiable values rather than counters, tapped state, or temporary buffs', () => {
  const e = engine();
  register(e, 'step22-source', { name: 'Source', power: 3, toughness: 3 });
  register(e, 'step22-clone', { name: 'Clone Body', power: 1, toughness: 1 });
  const source = permanent(e, 'player', 'step22-source', { tapped: true, counters: { '+1/+1': 2 } });
  const clone = permanent(e, 'player', 'step22-clone');
  e.continuous.register({ layer: LAYER.PT_MODIFY, duration: 'custom', filter: ({ target }) => target.instanceId === source.instanceId, transform: { powerDelta: 5, toughnessDelta: 5 } });
  assert.equal(e.getDerivedStats(source).power, 8);
  e.copyPermanent(clone.instanceId, source.instanceId);
  const stats = e.getDerivedStats(clone);
  assert.equal(stats.power, 3);
  assert.equal(stats.toughness, 3);
  assert.equal(clone.tapped, false);
  assert.deepEqual(clone.counters, {});
  assert.equal(e.getObjectDefinition(clone.instanceId).name, 'Source');
});

test('Step 22: copy-except modifications become part of copiable values and survive copy-of-copy', () => {
  const e = engine();
  register(e, 'step22-original', { name: 'Original', typeLine: 'Legendary Creature — Wizard', subtypes: ['Wizard'], power: 2, toughness: 4 });
  register(e, 'step22-clone-a', { name: 'A' });
  register(e, 'step22-clone-b', { name: 'B' });
  const source = permanent(e, 'player', 'step22-original');
  const a = permanent(e, 'player', 'step22-clone-a');
  const b = permanent(e, 'player', 'step22-clone-b');
  e.copyPermanent(a.instanceId, source.instanceId, { except: { notLegendary: true, addTypes: ['Artifact'], name: 'Altered Copy' } });
  e.copyPermanent(b.instanceId, a.instanceId);
  const d = e.getObjectDefinition(b.instanceId);
  assert.equal(d.name, 'Altered Copy');
  assert.match(d.typeLine, /Artifact/);
  assert.doesNotMatch(d.typeLine, /Legendary/);
  assert.equal(d.power, 2);
  assert.equal(d.toughness, 4);
});

test('Step 22: copy effects participate in layer recalculation before later continuous effects', () => {
  const e = engine();
  register(e, 'step22-source', { power: 2, toughness: 2 });
  register(e, 'step22-clone', { power: 7, toughness: 7 });
  const source = permanent(e, 'player', 'step22-source');
  const clone = permanent(e, 'player', 'step22-clone');
  e.copyPermanent(clone.instanceId, source.instanceId);
  e.continuous.register({ layer: LAYER.PT_MODIFY, duration: 'custom', filter: ({ target }) => target.instanceId === clone.instanceId, transform: { powerDelta: 1, toughnessDelta: 2 } });
  assert.equal(e.getDerivedStats(clone).power, 3);
  assert.equal(e.getDerivedStats(clone).toughness, 4);
  assert.ok(e.continuous.characteristics(clone, { trace: true }).appliedEffects.some(id => String(id).startsWith('copy-layer:')));
});

test('Step 22: temporary copy duration expires without overwriting the original permanent characteristics', () => {
  const e = engine();
  register(e, 'step22-source', { name: 'Temporary Source', power: 5, toughness: 5 });
  register(e, 'step22-target', { name: 'Original Body', power: 1, toughness: 1 });
  const source = permanent(e, 'player', 'step22-source');
  const target = permanent(e, 'player', 'step22-target');
  e.copyPermanent(target.instanceId, source.instanceId, { duration: 'until-end-of-turn' });
  assert.equal(e.getObjectDefinition(target.instanceId).name, 'Temporary Source');
  e.state.turn += 1;
  assert.equal(e.getObjectDefinition(target.instanceId).name, 'Original Body');
  assert.equal(e.getDerivedStats(target).power, 1);
});

test('Step 22: token copies keep an independent copiable snapshot after the source leaves', () => {
  const e = engine();
  register(e, 'step22-source', { name: 'Token Source', power: 4, toughness: 4, keywords: ['vigilance'] });
  const source = permanent(e, 'player', 'step22-source', { tapped: true, counters: { '+1/+1': 9 } });
  e.createTokenCopy('player', source.instanceId, { amount: 1 });
  const token = e.state.players.player.battlefield.find(card => card.isToken && card.copyMetadata?.isTokenCopy);
  assert.ok(token);
  assert.equal(e.getObjectDefinition(token.instanceId).name, 'Token Source');
  assert.equal(e.getDerivedStats(token).power, 4);
  assert.equal(token.tapped, false);
  assert.deepEqual(token.counters, {});
  e._moveZoneNow(source, 'graveyard', source.owner);
  assert.equal(e.getObjectDefinition(token.instanceId).name, 'Token Source');
  assert.equal(e.getDerivedStats(token).power, 4);
});

test('Step 22: stack copies retain modes, X, divisions and targets when retargeting is not granted', () => {
  const e = engine();
  register(e, 'step22-spell', { typeLine: 'Instant', power: null, toughness: null, targets: { kind: 'player', minTargets: 1, maxTargets: 1 }, modes: [{ id: 'mode-a', targets: { kind: 'player', minTargets: 1, maxTargets: 1 }, spellEffects: [{ type: 'gainLife', amount: 1 }] }], spellEffects: [{ type: 'gainLife', amount: 1 }] });
  const card = makeCardInstance('step22-spell', 'player', 'stack', {}, e.db['step22-spell']);
  const original = createStackObject({ type: 'spell', controller: 'player', card, selectedModes: ['mode-a'], mode: 'mode-a', xValue: 6, divided: { ai: 4 }, targets: ['ai'] });
  e.effects.queueSpellCopies(original, 1, 'player', { retargetAllowed: false });
  assert.equal(e.state.pendingChoice, null);
  const copy = e.state.stack.at(-1);
  assert.equal(copy.isCopy, true);
  assert.deepEqual(copy.selectedModes, ['mode-a']);
  assert.equal(copy.xValue, 6);
  assert.deepEqual(copy.divided, { ai: 4 });
  assert.deepEqual(copy.targets, ['ai']);
  assert.equal(copy.copyMetadata.retargetAllowed, false);
});

test('Step 22: spell copies may choose new targets only when the copying effect grants permission', () => {
  const e = engine();
  register(e, 'step22-target-spell', { typeLine: 'Instant', power: null, toughness: null, targets: { kind: 'player', minTargets: 1, maxTargets: 1 }, spellEffects: [{ type: 'gainLife', amount: 1 }] });
  const card = makeCardInstance('step22-target-spell', 'player', 'stack', {}, e.db['step22-target-spell']);
  const original = createStackObject({ type: 'spell', controller: 'player', card, targets: ['ai'] });
  e.effects.queueSpellCopies(original, 1, 'player', { retargetAllowed: true });
  assert.equal(e.state.pendingChoice?.type, 'COPY_TARGETS');
  e.perform('player', { type: 'CHOOSE_COPY_TARGETS', targetIds: ['player'] });
  const copy = e.state.stack.at(-1);
  assert.deepEqual(copy.targets, ['player']);
  assert.equal(copy.copyMetadata.retargetAllowed, true);
});

test('Step 22: activated/triggered ability stack objects can be copied through the same copy engine', () => {
  const e = engine();
  const source = putBattlefield(e, 'player', 'grizzly-bears');
  const original = createStackObject({ type: 'ability', controller: 'player', source, ability: { type: 'activated' }, effect: { type: 'gainLife', amount: 2 }, targets: [] });
  e.effects.queueSpellCopies(original, 1, 'player');
  const copy = e.state.stack.at(-1);
  assert.equal(copy.type, 'ability');
  assert.equal(copy.isCopy, true);
  const before = e.state.players.player.life;
  e.resolution.resolveTop();
  assert.equal(e.state.players.player.life, before + 2);
});

test('Step 22: Clone-style as-enters choice applies copied base characteristics before battlefield resolution', () => {
  const e = engine();
  register(e, 'step22-copy-source', { name: 'Chosen Creature', typeLine: 'Legendary Creature — Beast', subtypes: ['Beast'], power: 6, toughness: 6 });
  register(e, 'step22-clone-card', { name: 'Clone', power: 0, toughness: 0, copyAsEnters: { filter: { type: 'Creature' }, optional: false, except: { notLegendary: true, addTypes: ['Artifact'] } } });
  const source = permanent(e, 'player', 'step22-copy-source', { counters: { '+1/+1': 2 }, tapped: true });
  const clone = makeCardInstance('step22-clone-card', 'player', 'stack', {}, e.db['step22-clone-card']);
  const item = createStackObject({ type: 'spell', controller: 'player', card: clone, targets: [] });
  e.state.stack.push(item);
  e.resolution.resolveTop();
  assert.equal(e.state.pendingChoice?.type, 'COPY_PERMANENT');
  assert.ok(e.state.pendingChoice.candidateIds.includes(source.instanceId));
  e.perform('player', { type: 'CHOOSE_PERMANENT_COPY', permanentId: source.instanceId });
  const entered = e.state.players.player.battlefield.find(card => card.instanceId === clone.instanceId);
  assert.ok(entered);
  const d = e.getObjectDefinition(entered.instanceId);
  assert.equal(d.name, 'Chosen Creature');
  assert.match(d.typeLine, /Artifact/);
  assert.doesNotMatch(d.typeLine, /Legendary/);
  assert.equal(e.getDerivedStats(entered).power, 6);
  assert.deepEqual(entered.counters, {});
  assert.equal(entered.tapped, false);
});

test('Step 22: copied permanent spells enter as tokens and are never commanders', () => {
  const e = engine();
  register(e, 'step22-creature-spell', { name: 'Spell Creature', typeLine: 'Creature — Illusion', subtypes: ['Illusion'], power: 3, toughness: 3 });
  const card = makeCardInstance('step22-creature-spell', 'player', 'stack', { isCommander: true, commanderIdentity: 'fake' }, e.db['step22-creature-spell']);
  const original = createStackObject({ type: 'spell', controller: 'player', card, targets: [] });
  e.effects.queueSpellCopies(original, 1, 'player');
  const copy = e.state.stack.at(-1);
  assert.equal(copy.card.isCommander, false);
  e.resolution.resolveTop();
  const token = e.state.players.player.battlefield.find(c => c.instanceId === copy.card.instanceId);
  assert.ok(token?.isToken);
  assert.equal(token.isCommander, false);
  assert.equal(e.getObjectDefinition(token.instanceId).name, 'Spell Creature');
});

test('Step 22: leaving the battlefield ends a permanent copy effect but LKI records copied derived characteristics', () => {
  const e = engine();
  register(e, 'step22-lki-source', { name: 'Copied Name', power: 5, toughness: 5 });
  register(e, 'step22-lki-target', { name: 'Original Name', power: 1, toughness: 1 });
  const source = permanent(e, 'player', 'step22-lki-source');
  const target = permanent(e, 'player', 'step22-lki-target');
  e.copyPermanent(target.instanceId, source.instanceId);
  const oldObjectId = target.gameObjectId;
  e._moveZoneNow(target, 'graveyard', target.owner);
  const lki = e.getLastKnownInformation(oldObjectId);
  assert.equal(lki.object.derivedCharacteristics.power, 5);
  assert.ok(lki.object.copyState?.copiableValues);
  assert.equal(target.copyState, undefined);
  assert.equal(e.getObjectDefinition(target.instanceId).name, 'Original Name');
});

test('Step 22: token-copy quantity still flows through CREATE_TOKEN replacement effects such as Doubling Season', () => {
  const e = engine();
  register(e, 'step22-double-source', { name: 'Copy Me', power: 2, toughness: 2 });
  const source = permanent(e, 'player', 'step22-double-source');
  permanent(e, 'player', 'doubling-season');
  const before = e.state.players.player.battlefield.filter(card => card.isToken && card.copyMetadata?.isTokenCopy).length;
  e.createTokenCopy('player', source.instanceId, { amount: 1 });
  const after = e.state.players.player.battlefield.filter(card => card.isToken && card.copyMetadata?.isTokenCopy).length;
  assert.equal(after - before, 2);
});

test('Step 22: copied replacement abilities are sourced from copied characteristics, not the physical card definition', () => {
  const e = engine();
  register(e, 'step22-blank-enchantment', { typeLine: 'Enchantment', power: null, toughness: null, colors: [], colorIdentity: [], abilities: [] });
  const source = permanent(e, 'player', 'doubling-season');
  const copyBody = permanent(e, 'player', 'step22-blank-enchantment');
  const creature = permanent(e, 'player', 'grizzly-bears');
  e.copyPermanent(copyBody.instanceId, source.instanceId);
  e.effects.addCounters('player', creature, '+1/+1', 1);
  assert.equal(creature.counters['+1/+1'], 4, 'both the original and copied Doubling Season replacement effects apply');
});

test('Step 22: copied stax text feeds the authoritative legality service and cache invalidates on copy changes', () => {
  const e = engine();
  register(e, 'step22-rule-source', {
    name: 'Rule Source', typeLine: 'Enchantment', power: null, toughness: null,
    oracleText: "Each player can't cast more than one spell each turn."
  });
  register(e, 'step22-rule-copy', { name: 'Blank Copy', typeLine: 'Enchantment', power: null, toughness: null, oracleText: '' });
  const source = permanent(e, 'player', 'step22-rule-source');
  const copyBody = permanent(e, 'player', 'step22-rule-copy');
  // Remove the original source after copying so only the copied rule remains.
  e.copyPermanent(copyBody.instanceId, source.instanceId);
  e._moveZoneNow(source, 'graveyard', source.owner);
  const rules = e.legality.activeRules('CAST');
  assert.ok(rules.some(rule => rule.sourceId === copyBody.instanceId && rule.maxPerTurn === 1));
  e.copy.clearPermanentCopy(copyBody.instanceId);
  assert.ok(!e.legality.activeRules('CAST').some(rule => rule.sourceId === copyBody.instanceId && rule.maxPerTurn === 1));
});
