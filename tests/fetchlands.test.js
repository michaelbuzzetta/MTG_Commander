import test from 'node:test';
import assert from 'node:assert/strict';
import { engine, putBattlefield, setPhase, db } from './helpers.js';
import { makeCardInstance } from '../src/engine/GameState.js';
import { normalizeFetchedCard } from '../src/utils/deckImport.js';

test('classic fetch lands pay life, sacrifice, search by land subtype, and shuffle', () => {
  const e = engine('explorers', 'blech');
  setPhase(e, 'PRECOMBAT_MAIN', { activePlayer: 'player', priorityPlayer: 'player' });
  e.state.players.player.life = 40;

  const mesa = putBattlefield(e, 'player', 'arch-arid-mesa');
  const bloodCrypt = makeCardInstance('user-blood-crypt', 'player', 'library');
  e.state.players.player.library.unshift(bloodCrypt);
  const ability = e.db['arch-arid-mesa'].abilities.find(a => a.effect?.type === 'searchLand');

  assert.ok(ability, 'Arid Mesa should expose a fetch ability');
  assert.deepEqual(ability.effect.landTypes, ['Plains', 'Mountain']);
  assert.equal(e.db['arch-arid-mesa'].abilities.some(a => a.type === 'mana'), false, 'Arid Mesa must not have a fake colorless mana ability');

  e.perform('player', { type: 'ACTIVATE_ABILITY', permanentId: mesa.instanceId, ability });
  assert.equal(e.state.players.player.life, 39, 'paying 1 life is an activation cost');
  assert.equal(e.findPermanent(mesa.instanceId), null, 'the fetch land is sacrificed as an activation cost');
  assert.ok(e.state.players.player.graveyard.some(card => card.instanceId === mesa.instanceId));
  assert.equal(e.state.stack.length, 1, 'the search ability uses the stack');

  e.perform('player', { type: 'PASS_PRIORITY' });
  e.perform('ai', { type: 'PASS_PRIORITY' });

  const choice = e.state.pendingChoice;
  assert.equal(choice?.type, 'EFFECT_CARD_CHOICE');
  assert.ok(choice.candidateIds.includes(bloodCrypt.instanceId), 'a nonbasic Mountain such as Blood Crypt is a legal Arid Mesa result');

  e.perform('player', { type: 'CHOOSE_EFFECT_CARDS', cardInstanceIds: [bloodCrypt.instanceId] });
  assert.equal(e.state.pendingChoice?.type, 'ENTRY_LIFE_PAYMENT', 'a fetched shockland should still ask whether to pay life');
  assert.equal(e.state.pendingChoice?.lifeCost, 2);
  e.perform('player', { type: 'CHOOSE_ENTRY_LIFE_PAYMENT', pay: true });

  const fetched = e.findPermanent(bloodCrypt.instanceId);
  assert.ok(fetched, 'chosen land should enter the battlefield after its entry choice resolves');
  assert.equal(fetched.cardId, 'user-blood-crypt');
  assert.equal(fetched.tapped, false, 'paying the shockland life cost should let it enter untapped');
  assert.equal(e.state.players.player.life, 37, 'fetch activation plus shockland payment should cost 3 life total');
  assert.equal(e.state.players.player.library.some(card => card.instanceId === bloodCrypt.instanceId), false);
});

test('Scryfall normalization recognizes fetch lands and does not invent a mana ability', () => {
  const normalized = normalizeFetchedCard({
    id: 'fetch-test', oracle_id: 'fetch-oracle', name: 'Test Fetch', type_line: 'Land', cmc: 0,
    colors: [], color_identity: [], keywords: [], legalities: { commander: 'legal' },
    oracle_text: '{T}, Pay 1 life, Sacrifice this land: Search your library for an Island or Swamp card, put it onto the battlefield, then shuffle.'
  });
  assert.equal(normalized.abilities.some(a => a.type === 'mana'), false);
  const fetch = normalized.abilities.find(a => a.effect?.type === 'searchLand');
  assert.ok(fetch);
  assert.equal(fetch.tap, true);
  assert.deepEqual(fetch.cost, { life: 1, sacrificeSelf: true });
  assert.deepEqual(fetch.effect.landTypes, ['Island', 'Swamp']);
});

test('landcycling reminder text is not misread as a battlefield fetch ability', () => {
  const normalized = normalizeFetchedCard({
    id: 'ash-test', oracle_id: 'ash-oracle', name: 'Ash Barrens', type_line: 'Land', cmc: 0,
    colors: [], color_identity: [], keywords: [], legalities: { commander: 'legal' },
    oracle_text: '{T}: Add {C}.\nBasic landcycling {1} ({1}, Discard this card: Search your library for a basic land card, reveal it, put it into your hand, then shuffle.)'
  });
  assert.equal(normalized.abilities.filter(a => a.type === 'mana').length, 1);
  assert.equal(normalized.abilities.some(a => a.effect?.type === 'searchLand'), false);
});
