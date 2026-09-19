import test from 'node:test';
import assert from 'node:assert/strict';
import { engine, putBattlefield, db } from './helpers.js';
import { ENGINE_EVENT } from '../src/engine/events/index.js';
import { normalizeSearchRequest, filterHasStatedQuality } from '../src/engine/library/index.js';

function cardId(name) { return Object.values(db).find(def => def.name === name)?.id; }
function setTop(e, pid, ids) {
  const library = e.state.players[pid].library;
  for (let i = 0; i < ids.length; i++) library[i].cardId = ids[i];
  return library.slice(0, ids.length);
}

const FOREST = cardId('Forest');
const ISLAND = cardId('Island');
const BEARS = cardId('Grizzly Bears');
const DIVINATION = cardId('Divination');
const MURDER = cardId('Murder');
const SISAY = cardId('Sisay, Weatherlight Captain');

test('Step 27: SearchRequest distinguishes stated qualities for fail-to-find rules', () => {
  assert.equal(filterHasStatedQuality({ type:'Land' }), true);
  assert.equal(filterHasStatedQuality({}), false);
  assert.equal(normalizeSearchRequest({ playerId:'player', filter:{ type:'Land' } }).allowFailToFind, true);
  assert.equal(normalizeSearchRequest({ playerId:'player', filter:{} }).allowFailToFind, false);
});

test('Step 27: restricted hidden-zone searches may fail to find even when a matching card exists', () => {
  const e = engine();
  setTop(e, 'player', [FOREST, ISLAND]);
  const choice = e.libraryOps.beginSearch({ searchingPlayerId:'player', filter:{ type:'Land' }, minCount:1, maxCount:1, destination:'hand' });
  assert.equal(choice.type, 'LIBRARY_SEARCH');
  assert.equal(choice.min, 0);
  const before = e.state.players.player.hand.length;
  e.perform('player', { type:'CHOOSE_LIBRARY_SEARCH', cardInstanceIds:[] });
  assert.equal(e.state.players.player.hand.length, before);
  assert.equal(e.state.pendingChoice, null);
});

test('Step 27: unrestricted searches require the available exact count', () => {
  const e = engine();
  const choice = e.libraryOps.beginSearch({ searchingPlayerId:'player', filter:{}, minCount:1, maxCount:1, destination:'hand', shuffleAfter:false });
  assert.equal(choice.min, 1);
  assert.throws(() => e.perform('player', { type:'CHOOSE_LIBRARY_SEARCH', cardInstanceIds:[] }), /between 1 and 1/i);
});

test('Step 27: search locks block the search before selection or card movement', () => {
  const e = engine();
  e.db['step27-search-lock'] = { id:'step27-search-lock', name:'Search Lock', typeLine:'Artifact', oracleText:"Players can't search libraries." };
  putBattlefield(e, 'ai', 'step27-search-lock');
  const top = e.state.players.player.library[0].instanceId;
  const result = e.libraryOps.beginSearch({ searchingPlayerId:'player', filter:{ type:'Land' }, maxCount:1 });
  assert.equal(result.prevented, true);
  assert.equal(e.state.pendingChoice, null);
  assert.equal(e.state.players.player.library[0].instanceId, top);
});

test('Step 27: SEARCH replacement effects change search scope before candidate selection', () => {
  const e = engine();
  setTop(e, 'player', [BEARS, BEARS, FOREST]);
  e.replacements.register({
    id:'step27-search-top-two', eventTypes:ENGINE_EVENT.SEARCH, affectedPlayer:()=>'player',
    transform:event => ({ ...event, payload:{ ...event.payload, scopeTop:2 } })
  });
  const result = e.libraryOps.beginSearch({ searchingPlayerId:'player', filter:{ type:'Land' }, maxCount:1, shuffleAfter:false });
  assert.equal(result.completed, true);
  assert.equal(result.result.selectedIds.length, 0);
});

