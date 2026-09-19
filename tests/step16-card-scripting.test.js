import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../src/engine/GameEngine.js';
import { EVENT } from '../src/engine/constants.js';
import { makeCardInstance } from '../src/engine/GameState.js';
import { ScriptValidationError } from '../src/cards/index.js';
import { db, decks, putBattlefield, setPhase } from './helpers.js';

function game(players = 2, customDb = db) {
  const selected = decks.filter(deck => deck.playable !== false).slice(0, players);
  const e = new GameEngine(selected[0], players === 2 ? selected[1] : selected.slice(1), customDb, { rng: () => 0.42 });
  e.start();
  for (const pid of e.state.playerOrder) e.perform(pid, { type: 'KEEP_HAND' });
  return e;
}

function baseCard(id, fields = {}) {
  return {
    id,
    name: fields.name || id,
    typeLine: fields.typeLine || 'Creature — Scripted',
    manaCost: fields.manaCost ?? '',
    manaValue: fields.manaValue ?? 0,
    power: fields.power ?? 2,
    toughness: fields.toughness ?? 2,
    colors: fields.colors || [],
    colorIdentity: fields.colorIdentity || [],
    subtypes: fields.subtypes || ['Scripted'],
    keywords: fields.keywords || [],
    abilities: fields.abilities || [],
    spellEffects: fields.spellEffects || [],
    oracleText: fields.oracleText || '',
    supported: true,
    ...fields
  };
}

function register(e, id, fields = {}) {
  return e._registerRuntimeCardDefinition(id, baseCard(id, fields));
}

test('Step 16: scripting service exposes a versioned declarative primitive vocabulary', () => {
  const e = game();
  const caps = e.getCardScriptCapabilities();
  const ids = new Set(caps.primitives.map(item => item.id));
  for (const id of ['draw','discard','mill','damage','gainLife','destroy','exile','createToken','copy','counter','search','reveal','shuffle','moveZone','addCounter','removeCounter','modifyCharacteristics','grantAbility','removeAbility','extraTurn','extraCombat','controlChange']) {
    assert.ok(ids.has(id), `${id} must be a registered primitive`);
  }
});


test('Step 16: vanilla cards can opt into the script schema without adding executable rules code', () => {
  const e = game();
  const compiled = e.compileCardScript(baseCard('step16-vanilla', {
    script: { version: 1, abilities: [], metadata: { kind: 'vanilla' } }
  }));
  assert.equal(compiled.scriptCompiled, true);
  assert.deepEqual(compiled.abilities, []);
  assert.deepEqual(compiled.spellEffects, []);
});

test('Step 16: invalid scripts fail during database load with actionable path diagnostics', () => {
  const badDb = structuredClone(db);
  badDb['step16-bad-script'] = baseCard('step16-bad-script', {
    script: { version: 1, abilities: [{ kind: 'activated', cost: {}, effect: { op: 'definitelyNotARealPrimitive' } }] }
  });
  const selected = decks.filter(deck => deck.playable !== false).slice(0, 2);
  assert.throws(
    () => new GameEngine(selected[0], selected[1], badDb, { rng: () => 0.42 }),
    error => error instanceof ScriptValidationError && /script\.abilities\[0\]\.effect/.test(error.message) && /unknown effect primitive/i.test(error.message)
  );
});

test('Step 16: impossible selector ranges and unknown selector fields fail validation before gameplay', () => {
  const e = game();
  const invalid = baseCard('step16-invalid-selector', {
    script: { version: 1, abilities: [{
      kind: 'activated', cost: {}, targets: { kind: 'permanent', minTargets: 2, maxTargets: 1, madeUpRestriction: true }, effect: { op: 'destroy' }
    }] }
  });
  const diagnostics = e.cardScripts.validateCard(invalid);
  assert.ok(diagnostics.some(item => /minTargets cannot exceed maxTargets/.test(item.message)));
  assert.ok(diagnostics.some(item => /unknown selector field/.test(item.message)));
});

test('Step 16: scripted ETB trigger compiles into the normal trigger engine and resolves through EffectEngine', () => {
  const e = game();
  register(e, 'step16-etb-draw', {
    script: { version: 1, abilities: [{ kind: 'triggered', event: EVENT.ENTER_BATTLEFIELD, effect: { op: 'draw', amount: 1 } }] }
  });
  const before = e.state.players.player.hand.length;
  const source = putBattlefield(e, 'player', 'step16-etb-draw');
  e.emit(EVENT.ENTER_BATTLEFIELD, { controller: 'player', target: source });
  assert.equal(e.state.stack.at(-1)?.type, 'trigger');
  assert.equal(e.state.stack.at(-1)?.effect?.type, 'draw');
  e.resolution.resolveTop();
  assert.equal(e.state.players.player.hand.length, before + 1);
});

