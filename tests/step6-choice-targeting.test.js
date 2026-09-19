import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AIController } from '../src/ai/AIController.js';
import { createChoiceRequest, createChoiceResponse, CHOICE_TYPE, and, or, not } from '../src/engine/choices/index.js';
import { ZoneManager } from '../src/engine/ZoneManager.js';
import { engine, putBattlefield, setPhase } from './helpers.js';

function registerPermanent(e, id, {
  name = id,
  typeLine = 'Creature — Human',
  manaCost = '{1}',
  manaValue = 1,
  colorIdentity = [],
  subtypes = ['Human'],
  keywords = [],
  power = 1,
  toughness = 1
} = {}) {
  e._registerRuntimeCardDefinition(id, {
    id, name, typeLine, manaCost, manaValue, colorIdentity, subtypes, keywords,
    power, toughness, abilities: [], spellEffects: [], oracleText: 'Step 6 test card.', supported: true
  });
}

function setupTargets() {
  const e = engine();
  registerPermanent(e, 'step6-red-legend', {
    name: 'Red Legend', typeLine: 'Legendary Creature — Wizard', manaCost: '{2}{R}', manaValue: 3,
    colorIdentity: ['R'], subtypes: ['Wizard'], keywords: ['vigilance'], power: 3, toughness: 3
  });
  registerPermanent(e, 'step6-blue-golem', {
    name: 'Blue Golem', typeLine: 'Artifact Creature — Golem', manaCost: '{2}{U}', manaValue: 3,
    colorIdentity: ['U'], subtypes: ['Golem'], keywords: [], power: 2, toughness: 4
  });
  registerPermanent(e, 'step6-shroud', {
    name: 'Shrouded One', typeLine: 'Creature — Elf', manaCost: '{1}{G}', manaValue: 2,
    colorIdentity: ['G'], subtypes: ['Elf'], keywords: ['shroud'], power: 2, toughness: 2
  });
  registerPermanent(e, 'step6-source', {
    name: 'Source Mage', typeLine: 'Creature — Wizard', manaCost: '{U}', manaValue: 1,
    colorIdentity: ['U'], subtypes: ['Wizard'], keywords: [], power: 1, toughness: 1
  });
  const red = putBattlefield(e, 'ai', 'step6-red-legend', { attacking: true });
  const golem = putBattlefield(e, 'ai', 'step6-blue-golem', { blocking: red.instanceId, tapped: true, counters: { charge: 1 } });
  const shroud = putBattlefield(e, 'ai', 'step6-shroud');
  const source = putBattlefield(e, 'player', 'step6-source');
  return { e, red, golem, shroud, source };
}

test('Step 6: ChoiceRequest/ChoiceResponse protocol covers common standardized choice classes', () => {
  const cases = [
    [CHOICE_TYPE.BOOLEAN, 1, 1],
    [CHOICE_TYPE.OPTION, 1, 1],
    [CHOICE_TYPE.MODE, 1, 1],
    [CHOICE_TYPE.NUMBER, 0, 10],
    [CHOICE_TYPE.COLOR, 1, 1],
    [CHOICE_TYPE.NAME, 1, 1],
    [CHOICE_TYPE.PLAYER, 1, 1],
    [CHOICE_TYPE.TARGETS, 1, 2],
    [CHOICE_TYPE.CARDS, 0, 3],
    [CHOICE_TYPE.PERMANENTS, 2, 2],
    [CHOICE_TYPE.ORDER, 3, 3],
    [CHOICE_TYPE.DIVIDE, 2, 2],
    [CHOICE_TYPE.ACTION, 1, 1]
  ];
  for (const [choiceType, min, max] of cases) {
    const request = createChoiceRequest({
      requestId: `req-${choiceType}`,
      requestingPlayer: 'player',
      choiceType,
      min,
      max,
      targeted: choiceType === CHOICE_TYPE.TARGETS,
      orderingRequired: choiceType === CHOICE_TYPE.ORDER,
      visibility: choiceType === CHOICE_TYPE.CARDS ? 'private' : 'public',
      allowCancel: min === 0,
      contextId: `ctx-${choiceType}`
    });
    assert.equal(request.choiceType, choiceType);
    assert.equal(request.min, min);
    assert.equal(request.max, max);
    assert.equal(request.contextId, `ctx-${choiceType}`);
  }
  const response = createChoiceResponse({ requestId: 'req-option', selections: ['blue'] });
  assert.deepEqual(response.selections, ['blue']);
});

