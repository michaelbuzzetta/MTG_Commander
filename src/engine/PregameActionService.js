function text(value = '') { return String(value || ''); }
function normalizeType(type = '') { return String(type || '').trim().toLowerCase().replace(/[_\s]+/g, '-'); }

function inferredActions(def = {}) {
  const oracle = text(def.oracleText);
  const out = [];
  if (/in your opening hand, you may begin the game with (?:it|[^.]+) on the battlefield/i.test(oracle)) {
    out.push({ type: 'put-from-opening-hand-onto-battlefield', optional: true });
  }
  if (/Gemstone Caverns/i.test(def.name || '') && /opening hand/i.test(oracle) && /not playing first/i.test(oracle)) {
    return [{ type: 'gemstone-caverns', optional: true, condition: 'not-starting-player' }];
  }
  return out;
}

export class PregameActionService {
  constructor(engine) {
    this.engine = engine;
    this.queue = [];
    this.sequence = 0;
    this.handlers = new Map();
    this.register('put-from-opening-hand-onto-battlefield', (entry) => this._putOntoBattlefield(entry));
    this.register('gemstone-caverns', (entry, response) => this._gemstoneCaverns(entry, response));
  }

  register(type, handler) {
    const key = normalizeType(type);
    if (!key || typeof handler !== 'function') throw new Error('Pregame action registration requires a type and handler');
    this.handlers.set(key, handler);
    return this;
  }

  collect() {
    this.queue = [];
    for (const playerId of this.engine.state.playerOrder) {
      const player = this.engine.state.players[playerId];
      for (const card of player.hand || []) {
        const def = this.engine.db[card.cardId] || {};
        const declared = Array.isArray(def.pregameActions) ? def.pregameActions : [];
        const actions = declared.length ? declared : inferredActions(def);
        for (const raw of actions) {
          const type = normalizeType(raw.type);
          if (!this.handlers.has(type)) continue;
          if (raw.condition === 'not-starting-player' && playerId === this.engine.state.activePlayer) continue;
          this.queue.push({
            id: `pregame-action-${++this.sequence}`,
            playerId,
            cardInstanceId: card.instanceId,
            cardId: card.cardId,
            sourceName: def.name || card.cardId,
            type,
            optional: raw.optional !== false,
            data: structuredClone(raw)
          });
        }
      }
    }
    return structuredClone(this.queue);
  }

  begin() {
    this.collect();
    return this.advance();
  }

  _choiceFor(entry) {
    const choice = {
      type: 'PREGAME_ACTION',
      playerId: entry.playerId,
      pregameActionId: entry.id,
      actionType: entry.type,
      sourceName: entry.sourceName,
      cardInstanceId: entry.cardInstanceId,
      prompt: `Use the pregame action of ${entry.sourceName}?`
    };
    if (entry.type === 'gemstone-caverns') {
      choice.eligibleExileIds = this.engine.state.players[entry.playerId].hand
        .filter(card => card.instanceId !== entry.cardInstanceId)
        .map(card => card.instanceId);
    }
    return choice;
  }

  advance() {
    while (this.queue.length) {
      const entry = this.queue[0];
      const found = this.engine.zones.find(entry.cardInstanceId);
      if (!found || found.zone !== 'hand' || found.player?.id !== entry.playerId) {
        this.queue.shift();
        continue;
      }
      if (entry.optional) {
        this.engine.state.pendingChoice = this._choiceFor(entry);
        this.engine.state.priorityPlayer = entry.playerId;
        return this.engine.state.pendingChoice;
      }
      this.execute(entry, { accept: true });
      this.queue.shift();
    }
    return null;
  }

  validateChoice(playerId, action) {
    const choice = this.engine.state.pendingChoice;
    if (!choice || choice.type !== 'PREGAME_ACTION' || choice.playerId !== playerId) throw new Error('No pregame action choice is pending for this player');
    if (action.type !== 'CHOOSE_PREGAME_ACTION' || typeof action.accept !== 'boolean') throw new Error('Choose whether to use the pending pregame action');
    if (choice.actionType === 'gemstone-caverns' && action.accept) {
      if (!choice.eligibleExileIds?.length) throw new Error('Gemstone Caverns cannot be used without another card to exile');
      if (!choice.eligibleExileIds.includes(action.exileCardInstanceId)) throw new Error('Choose another card from the opening hand to exile for Gemstone Caverns');
    }
    return true;
  }

  resolveChoice(playerId, action) {
    this.validateChoice(playerId, action);
    const choice = this.engine.state.pendingChoice;
    const entry = this.queue[0];
    if (!entry || entry.id !== choice.pregameActionId) throw new Error('Pregame action queue is out of sync');
    this.engine.state.pendingChoice = null;
    if (action.accept) this.execute(entry, action);
    this.queue.shift();
    return this.advance();
  }

  execute(entry, response = {}) {
    const handler = this.handlers.get(entry.type);
    if (!handler) throw new Error(`Unsupported pregame action ${entry.type}`);
    const result = handler(entry, response);
    this.engine.log('PREGAME_ACTION', { playerId: entry.playerId, sourceName: entry.sourceName, actionType: entry.type, accepted: true });
    return result;
  }

  _putOntoBattlefield(entry) {
    const found = this.engine.zones.find(entry.cardInstanceId);
    if (!found || found.zone !== 'hand') return null;
    return this.engine._moveZoneNow(found.card, 'battlefield', entry.playerId, { reason: 'pregame-action', publicReveal: true });
  }

  _gemstoneCaverns(entry, response) {
    const found = this.engine.zones.find(entry.cardInstanceId);
    if (!found || found.zone !== 'hand') return null;
    const exile = this.engine.zones.find(response.exileCardInstanceId);
    if (!exile || exile.zone !== 'hand' || exile.player?.id !== entry.playerId || exile.card.instanceId === entry.cardInstanceId) throw new Error('Gemstone Caverns requires exiling another card from your opening hand');
    this.engine._moveZoneNow(exile.card, 'exile', entry.playerId, { reason: 'gemstone-caverns-pregame', publicReveal: true });
    const moved = this.engine._moveZoneNow(found.card, 'battlefield', entry.playerId, { reason: 'gemstone-caverns-pregame', publicReveal: true });
    if (moved) this.engine.events.dispatch('ADD_COUNTER', { playerId: entry.playerId, permanentId: moved.instanceId, counterType: 'luck', amount: 1 }, { cause: 'gemstone-caverns-pregame', stabilize: false });
    return moved;
  }
}
