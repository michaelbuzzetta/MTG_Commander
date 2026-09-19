import { immutableClone } from '../public/immutable.js';
import { isPublicZone } from './ZoneTypes.js';

function hiddenCardPlaceholder(card, zone, index = null) {
  return {
    instanceId: `hidden:${card?.owner || 'unknown'}:${zone || 'hidden'}:${index ?? 'x'}`,
    gameObjectId: null,
    cardId: null,
    owner: card?.owner || null,
    controller: null,
    zone: zone || card?.zone || null,
    hidden: true,
    hiddenIndex: index,
    objectKind: 'hidden-card'
  };
}

function choiceVisibleIds(state, viewerId) {
  const choice = state.pendingChoice;
  if (!choice || choice.playerId !== viewerId) return new Set();
  const ids = new Set();
  const fields = ['candidateIds','eligibleIds','cardInstanceIds','landInstanceIds','permanentIds'];
  for (const field of fields) for (const id of choice[field] || []) ids.add(id);
  if (choice.cardInstanceId) ids.add(choice.cardInstanceId);
  if (choice.commanderId) ids.add(choice.commanderId);
  return ids;
}

function scrubOtherPlayersChoice(choice, viewerId) {
  if (!choice || choice.playerId === viewerId) return choice;
  return {
    type: choice.type,
    playerId: choice.playerId,
    prompt: choice.prompt || null,
    count: choice.count ?? null,
    min: choice.min ?? choice.minCount ?? null,
    max: choice.max ?? choice.maxCount ?? null,
    resume: choice.resume || null,
    private: true
  };
}

export class HiddenInformationService {
  constructor(engine) { this.engine = engine; }

  canSeeCard(viewerId, card, zone, { authorizedIds = new Set() } = {}) {
    if (!card) return false;
    if (isPublicZone(zone) && !card.faceDown) return true;
    if (isPublicZone(zone) && card.faceDown) return authorizedIds.has(card.instanceId) || this.engine.knownInformation.isKnown(viewerId, card);
    if (zone === 'hand') return card.owner === viewerId || this.engine.knownInformation.isKnown(viewerId, card);
    if (zone === 'library') return authorizedIds.has(card.instanceId) || this.engine.knownInformation.isKnown(viewerId, card);
    return false;
  }

  _redactEmbeddedCard(viewerId, value, authorizedIds) {
    if (!value?.instanceId || !value?.cardId) return value;
    const live = this.engine.zones.find(value.instanceId)?.card || null;
    const card = live || value;
    const zone = live?.zone || value.zone || null;
    return this.canSeeCard(viewerId, card, zone, { authorizedIds })
      ? value
      : hiddenCardPlaceholder(card, zone);
  }

  _redactEventPayload(viewerId, payload, authorizedIds) {
    if (!payload || typeof payload !== 'object') return payload;
    const out = { ...payload };
    for (const key of ['card','object','target','source','permanent','recipient']) {
      if (out[key]?.instanceId && out[key]?.cardId) out[key] = this._redactEmbeddedCard(viewerId, out[key], authorizedIds);
    }
    if (Array.isArray(out.targets)) {
      out.targets = out.targets.map(value => value?.instanceId && value?.cardId
        ? this._redactEmbeddedCard(viewerId, value, authorizedIds)
        : value);
    }
    return out;
  }

  stateForViewer(viewerId) {
    if (!this.engine.state.players[viewerId]) throw new Error(`Unknown viewer ${viewerId}`);
    const authoritative = this.engine.state;
    const authorizedIds = choiceVisibleIds(authoritative, viewerId);

    // Avoid cloning hidden 100-card libraries and the unbounded diagnostic
    // history only to redact them afterward. Build the player-facing snapshot
    // from the public root plus per-zone visibility instead. This keeps 4-player
    // simulations responsive while still returning a detached immutable value.
    const {
      players: _players,
      history: _history,
      knownInformation: _known,
      lastKnownInformation: _lki,
      ...root
    } = authoritative;
    const state = structuredClone(root);
    state.players = {};

    for (const [playerId, livePlayer] of Object.entries(authoritative.players)) {
      const {
        library: _library,
        hand: _hand,
        battlefield: _battlefield,
        graveyard: _graveyard,
        exile: _exile,
        command: _command,
        ...metadata
      } = livePlayer;
      const player = structuredClone(metadata);
      state.players[playerId] = player;

      for (const zone of ['library', 'hand', 'exile']) {
        player[zone] = livePlayer[zone].map((card, index) => this.canSeeCard(viewerId, card, zone, { authorizedIds })
          ? structuredClone(card)
          : hiddenCardPlaceholder(card, zone, index));
      }
      player.battlefield = structuredClone(livePlayer.battlefield);
      player.graveyard = structuredClone(livePlayer.graveyard);
      player.command = structuredClone(livePlayer.command);
    }

    // A bounded public log window is enough for rendering recent actions. Full
    // authoritative history remains in GameState/replay and is never leaked.
    state.history = (authoritative.history || []).slice(-256).map(entry =>
      this._redactEventPayload(viewerId, structuredClone(entry), authorizedIds));
    state.pendingTriggers = (state.pendingTriggers || []).map(trigger => ({
      ...trigger,
      source: this._redactEmbeddedCard(viewerId, trigger.source, authorizedIds),
      eventPayload: this._redactEventPayload(viewerId, trigger.eventPayload, authorizedIds)
    }));
    state.triggerRegistrations = (state.triggerRegistrations || []).map(definition => ({
      ...definition,
      sourceSnapshot: this._redactEmbeddedCard(viewerId, definition.sourceSnapshot, authorizedIds)
    }));

    state.pendingChoice = scrubOtherPlayersChoice(authoritative.pendingChoice, viewerId);
    if (state.pendingResolution?.playerId && state.pendingResolution.playerId !== viewerId) {
      const { cardInstanceId: _privateCardId, ...publicPending } = state.pendingResolution;
      state.pendingResolution = publicPending;
    }

    state.lastKnownInformation = {
      sequence: Number(authoritative.lastKnownInformation?.sequence || 0),
      byObjectId: {},
      byInstanceId: {}
    };
    state.knownInformation = { [viewerId]: structuredClone(authoritative.knownInformation?.[viewerId] || { cards: {} }) };
    return immutableClone(state);
  }}