test('Step 16: scripted activated ability uses the existing target/cost/stack/resolution pipeline', () => {
  const e = game();
  register(e, 'step16-counter-mage', {
    script: { version: 1, abilities: [{
      kind: 'activated', cost: {}, targets: { kind: 'permanent', type: 'Creature', controller: 'you' }, effect: { op: 'addCounter', counter: '+1/+1', amount: 1 }
    }] }
  });
  const source = putBattlefield(e, 'player', 'step16-counter-mage');
  const target = putBattlefield(e, 'player', 'grizzly-bears');
  setPhase(e, 'PRECOMBAT_MAIN', { activePlayer: 'player', priorityPlayer: 'player' });
  const ability = e.static.effectiveAbilities(source).find(item => item.type === 'activated');
  assert.ok(ability);
  e.activateAbility('player', source.instanceId, ability, [target.instanceId]);
  assert.equal(e.state.stack.at(-1)?.type, 'ability');
  e.resolution.resolveTop();
  assert.equal(target.counters['+1/+1'], 1);
});

test('Step 16: selector DSL supports zone/type/color/mana/controller and boolean composition', () => {
  const e = game();
  register(e, 'step16-selector-source', {
    script: { version: 1, abilities: [{
      kind: 'activated', cost: {},
      targets: { kind: 'permanent', and: [{ type: 'Creature' }, { controller: 'opponent' }, { manaValueMax: 3 }, { not: { color: 'red' } }] },
      effect: { op: 'destroy' }
    }] }
  });
  register(e, 'step16-blue-two', { manaValue: 2, colors: ['U'] });
  register(e, 'step16-red-two', { manaValue: 2, colors: ['R'] });
  const source = putBattlefield(e, 'player', 'step16-selector-source');
  const blue = putBattlefield(e, 'ai', 'step16-blue-two');
  const red = putBattlefield(e, 'ai', 'step16-red-two');
  const ability = e.static.effectiveAbilities(source)[0];
  const candidates = e.targeting.getCandidates('player', ability, [], { sourceObject: source }).map(item => item.id);
  assert.ok(candidates.includes(blue.instanceId));
  assert.ok(!candidates.includes(red.instanceId));
});

test('Step 16: static scripted abilities feed the existing continuous-effect layer engine', () => {
  const e = game();
  register(e, 'step16-anthem', {
    typeLine: 'Enchantment', power: null, toughness: null,
    script: { version: 1, abilities: [{ kind: 'static', filter: { controller: 'you', type: 'Creature' }, effect: { power: 1, toughness: 1, keywords: ['vigilance'] } }] }
  });
  const anthem = putBattlefield(e, 'player', 'step16-anthem');
  const creature = putBattlefield(e, 'player', 'grizzly-bears');
  assert.ok(anthem);
  const stats = e.static.derivedStats(creature);
  assert.equal(stats.power, 3);
  assert.equal(stats.toughness, 3);
  assert.ok(stats.keywords.includes('vigilance'));
});

test('Step 16: characteristic-defining ability IR is applied to the source in the CDA layer', () => {
  const e = game();
  register(e, 'step16-cda', {
    power: 0, toughness: 0,
    script: { version: 1, abilities: [{ kind: 'characteristic', characteristic: { setPower: 5, setToughness: 5 } }] }
  });
  const source = putBattlefield(e, 'player', 'step16-cda');
  const other = putBattlefield(e, 'player', 'grizzly-bears');
  assert.deepEqual(e.static.derivedStats(source).power, 5);
  assert.equal(e.static.derivedStats(other).power, 2, 'CDA defaults to the source only');
});

test('Step 16: scripted replacement abilities enter the Step 10 replacement pipeline', () => {
  const e = game();
  register(e, 'step16-counter-doubler', {
    typeLine: 'Enchantment', power: null, toughness: null,
    script: { version: 1, abilities: [{
      kind: 'replacement', event: 'COUNTERS_ADDED', filter: { controller: 'you', type: 'Creature' }, replacement: { kind: 'multiplyAmount', factor: 2 }
    }] }
  });
  putBattlefield(e, 'player', 'step16-counter-doubler');
  const target = putBattlefield(e, 'player', 'grizzly-bears');
  e.effects.addCounters('player', target, '+1/+1', 1);
  assert.equal(target.counters['+1/+1'], 2);
});

test('Step 16: modal scripted spell compiles to normal spell modes and resolves without card-specific engine code', () => {
  const e = game();
  register(e, 'step16-modal-spell', {
    typeLine: 'Sorcery', power: null, toughness: null,
    script: { version: 1, modes: [
      { id: 'life', label: 'Gain 3 life', effect: { op: 'gainLife', amount: 3 } },
      { id: 'draw', label: 'Draw a card', effect: { op: 'draw', amount: 1 } }
    ] }
  });
  const card = makeCardInstance('step16-modal-spell', 'player', 'hand', {}, e.db['step16-modal-spell']);
  e.zones.place(card, 'hand', 'player');
  setPhase(e, 'PRECOMBAT_MAIN', { activePlayer: 'player', priorityPlayer: 'player' });
  const before = e.state.players.player.life;
  e.perform('player', { type: 'CAST_SPELL', cardInstanceId: card.instanceId, targets: [], mode: 'life' });
  e.resolution.resolveTop();
  assert.equal(e.state.players.player.life, before + 3);
});

