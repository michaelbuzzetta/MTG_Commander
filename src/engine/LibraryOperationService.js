import { ENGINE_EVENT } from '../events/EventTypes.js';
import { LEGALITY_OPERATION } from '../legality/index.js';
import { isType, hasSubtype } from './utils.js';
import { normalizeSearchRequest } from './SearchRequest.js';

const NUMBER_WORDS = Object.freeze({ one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10 });

function manaValue(definition = {}) {
  return Number(definition.manaValue ?? definition.cmc ?? 0) || 0;
}

function colorsOf(definition = {}) {
  const explicit = definition.colors || definition.colorIdentity || [];
  return new Set((Array.isArray(explicit) ? explicit : String(explicit).split('')).map(x => String(x).toUpperCase()));
}

export function matchesLibraryFilter(engine, card, filter = {}) {
  if (!card) return false;
  const definition = engine.copy?.definitionForObject(card) || engine.db[card.cardId] || {};
  if (Array.isArray(filter.and) && !filter.and.every(item => matchesLibraryFilter(engine, card, item))) return false;
  if (Array.isArray(filter.or) && filter.or.length && !filter.or.some(item => matchesLibraryFilter(engine, card, item))) return false;
  if (filter.not && matchesLibraryFilter(engine, card, filter.not)) return false;
  if (filter.cardId && card.cardId !== filter.cardId && definition.id !== filter.cardId) return false;
  if (Array.isArray(filter.cardIds) && filter.cardIds.length && !filter.cardIds.includes(card.cardId) && !filter.cardIds.includes(definition.id)) return false;
  if (filter.cardName && String(definition.name || '').toLowerCase() !== String(filter.cardName).toLowerCase()) return false;
  if (filter.type && !isType(definition, filter.type)) return false;
  if (Array.isArray(filter.types) && filter.types.length && !filter.types.some(type => isType(definition, type))) return false;
  if (filter.subtype && !hasSubtype(definition, filter.subtype)) return false;
  if (Array.isArray(filter.subtypes) && filter.subtypes.length && !filter.subtypes.some(type => hasSubtype(definition, type))) return false;
  if (filter.land && !isType(definition, 'Land')) return false;
  if (filter.nonland && isType(definition, 'Land')) return false;
  if (filter.basic && !/\bBasic\b/i.test(definition.typeLine || '')) return false;
  if (filter.nonbasic && /\bBasic\b/i.test(definition.typeLine || '')) return false;
  if (filter.legendary && !/\bLegendary\b/i.test(definition.typeLine || '')) return false;
  const mv = manaValue(definition);
  if (filter.manaValue != null && mv !== Number(filter.manaValue)) return false;
  if (filter.minManaValue != null && mv < Number(filter.minManaValue)) return false;
  if (filter.maxManaValue != null && mv > Number(filter.maxManaValue)) return false;
  const colors = colorsOf(definition);
  if (filter.color && !colors.has(String(filter.color).toUpperCase())) return false;
  if (Array.isArray(filter.colors) && filter.colors.length && !filter.colors.every(color => colors.has(String(color).toUpperCase()))) return false;
  return true;
}

export class LibraryOperationService {
  constructor(engine) {
    this.engine = engine;
    this.sequence = 0;
    this.ensureState();
  }

  ensureState() {
    this.engine.state.libraryOperations ||= { history: [] };
    this.engine.state.castingPermissions ||= [];
    return this.engine.state.libraryOperations;
  }

  _record(type, data = {}) {
    const row = { id: `library-op-${++this.sequence}`, type, turn: this.engine.state.turn, phase: this.engine.state.phase, ...structuredClone(data) };
    const history = this.ensureState().history;
    history.push(row);
    if (history.length > 256) history.splice(0, history.length - 256);
    this.engine.log(`LIBRARY_${type}`, data);
    return row;
  }

  _definition(card) { return this.engine.copy?.definitionForObject(card) || this.engine.db[card?.cardId] || {}; }