test('Step 27: Aven Mindcensor-style text restricts opponent searches to the top four cards', () => {
  const e = engine();
  e.db['step27-mindcensor'] = { id:'step27-mindcensor', name:'Mindcensor', typeLine:'Creature — Bird Wizard', oracleText:'If an opponent would search a library, that player searches the top four cards of that library instead.' };
  putBattlefield(e, 'ai', 'step27-mindcensor');
  setTop(e, 'player', [BEARS, BEARS, BEARS, BEARS, FOREST]);
  const result = e.libraryOps.beginSearch({ searchingPlayerId:'player', filter:{ type:'Land' }, maxCount:1, shuffleAfter:false });
  assert.equal(result.completed, true);
  assert.equal(result.request.scopeTop, 4);
  assert.deepEqual(result.result.selectedIds, []);
});

test('Step 27: Opposition Agent-style text transfers the search choice to the opposing controller', () => {
  const e = engine();
  e.db['step27-agent'] = { id:'step27-agent', name:'Search Controller', typeLine:'Creature — Human Rogue', oracleText:"You control your opponents while they're searching their libraries." };
  putBattlefield(e, 'ai', 'step27-agent');
  setTop(e, 'player', [FOREST]);
  const choice = e.libraryOps.beginSearch({ searchingPlayerId:'player', filter:{ type:'Land' }, maxCount:1, shuffleAfter:false });
  assert.equal(choice.playerId, 'ai');
  assert.equal(choice.searchingPlayerId, 'player');
  assert.equal(e.state.priorityPlayer, 'ai');
});

test('Step 27: only the authorized search chooser sees library search candidates', () => {
  const e = engine();
  setTop(e, 'player', [FOREST]);
  const choice = e.libraryOps.beginSearch({ searchingPlayerId:'player', filter:{ type:'Land' }, maxCount:1, shuffleAfter:false });
  const chosen = choice.candidateIds[0];
  const playerView = e.getPlayerStateSnapshot('player');
  const aiView = e.getPlayerStateSnapshot('ai');
  assert.ok(playerView.players.player.library.some(card => card.instanceId === chosen && card.cardId));
  assert.ok(aiView.players.player.library.every(card => card.instanceId !== chosen));
  assert.equal(aiView.pendingChoice.private, true);
});

test('Step 27: resolving a search can reveal, move, and shuffle through authoritative zone/event paths', () => {
  const e = engine();
  const [top] = setTop(e, 'player', [FOREST]);
  const choice = e.libraryOps.beginSearch({ searchingPlayerId:'player', filter:{ type:'Land' }, maxCount:1, destination:'hand', revealFound:true, shuffleAfter:true });
  e.perform('player', { type:'CHOOSE_LIBRARY_SEARCH', cardInstanceIds:[choice.candidateIds[0]] });
  assert.ok(e.state.players.player.hand.some(card => card.instanceId === top.instanceId));
  assert.ok(e.events.getLogSnapshot().some(row => row.type === ENGINE_EVENT.SEARCH && row.status === 'committed'));
  assert.ok(e.events.getLogSnapshot().some(row => row.type === ENGINE_EVENT.SHUFFLE && row.status === 'committed'));
});

test('Step 27: look is private, reveal is public, and shuffle clears library knowledge', () => {
  const e = engine();
  const [top] = setTop(e, 'player', [DIVINATION]);
  e.libraryOps.lookTop('player', 1, { viewerId:'player' });
  assert.equal(e.knownInformation.isKnown('player', top), true);
  assert.equal(e.knownInformation.isKnown('ai', top), false);
  e.libraryOps.revealTop('player', 1);
  assert.equal(e.knownInformation.isKnown('ai', top), true);
  e.shuffleLibrary('player', 'step27-test');
  assert.equal(e.knownInformation.isKnown('player', top), false);
  assert.equal(e.knownInformation.isKnown('ai', top), false);
});

test('Step 27: top-N reorder and bottom operations preserve a legal library permutation', () => {
  const e = engine();
  const top = setTop(e, 'player', [FOREST, ISLAND, DIVINATION]);
  e.libraryOps.reorderTop('player', [top[2].instanceId, top[0].instanceId, top[1].instanceId]);
  assert.deepEqual(e.state.players.player.library.slice(0,3).map(c=>c.instanceId), [top[2].instanceId, top[0].instanceId, top[1].instanceId]);
  e.libraryOps.putOnBottom('player', [top[2].instanceId], { knownTo:['player'] });
  assert.equal(e.state.players.player.library.at(-1).instanceId, top[2].instanceId);
});