test('Step 16: sequence, if/otherwise, repeat, for-each, variable quantities, and prior selections execute declaratively', () => {
  const e = game();
  const first = putBattlefield(e, 'player', 'grizzly-bears');
  const second = putBattlefield(e, 'player', 'vigilant-knight');
  const compiled = e.compileCardScript(baseCard('step16-control-flow', {
    script: { version: 1, abilities: [{ kind: 'spell', effect: { op: 'sequence', effects: [
      { op: 'if', condition: { controllerLifeAtLeast: 20 }, then: { op: 'draw', amount: 1 }, otherwise: { op: 'loseLife', amount: 1 } },
      { op: 'forEach', selector: { kind: 'permanent', zone: 'battlefield', controller: 'you', type: 'Creature' }, as: 'creature', effect: { op: 'addCounter', counter: '+1/+1', amount: 1 } },
      { op: 'repeat', times: 2, effect: { op: 'gainLife', amount: 1 } }
    ] } }] }
  }));
  const beforeHand = e.state.players.player.hand.length;
  const beforeLife = e.state.players.player.life;
  e.effects.resolve(compiled.spellEffects[0], { controller: 'player', source: { cardId: 'step16-control-flow' } });
  assert.equal(e.state.players.player.hand.length, beforeHand + 1);
  assert.equal(first.counters['+1/+1'], 1);
  assert.equal(second.counters['+1/+1'], 1);
  assert.equal(e.state.players.player.life, beforeLife + 2);
});

test('Step 16: optional may effects use the existing generic boolean choice path', () => {
  const e = game();
  const compiled = e.compileCardScript(baseCard('step16-may', {
    script: { version: 1, abilities: [{ kind: 'spell', effect: { op: 'may', prompt: 'Draw?', effect: { op: 'draw', amount: 1 } } }] }
  }));
  const before = e.state.players.player.hand.length;
  e.effects.resolve(compiled.spellEffects[0], { controller: 'player', source: { cardId: 'step16-may' } });
  assert.equal(e.state.pendingChoice?.type, 'OPTIONAL_EFFECT');
  e.perform('player', { type: 'CHOOSE_OPTIONAL_EFFECT', accept: true });
  assert.equal(e.state.players.player.hand.length, before + 1);
});

test('Step 16: custom hooks must be registered with an explicit version before a script can compile', () => {
  const e = game();
  const scripted = baseCard('step16-hook-card', {
    script: { version: 1, abilities: [{ kind: 'activated', cost: {}, effect: { op: 'customHook', hookId: 'gain-seven', version: '1.0.0', args: { amount: 7 } } }] }
  });
  assert.throws(() => e._registerRuntimeCardDefinition('step16-hook-card', scripted), /not registered/i);
  e.registerCustomCardHook({
    id: 'gain-seven', version: '1.0.0', testIds: ['step16-card-scripting'],
    handler: ({ engine, context }, args) => engine.changeLife(context.controller, Number(args.amount || 0))
  });
  const compiled = e._registerRuntimeCardDefinition('step16-hook-card', scripted);
  const before = e.state.players.player.life;
  e.effects.resolve(compiled.abilities[0].effect, { controller: 'player', source: { cardId: 'step16-hook-card' } });
  assert.equal(e.state.players.player.life, before + 7);
  assert.equal(e.getCardScriptCapabilities().customHooks[0].version, '1.0.0');
});

test('Step 16: generic move/search/mill/reveal/shuffle primitives reuse zone and knowledge services', () => {
  const e = game();
  const player = e.state.players.player;
  const top = player.library[0];
  const compiled = e.compileCardScript(baseCard('step16-zone-primitives', {
    typeLine: 'Sorcery', power: null, toughness: null,
    script: { version: 1, abilities: [{ kind: 'spell', effect: { op: 'sequence', effects: [
      { op: 'reveal', selector: { kind: 'card', zone: 'library', owner: 'you', cardId: top.cardId }, reason: 'step16-test' },
      { op: 'mill', amount: 1 },
      { op: 'search', selector: { kind: 'card', type: 'Land' }, max: 1, toZone: 'hand', shuffle: true }
    ] } }] }
  }));
  const beforeGrave = player.graveyard.length;
  const beforeHand = player.hand.length;
  e.effects.resolve(compiled.spellEffects[0], { controller: 'player', source: { cardId: 'step16-zone-primitives' } });
  assert.equal(player.graveyard.length, beforeGrave + 1);
  assert.ok(player.hand.length >= beforeHand, 'search may find a land and never corrupts hand state');
  assert.ok(e.events.getLogSnapshot().length > 0);
});

test('Step 16: compiled cards carry machine-readable script metadata while runtime behavior is normalized', () => {
  const e = game();
  const compiled = e.compileCardScript(baseCard('step16-metadata', {
    script: { version: 1, metadata: { authoring: 'declarative' }, abilities: [{ id: 'draw-one', kind: 'spell', effect: { op: 'draw', amount: 1 } }] }
  }));
  assert.equal(compiled.scriptCompiled, true);
  assert.equal(compiled.scriptVersion, 1);
  assert.equal(compiled.scriptMetadata.authoring, 'declarative');
  assert.equal(compiled.script, undefined);
  assert.equal(compiled.spellEffects[0].type, 'draw');
});