test('Step 6: composable target filters support AND, OR, NOT and high-value card predicates', () => {
  const { e, red, golem, source } = setupTargets();
  const patterns = [
    [{ kind: 'permanent', filter: { type: 'Creature' } }, [red.instanceId, golem.instanceId]],
    [{ kind: 'permanent', filter: { subtype: 'Wizard' } }, [red.instanceId]],
    [{ kind: 'permanent', filter: { subtype: 'Golem' } }, [golem.instanceId]],
    [{ kind: 'permanent', filter: { color: 'red' } }, [red.instanceId]],
    [{ kind: 'permanent', filter: { color: 'blue' } }, [golem.instanceId]],
    [{ kind: 'permanent', filter: { legendary: true } }, [red.instanceId]],
    [{ kind: 'permanent', filter: { manaValueMax: 2 } }, []],
    [{ kind: 'permanent', filter: { manaValueMin: 3 } }, [red.instanceId, golem.instanceId]],
    [{ kind: 'permanent', filter: { attacking: true } }, [red.instanceId]],
    [{ kind: 'permanent', filter: { blocking: true } }, [golem.instanceId]],
    [{ kind: 'permanent', filter: { tapped: true } }, [golem.instanceId]],
    [{ kind: 'permanent', filter: { hasCounter: 'charge' } }, [golem.instanceId]],
    [{ kind: 'permanent', filter: and({ type: 'Creature' }, { color: 'red' }) }, [red.instanceId]],
    [{ kind: 'permanent', filter: or({ subtype: 'Wizard' }, { subtype: 'Golem' }) }, [red.instanceId, golem.instanceId]],
    [{ kind: 'permanent', filter: and({ type: 'Creature' }, not({ legendary: true })) }, [golem.instanceId]],
    [{ kind: 'permanent', controller: 'opponent', filter: { type: 'Creature' } }, [red.instanceId, golem.instanceId]],
    [{ kind: 'permanent', filter: { name: 'Red Legend' } }, [red.instanceId]],
    [{ kind: 'permanent', filter: { cardId: 'step6-blue-golem' } }, [golem.instanceId]],
    [{ kind: 'permanent', filter: { allTypes: ['Artifact', 'Creature'] } }, [golem.instanceId]],
    [{ kind: 'permanent', filter: { not: { tapped: true } } }, [red.instanceId]]
  ];

  for (const [target, expectedSubset] of patterns) {
    const ids = e.getTargetCandidates('player', { targets: target }, [], { sourceObject: source }).map(candidate => candidate.id);
    for (const id of expectedSubset) assert.ok(ids.includes(id), `expected ${id} for ${JSON.stringify(target)}`);
  }
});

test('Step 6: player/opponent target relations are engine validated rather than UI inferred', () => {
  const { e, source } = setupTargets();
  const opponentTargets = e.getTargetCandidates('player', { targets: { kind: 'player', player: 'opponent' } }, [], { sourceObject: source });
  assert.deepEqual(opponentTargets.map(item => item.id), ['ai']);
  const selfTargets = e.getTargetCandidates('player', { targets: { kind: 'player', player: 'you' } }, [], { sourceObject: source });
  assert.deepEqual(selfTargets.map(item => item.id), ['player']);
});

test('Step 6: shroud/hexproof/protection apply to targeting but not to non-targeting choices', () => {
  const { e, shroud, source } = setupTargets();
  const targetSpec = { targets: { kind: 'permanent', type: 'Creature', controller: 'opponent' } };
  const targetIds = e.getTargetCandidates('player', targetSpec, [], { sourceObject: source }).map(candidate => candidate.id);
  assert.equal(targetIds.includes(shroud.instanceId), false, 'shroud blocks targeting');

  const request = e._requestChoice({
    requestingPlayer: 'player', choiceType: CHOICE_TYPE.PERMANENTS, min: 1, max: 1,
    prompt: 'Choose a creature (not target)',
    legalOptions: [{ id: shroud.instanceId, value: shroud.instanceId }],
    filter: { type: 'Creature', controller: 'opponent' },
    targeted: false
  });
  const result = e.submitChoice('player', { requestId: request.requestId, selections: [shroud.instanceId] });
  assert.equal(result.ok, true);
});

test('Step 6: engine-native ChoiceRequests are answered through submitChoice and replay the exact response', () => {
  const e = engine();
  let resolved = null;
  const request = e._requestChoice({
    requestingPlayer: 'player', choiceType: CHOICE_TYPE.COLOR, min: 1, max: 1,
    prompt: 'Choose a color', legalOptions: ['white','blue','black','red','green'].map(value => ({ id: value, value, label: value }))
  }, response => { resolved = response; return response.selections[0]; });
  assert.equal(e.getPendingChoiceRequest().requestId, request.requestId);
  assert.throws(() => { e.getPendingChoiceRequest().legalOptions.push({ id: 'x', value: 'x' }); }, /extensible|read only|frozen/i);

  const result = e.submitChoice('player', { requestId: request.requestId, selections: ['blue'] });
  assert.equal(result.ok, true);
  assert.equal(result.result, 'blue');
  assert.deepEqual(resolved.selections, ['blue']);
  assert.equal(e.state.pendingChoice, null);

  const replay = JSON.parse(e.serializeReplay());
  const choiceEntry = replay.actions.at(-1);
  assert.equal(choiceEntry.kind, 'choice');
  assert.equal(choiceEntry.choiceRequest.requestId, request.requestId);
  assert.deepEqual(choiceEntry.action.response.selections, ['blue']);
});