test('Step 27: scry and surveil share top-N knowledge/reorder primitives', () => {
  const e = engine();
  const top = setTop(e, 'player', [FOREST, DIVINATION, MURDER]);
  e.libraryOps.scry('player', 2, { bottomIds:[top[0].instanceId], topOrder:[top[1].instanceId] });
  assert.equal(e.state.players.player.library[0].instanceId, top[1].instanceId);
  assert.equal(e.state.players.player.library.at(-1).instanceId, top[0].instanceId);
  const next = e.state.players.player.library.slice(0,2);
  e.libraryOps.surveil('player', 2, { graveyardIds:[next[0].instanceId], topOrder:[next[1].instanceId] });
  assert.ok(e.state.players.player.graveyard.some(card => card.instanceId === next[0].instanceId));
  assert.equal(e.state.players.player.library[0].instanceId, next[1].instanceId);
});

test('Step 27: cascade uses shared top iteration, stops on lower-mana nonland, and bottoms the rest', () => {
  const e = engine();
  const top = setTop(e, 'player', [FOREST, DIVINATION, MURDER]);
  const result = e.libraryOps.cascade('player', 4);
  assert.equal(result.hit.instanceId, top[1].instanceId);
  assert.equal(e.zones.find(top[1].instanceId).zone, 'exile');
  assert.equal(e.state.players.player.library.at(-1).instanceId, top[0].instanceId);
  assert.ok(e.state.castingPermissions.some(p => p.cardInstanceId === top[1].instanceId && p.freeCast));
});

test('Step 27: discover uses <= mana value and the same exile/permission/bottom primitives', () => {
  const e = engine();
  const top = setTop(e, 'player', [FOREST, MURDER, DIVINATION]);
  const result = e.libraryOps.discover('player', 3);
  assert.equal(result.hit.instanceId, top[1].instanceId);
  assert.equal(e.zones.find(top[1].instanceId).zone, 'exile');
  assert.ok(e.state.castingPermissions.some(p => p.cardInstanceId === top[1].instanceId && p.discoverValue === 3));
});

test('Step 27: scripted searches now route through the shared search event/service', () => {
  const e = engine();
  setTop(e, 'player', [FOREST]);
  const before = e.events.getLogSnapshot().filter(row => row.type === ENGINE_EVENT.SEARCH).length;
  e.cardScripts.runtime.search({ selector:{ type:'Land' }, max:1, toZone:'hand', shuffle:false }, { controller:'player' });
  const after = e.events.getLogSnapshot().filter(row => row.type === ENGINE_EVENT.SEARCH).length;
  assert.equal(after, before + 1);
});

test('Step 27: destination plans support Cultivate-style split search destinations', () => {
  const e = engine();
  const top = setTop(e, 'player', [FOREST, ISLAND]);
  const result = e.libraryOps.searchImmediate({
    searchingPlayerId:'player', filter:{ basic:true, type:'Land' }, minCount:0, maxCount:2,
    destinationPlan:[{ zone:'battlefield', tapped:true }, { zone:'hand' }], revealFound:true, shuffleAfter:false
  }, top.map(c=>c.instanceId));
  assert.equal(result.selectedIds.length, 2);
  assert.ok(e.state.players.player.battlefield.some(c => c.instanceId === top[0].instanceId && c.tapped));
  assert.ok(e.state.players.player.hand.some(c => c.instanceId === top[1].instanceId));
});

test('Step 27: legendary permanent tutor filters can use boolean-composed search qualities', () => {
  const e = engine();
  const top = setTop(e, 'player', [SISAY, DIVINATION]);
  const choice = e.libraryOps.beginSearch({ searchingPlayerId:'player', filter:{ and:[{ legendary:true }, { not:{ type:'Instant' } }, { not:{ type:'Sorcery' } }] }, maxCount:1, destination:'battlefield', shuffleAfter:false });
  assert.ok(choice.candidateIds.includes(top[0].instanceId));
  assert.ok(!choice.candidateIds.includes(top[1].instanceId));
});