  _battlefieldSearchModifiers(request) {
    let next = { ...request };
    for (const player of Object.values(this.engine.state.players || {})) {
      for (const permanent of player.battlefield || []) {
        if (permanent.phasedOut) continue;
        const text = String(this._definition(permanent).oracleText || '');
        const isOpponent = this.engine.multiplayer?.matches
          ? this.engine.multiplayer.matches('opponent', request.searchingPlayerId, { actorPlayerId: permanent.controller })
          : permanent.controller !== request.searchingPlayerId;
        if (!isOpponent) continue;
        const scope = text.match(/opponent[^.]*search(?:es)? (?:a|their) library[^.]*instead searches? (?:only )?the top (\d+|one|two|three|four|five|six|seven|eight|nine|ten) cards?/i)
          || text.match(/opponent[^.]*search(?:es)? (?:a|their) library[^.]*search(?:es)? the top (\d+|one|two|three|four|five|six|seven|eight|nine|ten) cards?/i);
        if (scope) {
          const raw = String(scope[1]).toLowerCase();
          const n = /^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS[raw];
          if (n != null) next.scopeTop = next.scopeTop == null ? n : Math.min(next.scopeTop, n);
        }
        if (/you control your opponents while they(?:'|’)re searching their libraries/i.test(text)) {
          next.chooserPlayerId = permanent.controller;
          next.metadata = { ...(next.metadata || {}), controlledSearchBy: permanent.instanceId };
        }
      }
    }
    return next;
  }

  _prepareSearch(rawRequest) {
    let request = normalizeSearchRequest(rawRequest);
    const transformed = this.engine.events.dispatch(ENGINE_EVENT.SEARCH, {
      ...structuredClone(request),
      playerId: request.searchingPlayerId,
      returnTransformedRequest: true
    }, { cause: request.reason, stabilize: false });
    if (!transformed || transformed === false) return { prevented: true, request };
    request = normalizeSearchRequest({ ...request, ...transformed, searchingPlayerId: transformed.searchingPlayerId || transformed.playerId || request.searchingPlayerId });
    request = normalizeSearchRequest(this._battlefieldSearchModifiers(request));
    return { prevented: false, request };
  }

  _scopeCards(request) {
    const library = this.engine.state.players[request.libraryOwnerId]?.library;
    if (!library) throw new Error(`Unknown library owner ${request.libraryOwnerId}`);
    return request.scopeTop == null ? [...library] : library.slice(0, request.scopeTop);
  }

  candidates(request) {
    return this._scopeCards(request).filter(card => matchesLibraryFilter(this.engine, card, request.filter));
  }

  prepareSearch(rawRequest) {
    const prepared = this._prepareSearch(rawRequest);
    if (prepared.prevented) return prepared;
    const request = prepared.request;
    const scopeCards = this._scopeCards(request);
    const candidates = scopeCards.filter(card => matchesLibraryFilter(this.engine, card, request.filter));
    for (const card of scopeCards) this.engine.knownInformation.look(request.chooserPlayerId, card, { reason: request.reason, position: 'search-scope' });
    return { prevented: false, request, scopeCards, candidates };
  }

  finishPreparedSearch(rawRequest, selectedIds = []) {
    const request = normalizeSearchRequest(rawRequest);
    const candidates = this.candidates(request);
    const required = request.allowFailToFind ? 0 : Math.min(request.minCount, candidates.length);
    const max = Math.min(request.maxCount, candidates.length);
    const synthetic = { type:'LIBRARY_SEARCH', min: required, max, candidateIds: candidates.map(card => card.instanceId), libraryOwnerId: request.libraryOwnerId, request };
    this.validateSearchChoice(synthetic, selectedIds);
    return this._finishSearch(request, selectedIds);
  }

  beginSearch(rawRequest) {
    if (this.engine.state.pendingChoice) throw new Error('Cannot begin a library search while another choice is pending');
    const prepared = this.prepareSearch(rawRequest);
    if (prepared.prevented) return prepared;
    const { request, scopeCards, candidates } = prepared;
    const required = request.allowFailToFind ? 0 : Math.min(request.minCount, candidates.length);
    const max = Math.min(request.maxCount, candidates.length);
    if (max === 0 || (request.optional && candidates.length === 0)) {
      const result = this._finishSearch(request, []);
      return { request, candidates: [], completed: true, result };
    }
    const id = request.id || `search-${++this.sequence}`;
    this.engine.state.pendingChoice = {
      type: 'LIBRARY_SEARCH',
      playerId: request.chooserPlayerId,
      searchId: id,
      searchingPlayerId: request.searchingPlayerId,
      libraryOwnerId: request.libraryOwnerId,
      candidateIds: candidates.map(card => card.instanceId),
      min: required,
      max,
      allowFailToFind: request.allowFailToFind,
      request: structuredClone({ ...request, id }),
      prompt: request.metadata?.prompt || 'Choose cards from the library',
      resume: this.engine.state.phase === 'CLEANUP' ? 'CLEANUP' : 'PRIORITY'
    };
    this.engine.state.priorityPlayer = request.chooserPlayerId;
    this._record('SEARCH_BEGIN', { searchId: id, searchingPlayerId: request.searchingPlayerId, chooserPlayerId: request.chooserPlayerId, libraryOwnerId: request.libraryOwnerId, candidateCount: candidates.length, scopeCount: scopeCards.length, min: required, max });
    return this.engine.state.pendingChoice;
  }

  validateSearchChoice(choice, selectedIds = []) {
    if (!choice || choice.type !== 'LIBRARY_SEARCH') throw new Error('No library search choice is pending');
    if (!Array.isArray(selectedIds) || new Set(selectedIds).size !== selectedIds.length) throw new Error('Library search choices must be unique');
    if (selectedIds.length < Number(choice.min || 0) || selectedIds.length > Number(choice.max || 0)) throw new Error(`Choose between ${choice.min} and ${choice.max} cards`);
    const allowed = new Set(choice.candidateIds || []);
    if (selectedIds.some(id => !allowed.has(id))) throw new Error('Selected card is not a legal search result');
    for (const id of selectedIds) {
      const found = this.engine.zones.find(id);
      if (!found || found.zone !== 'library' || found.playerId !== choice.libraryOwnerId) throw new Error('Selected search card is no longer in that library');
      if (!matchesLibraryFilter(this.engine, found.card, choice.request?.filter || {})) throw new Error('Selected card no longer matches the search restriction');
    }
    return true;
  }

  resolveSearchChoice(playerId, selectedIds = []) {
    const choice = this.engine.state.pendingChoice;
    if (!choice || choice.type !== 'LIBRARY_SEARCH' || choice.playerId !== playerId) throw new Error('No library search choice belongs to this player');
    this.validateSearchChoice(choice, selectedIds);
    this.engine.state.pendingChoice = null;
    const request = normalizeSearchRequest(choice.request || {});
    const result = this._finishSearch(request, selectedIds);
    return result;
  }

  searchImmediate(rawRequest, selectedIds = null) {
    const prepared = this._prepareSearch(rawRequest);
    if (prepared.prevented) return prepared;
    const request = prepared.request;
    const candidates = this.candidates(request);
    const required = request.allowFailToFind ? 0 : Math.min(request.minCount, candidates.length);
    const max = Math.min(request.maxCount, candidates.length);
    const ids = selectedIds == null ? candidates.slice(0, Math.max(required, max)).map(card => card.instanceId) : [...selectedIds];
    const synthetic = { type:'LIBRARY_SEARCH', min: required, max, candidateIds: candidates.map(card => card.instanceId), libraryOwnerId: request.libraryOwnerId, request };
    this.validateSearchChoice(synthetic, ids);
    return this._finishSearch(request, ids);
  }

  _finishSearch(request, selectedIds) {
    const found = [];
    for (let index = 0; index < selectedIds.length; index++) {
      const id = selectedIds[index];
      const located = this.engine.zones.find(id);
      if (!located?.card || located.zone !== 'library') continue;
      const card = located.card;
      if (request.revealFound) this.engine.revealCard(card, { reason: request.reason, position: 'search-result' });
      if (!request.moveFound) { found.push(card); continue; }
      const plan = request.destinationPlan?.[Math.min(index, request.destinationPlan.length - 1)] || {};
      const zone = plan.zone || request.destination;
      const toPlayerId = plan.playerId || request.destinationPlayerId || card.owner;
      const moved = this.engine._moveZoneNow(card, zone, toPlayerId, { reason: request.reason, publicReveal: !!request.revealFound });
      if (moved && zone === 'battlefield') {
        moved.tapped = !!(plan.tapped ?? request.tapped);
        moved.createdTurn = this.engine.state.turn;
        moved.controlledSinceTurn = this.engine.state.turn;
        this.engine.emit('ENTER_BATTLEFIELD', { controller: toPlayerId, target: moved });
      }
      if (moved) found.push(moved);
    }
    if (request.shuffleAfter) this.engine.shuffleLibrary(request.libraryOwnerId, request.reason);
    else {
      // Once the search window closes, only explicitly revealed/known positions remain knowable.
      for (const card of this.engine.state.players[request.libraryOwnerId]?.library || []) {
        if (!this.engine.knownInformation.get(request.chooserPlayerId, card)?.position) this.engine.knownInformation.forget(request.chooserPlayerId, card);
      }
    }
    this._record('SEARCH_COMPLETE', { searchingPlayerId: request.searchingPlayerId, chooserPlayerId: request.chooserPlayerId, libraryOwnerId: request.libraryOwnerId, selectedIds: [...selectedIds], destination: request.moveFound ? request.destination : null, shuffled: request.shuffleAfter });
    return { request: structuredClone(request), selectedIds: [...selectedIds], cards: request.returnFoundCards ? found : undefined };
  }

  lookTop(playerId, count = 1, { viewerId = playerId, reason = 'look-top' } = {}) {
    const cards = this.engine.state.players[playerId]?.library?.slice(0, Math.max(0, Number(count) || 0)) || [];
    cards.forEach((card, index) => this.engine.knownInformation.look(viewerId, card, { reason, position: `top:${index + 1}` }));
    this._record('LOOK_TOP', { playerId, viewerId, count: cards.length, reason });
    return cards;
  }

  revealTop(playerId, count = 1, { reason = 'reveal-top' } = {}) {
    const cards = this.engine.state.players[playerId]?.library?.slice(0, Math.max(0, Number(count) || 0)) || [];
    cards.forEach((card, index) => this.engine.revealCard(card, { reason, position: `top:${index + 1}` }));
    this._record('REVEAL_TOP', { playerId, count: cards.length, reason });
    return cards;
  }

  reorderTop(playerId, orderedIds = [], { reason = 'reorder-top' } = {}) {
    const library = this.engine.state.players[playerId]?.library || [];
    const n = orderedIds.length;
    const topIds = library.slice(0, n).map(card => card.instanceId);
    if (new Set(orderedIds).size !== n || orderedIds.some(id => !topIds.includes(id))) throw new Error('Top-of-library reorder must contain exactly the cards currently in that top segment');
    const byId = new Map(library.slice(0, n).map(card => [card.instanceId, card]));
    library.splice(0, n, ...orderedIds.map(id => byId.get(id)));
    orderedIds.forEach((id, index) => {
      const card = byId.get(id);
      for (const viewerId of this.engine.playerIds()) if (this.engine.knownInformation.isKnown(viewerId, card)) this.engine.knownInformation.remember(viewerId, card, { reason, position: `top:${index + 1}`, public: this.engine.knownInformation.get(viewerId, card)?.public === true });
    });
    this._record('REORDER_TOP', { playerId, orderedIds, reason });
    return orderedIds;
  }

  putOnBottom(playerId, cardIds = [], { reason = 'put-bottom', knownTo = [] } = {}) {
    const library = this.engine.state.players[playerId]?.library || [];
    for (const id of cardIds) {
      if (!library.some(card => card.instanceId === id)) throw new Error('Only cards in the library may be put on the bottom');
      this.engine.zones.moveWithinZone(playerId, 'library', id, library.length - 1);
      this.engine.knownInformation.forgetForAll(id);
      const card = library.at(-1);
      for (const viewerId of knownTo) this.engine.knownInformation.look(viewerId, card, { reason, position: 'bottom' });
    }
    this._record('PUT_BOTTOM', { playerId, cardIds: [...cardIds], reason });
    return cardIds;
  }

  moveTopToZone(playerId, count = 1, toZone = 'graveyard', { reason = 'top-to-zone', reveal = false, toPlayerId = playerId } = {}) {
    const moved = [];
    for (let i = 0; i < Math.max(0, Number(count) || 0); i++) {
      const card = this.engine.state.players[playerId]?.library?.[0];
      if (!card) break;
      if (reveal) this.engine.revealCard(card, { reason, position: 'top' });
      const result = this.engine._moveZoneNow(card, toZone, toPlayerId, { reason, publicReveal: reveal });
      if (result) moved.push(result);
    }
    this._record('MOVE_TOP', { playerId, count: moved.length, toZone, reason });
    return moved;
  }

  scry(playerId, count = 1, { bottomIds = [], topOrder = null, reason = 'scry' } = {}) {
    const looked = this.lookTop(playerId, count, { viewerId: playerId, reason });
    const lookedIds = looked.map(card => card.instanceId);
    if (bottomIds.some(id => !lookedIds.includes(id))) throw new Error('Scry may bottom only cards looked at');
    this.putOnBottom(playerId, bottomIds, { reason, knownTo: [playerId] });
    const remain = lookedIds.filter(id => !bottomIds.includes(id));
    const order = topOrder || remain;
    if (order.length) this.reorderTop(playerId, order, { reason });
    this._record('SCRY', { playerId, count: looked.length, bottomIds: [...bottomIds], topOrder: [...order] });
    return { lookedIds, bottomIds: [...bottomIds], topOrder: [...order] };
  }

  surveil(playerId, count = 1, { graveyardIds = [], topOrder = null, reason = 'surveil' } = {}) {
    const looked = this.lookTop(playerId, count, { viewerId: playerId, reason });
    const lookedIds = looked.map(card => card.instanceId);
    if (graveyardIds.some(id => !lookedIds.includes(id))) throw new Error('Surveil may move only cards looked at');
    for (const id of graveyardIds) {
      const found = this.engine.zones.find(id);
      if (found?.zone === 'library' && found.playerId === playerId) this.engine._moveZoneNow(found.card, 'graveyard', found.card.owner, { reason });
    }
    const remain = lookedIds.filter(id => !graveyardIds.includes(id));
    const order = topOrder || remain;
    if (order.length) this.reorderTop(playerId, order, { reason });
    this._record('SURVEIL', { playerId, count: looked.length, graveyardIds: [...graveyardIds], topOrder: [...order] });
    return { lookedIds, graveyardIds: [...graveyardIds], topOrder: [...order] };
  }

  revealUntil(playerId, filter = {}, { reason = 'reveal-until', maxCards = Infinity } = {}) {
    const library = this.engine.state.players[playerId]?.library;
    if (!library) throw new Error(`Unknown library owner ${playerId}`);
    const revealed = [];
    let hit = null;
    const limit = Math.max(0, Number(maxCards));
    const snapshot = [...library];
    for (const card of snapshot) {
      if (revealed.length >= limit) break;
      this.engine.revealCard(card, { reason, position: `top:${revealed.length + 1}` });
      revealed.push(card);
      if (matchesLibraryFilter(this.engine, card, filter)) {
        hit = card;
        break;
      }
    }
    this._record('REVEAL_UNTIL', {
      playerId,
      reason,
      revealedIds: revealed.map(card => card.instanceId),
      hitId: hit?.instanceId || null,
      filter: structuredClone(filter)
    });
    return { revealed, hit };
  }

  _bottomRandomFromLibrary(playerId, cards, reason) {
    const shuffled = [...cards];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(this.engine.rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    for (const card of shuffled) {
      const found = this.engine.zones.find(card.instanceId);
      if (found?.zone === 'library' && found.playerId === playerId) {
        this.engine.zones.moveWithinZone(playerId, 'library', card.instanceId, this.engine.state.players[playerId].library.length);
      }
      this.engine.knownInformation?.forgetForAll?.(card);
    }
    return shuffled;
  }

  revealUntilToBattlefield(playerId, filter = {}, {
    controllerId = playerId,
    reason = 'reveal-until-battlefield',
    maxCards = Infinity,
    castOption = 'reveal-until-battlefield'
  } = {}) {
    const result = this.revealUntil(playerId, filter, { reason, maxCards });
    const rest = result.revealed.filter(card => card.instanceId !== result.hit?.instanceId);
    let permanent = null;
    if (result.hit) {
      const detached = this.engine.zones.detach(result.hit.instanceId);
      if (detached) {
        permanent = this.engine._finishPermanentResolution({
          card: detached,
          controller: controllerId,
          mode: null,
          castOption
        }, []);
      }
    }
    const bottomed = this._bottomRandomFromLibrary(playerId, rest, `${reason}-bottom`);
    this._record('REVEAL_UNTIL_BATTLEFIELD', {
      playerId,
      controllerId,
      reason,
      hitId: permanent?.instanceId || null,
      bottomedIds: bottomed.map(card => card.instanceId)
    });
    return { ...result, permanent, bottomed };
  }

  exileUntil(playerId, predicate, { reason = 'library-iterate', reveal = true, maxCards = Infinity } = {}) {
    if (typeof predicate !== 'function') throw new Error('exileUntil requires a stop predicate');
    const exiled = [];
    let hit = null;
    while (this.engine.state.players[playerId]?.library?.length && exiled.length < maxCards) {
      const card = this.engine.state.players[playerId].library[0];
      if (reveal) this.engine.revealCard(card, { reason, position: 'top' });
      const moved = this.engine._moveZoneNow(card, 'exile', card.owner, { reason, publicReveal: reveal });
      if (!moved) break;
      exiled.push(moved);
      if (predicate(moved, this._definition(moved))) { hit = moved; break; }
    }
    this._record('ITERATE_TOP', { playerId, reason, exiledIds: exiled.map(card => card.instanceId), hitId: hit?.instanceId || null });
    return { exiled, hit };
  }

  _bottomRandom(playerId, cards, reason) {
    const shuffled = [...cards];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(this.engine.rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    for (const card of shuffled) {
      const found = this.engine.zones.find(card.instanceId);
      if (found?.zone === 'exile') this.engine._moveZoneNow(found.card, 'library', playerId, { reason, destinationIndex: this.engine.state.players[playerId].library.length });
    }
    return shuffled;
  }

  cascade(playerId, sourceManaValue, { reason = 'cascade' } = {}) {
    const result = this.exileUntil(playerId, (_card, definition) => !isType(definition, 'Land') && manaValue(definition) < Number(sourceManaValue), { reason, reveal: true });
    const hit = result.hit;
    const rest = result.exiled.filter(card => card.instanceId !== hit?.instanceId);
    if (hit) this.engine.state.castingPermissions.push({ playerId, cardId: hit.cardId, cardInstanceId: hit.instanceId, fromZone: 'exile', timing: 'any', freeCast: true, reason, untilTurn: this.engine.state.turn });
    this._bottomRandom(playerId, rest, `${reason}-bottom`);
    this._record('CASCADE', { playerId, sourceManaValue, hitId: hit?.instanceId || null, bottomedIds: rest.map(card => card.instanceId) });
    return { hit, exiled: result.exiled, bottomed: rest };
  }

  discover(playerId, value, { reason = 'discover' } = {}) {
    const result = this.exileUntil(playerId, (_card, definition) => !isType(definition, 'Land') && manaValue(definition) <= Number(value), { reason, reveal: true });
    const hit = result.hit;
    const rest = result.exiled.filter(card => card.instanceId !== hit?.instanceId);
    if (hit) this.engine.state.castingPermissions.push({ playerId, cardId: hit.cardId, cardInstanceId: hit.instanceId, fromZone: 'exile', timing: 'any', freeCast: true, discoverValue: Number(value), reason, untilTurn: this.engine.state.turn });
    this._bottomRandom(playerId, rest, `${reason}-bottom`);
    this._record('DISCOVER', { playerId, value, hitId: hit?.instanceId || null, bottomedIds: rest.map(card => card.instanceId) });
    return { hit, exiled: result.exiled, bottomed: rest };
  }

  snapshot() { return structuredClone(this.ensureState()); }
}