test('Step 6: canonical choice submission revalidates a selected permanent against live state', () => {
  const { e, red } = setupTargets();
  const request = e._requestChoice({
    requestingPlayer: 'player', choiceType: CHOICE_TYPE.PERMANENTS, min: 1, max: 1,
    legalOptions: [{ id: red.instanceId, value: red.instanceId }]
  });
  ZoneManager.move(e.state, red.instanceId, 'graveyard', red.owner, e.db);
  const result = e.submitChoice('player', { requestId: request.requestId, selections: [red.instanceId] });
  assert.equal(result.ok, false);
  assert.match(result.error.message, /no longer on the battlefield/i);
  assert.ok(e.state.pendingChoice, 'failed choice does not consume the request');
});

test('Step 6: canonical target ChoiceResponse is validated again at submission time', () => {
  const { e, red, source } = setupTargets();
  const targetSource = { targets: { kind: 'permanent', type: 'Creature', controller: 'opponent' } };
  const request = e._requestChoice({
    requestingPlayer: 'player', choiceType: CHOICE_TYPE.TARGETS, targeted: true, min: 1, max: 1,
    source: targetSource, sourceObjectId: source.instanceId
  });
  assert.ok(request.legalOptions.some(item => item.value === red.instanceId));
  red.modifiers.keywords.push('hexproof');
  const result = e.submitChoice('player', { requestId: request.requestId, selections: [red.instanceId] });
  assert.equal(result.ok, false);
  assert.match(result.error.message, /hexproof/i);
});

test('Step 6: exact, up-to-N, any-number, ordering, and damage-division constraints are generic', () => {
  const e = engine();
  const requests = [
    createChoiceRequest({ requestId: 'exact', requestingPlayer: 'player', choiceType: CHOICE_TYPE.CARDS, min: 2, max: 2, legalOptions: ['a','b','c'] }),
    createChoiceRequest({ requestId: 'upto', requestingPlayer: 'player', choiceType: CHOICE_TYPE.CARDS, min: 0, max: 2, legalOptions: ['a','b','c'] }),
    createChoiceRequest({ requestId: 'any', requestingPlayer: 'player', choiceType: CHOICE_TYPE.PERMANENTS, min: 0, max: 5, legalOptions: [] }),
    createChoiceRequest({ requestId: 'order', requestingPlayer: 'player', choiceType: CHOICE_TYPE.ORDER, min: 3, max: 3, orderingRequired: true, legalOptions: ['a','b','c'] }),
    createChoiceRequest({ requestId: 'divide', requestingPlayer: 'player', choiceType: CHOICE_TYPE.DIVIDE, min: 2, max: 2, legalOptions: ['a','b'], metadata: { total: 5 } })
  ];
  assert.equal(requests[0].min, requests[0].max);
  assert.equal(requests[1].min, 0);
  assert.equal(requests[2].min, 0);
  assert.equal(requests[3].orderingRequired, true);

  e._requestChoice(requests[4]);
  const bad = e.submitChoice('player', { requestId: 'divide', selections: ['a','b'], division: { a: 2, b: 2 } });
  assert.equal(bad.ok, false);
  assert.match(bad.error.message, /total 5/i);
  const good = e.submitChoice('player', { requestId: 'divide', selections: ['a','b'], division: { a: 2, b: 3 } });
  assert.equal(good.ok, true);
});

test('Step 6: AI answers the same engine-native ChoiceRequest protocol and cannot bypass validation', () => {
  const e = engine();
  const ai = new AIController(e, 'ai');
  const request = e._requestChoice({
    requestingPlayer: 'ai', choiceType: CHOICE_TYPE.MODE, min: 1, max: 1,
    legalOptions: [{ id: 'draw', value: 'draw' }, { id: 'damage', value: 'damage' }]
  });
  const action = ai.choose();
  assert.equal(action.type, 'SUBMIT_CHOICE');
  assert.equal(action.response.requestId, request.requestId);
  const result = e.submitChoice('ai', action);
  assert.equal(result.ok, true);

  const noPending = e.submitChoice('ai', { requestId: request.requestId, selections: ['illegal'] });
  assert.equal(noPending.ok, false);
  assert.equal(noPending.error.code, 'NO_PENDING_CHOICE');
});

test('Step 6: standardized UI component consumes ChoiceRequest data without embedded card rules', () => {
  const component = fs.readFileSync(new URL('../src/components/ChoiceDialog.jsx', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(component, /request\?\.legalOptions/);
  assert.match(component, /requestId/);
  assert.doesNotMatch(component, /hexproof|shroud|protection|manaValue|legend rule/i);
  assert.match(app, /getPendingChoiceRequest\(\)/);
  assert.match(app, /<ChoiceDialog/);
});
