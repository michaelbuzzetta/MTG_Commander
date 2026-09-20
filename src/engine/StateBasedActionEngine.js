export class StateBasedActionEngine {
  constructor(engine) { this.engine = engine; this.sequence = 0; }

  #keywords(permanent) {
    return new Set(this.engine.static.derivedStats(permanent).keywords.map(value => String(value).toLowerCase()));
  }

  #moveActions() {
    const actions = [];
    for (const player of Object.values(this.engine.state.players)) {
      for (const permanent of player.battlefield || []) {
        if (permanent.phasedOut) continue;
        if (this.engine.static.isType(permanent, 'Creature')) {
          const stats = this.engine.static.derivedStats(permanent);
          const indestructible = this.engine.mechanics.isIndestructible(permanent);
          if (stats.toughness <= 0) actions.push({ type: 'graveyard', id: permanent.instanceId, died: true, reason: 'zero-toughness' });
          else if (!indestructible && (Number(permanent.damageMarked || 0) >= stats.toughness || permanent.deathtouchMarked)) actions.push({ type: 'graveyard', id: permanent.instanceId, died: true, reason: permanent.deathtouchMarked ? 'deathtouch' : 'lethal-damage' });
        }

        const plus = Number(permanent.counters?.['+1/+1'] || 0);
        const minus = Number(permanent.counters?.['-1/-1'] || 0);
        if (plus > 0 && minus > 0) actions.push({ type: 'cancel-counters', id: permanent.instanceId, amount: Math.min(plus, minus) });

        if (this.engine.static.isType(permanent, 'Planeswalker')) {
          const base = this.engine.continuous.characteristics(permanent)?.loyalty;
          const loyalty = permanent.counters?.loyalty == null ? base : Number(permanent.counters.loyalty);
          if (loyalty != null && loyalty <= 0) actions.push({ type: 'graveyard', id: permanent.instanceId, died: false, reason: 'zero-loyalty' });
        }
        if (this.engine.static.isType(permanent, 'Battle')) {
          const base = this.engine.continuous.characteristics(permanent)?.defense;
          const defense = permanent.counters?.defense == null ? base : Number(permanent.counters.defense);
          if (defense != null && defense <= 0) actions.push({ type: 'graveyard', id: permanent.instanceId, died: false, reason: 'zero-defense' });
        }

        // Step 23: attachment legality is recalculated from a first-class
        // relationship + derived characteristics every SBA pass. Auras with no
        // legal host go to the graveyard; Equipment/Fortifications/Reconfigure
        // simply become unattached and remain on the battlefield.
        const attachmentKind = this.engine.attachments?.kind(permanent);
        const relationship = this.engine.attachments?.relationshipForAttached(permanent);
        if (attachmentKind === 'aura') {
          if (!relationship || !this.engine.attachments.relationshipLegal(relationship)) {
            actions.push({ type: 'graveyard', id: permanent.instanceId, died: false, reason: 'illegal-aura' });
          }
        } else if (relationship && !this.engine.attachments.relationshipLegal(relationship)) {
          actions.push({ type: 'detach', id: permanent.instanceId, reason: 'illegal-attachment' });
        }

        if (permanent.sagaFinalResolved || permanent.finalChapterResolved) actions.push({ type: 'graveyard', id: permanent.instanceId, died: false, reason: 'saga-complete' });
      }
      // Step 25 Role rule: a creature cannot keep multiple Roles controlled
      // by the same player. Keep the newest attachment timestamp and send older
      // Roles to the graveyard as a state-based action.
      const roleGroups = new Map();
      for (const permanent of player.battlefield || []) {
        if (!permanent.isToken || !this.engine.static.hasSubtype(permanent, 'Role')) continue;
        const relationship = this.engine.attachments?.relationshipForAttached(permanent);
        if (!relationship) continue;
        const bucket = roleGroups.get(relationship.hostId) || [];
        bucket.push({ permanent, relationship }); roleGroups.set(relationship.hostId, bucket);
      }
      for (const roles of roleGroups.values()) {
        if (roles.length <= 1) continue;
        roles.sort((a, b) => Number(b.relationship.timestamp || 0) - Number(a.relationship.timestamp || 0));
        for (const oldRole of roles.slice(1)) actions.push({ type: 'graveyard', id: oldRole.permanent.instanceId, died: false, reason: 'role-uniqueness' });
      }

      for (const zone of ['library', 'hand', 'graveyard', 'exile', 'command']) {
        for (const card of player[zone] || []) if (card.isToken) actions.push({ type: 'cease-token', id: card.instanceId, reason: 'token-off-battlefield' });
      }
    }
    return actions;
  }

  #playerLossActions() {
    const actions = [];
    for (const [playerId, player] of Object.entries(this.engine.state.players)) {
      if (player.lost) continue;
      if (Number(player.life) <= 0) actions.push({ type: 'lose-player', playerId, reason: 'life' });
      else if (Number(player.counters?.poison || 0) >= 10) actions.push({ type: 'lose-player', playerId, reason: 'poison' });
      else if (player.drewFromEmptyLibrary) actions.push({ type: 'lose-player', playerId, reason: 'empty-library' });
      else {
        const lethalCommander = Object.entries(player.commanderDamage || {}).find(([, amount]) => Number(amount) >= 21);
        if (lethalCommander) actions.push({ type: 'lose-player', playerId, reason: 'commander-damage', commanderId: lethalCommander[0] });
      }
    }
    return actions;
  }

  collect() {
    // Compatibility projection: older fixtures/card handlers may still set
    // attachedTo directly. Promote those links into authoritative Step 23
    // relationships before evaluating SBAs.
    this.engine.attachments?.reconcileLegacyAttachments();
    const seen = new Set();
    return [...this.#playerLossActions(), ...this.#moveActions()].filter(action => {
      const key = `${action.type}:${action.playerId || action.id}:${action.reason || ''}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
  }

  #applyBatch(actions) {
    if (!actions.length) return false;
    const snapshot = actions.map(action => ({ ...action }));
    // Determine the entire batch first. Zone changes are then committed while
    // triggered abilities are deferred by GameEngine.stateBasedActions(), so all
    // deaths in this batch are seen as simultaneous for trigger ordering.
    for (const action of actions) {
      if (action.type === 'lose-player') {
        this.engine.elimination.markLost(action.playerId, { reason: action.reason, commanderId: action.commanderId || null });
      } else if (action.type === 'graveyard') {
        const permanent = this.engine.findPermanent(action.id);
        if (permanent) this.engine.toGraveyard(permanent, !!action.died);
      } else if (action.type === 'cease-token') {
        this.engine.zones.remove(action.id);
      } else if (action.type === 'cancel-counters') {
        const permanent = this.engine.findPermanent(action.id);
        if (permanent) {
          const amount = Number(action.amount || 0);
          // +1/+1 and -1/-1 counters are removed simultaneously as an SBA.
          // Trigger publication is already deferred for the entire SBA batch.
          for (const key of ['+1/+1', '-1/-1']) {
            if (amount > 0) this.engine.counters.removeWithoutChoice(permanent, key, amount, { cause: 'sba-counter-cancellation' });
          }
        }
      } else if (action.type === 'detach') {
        const permanent = this.engine.findPermanent(action.id);
        if (permanent) this.engine.attachments.detach(permanent, { reason: action.reason || 'sba-illegal-attachment' });
      }
    }
    this.engine.log('SBA_BATCH', { sequence: ++this.sequence, actions: snapshot });
    this.engine._cleanupEliminatedPlayers();
    return true;
  }

  #openCommanderChoice() {
    for (const owner of Object.values(this.engine.state.players)) {
      const commander = [...(owner.graveyard || []), ...(owner.exile || [])].find(card => card.isCommander && card.commanderZoneChoicePending);
      if (!commander) continue;
      this.engine.state.pendingChoice = {
        type: 'COMMANDER_ZONE', playerId: commander.owner, commanderId: commander.instanceId,
        fromZone: commander.zone, replacement: false,
        resume: this.engine.state.phase === 'CLEANUP' ? 'CLEANUP' : 'PRIORITY'
      };
      this.engine.state.priorityPlayer = commander.owner;
      return true;
    }
    return false;
  }

  #openLegendChoice() {
    for (const [controller, player] of Object.entries(this.engine.state.players)) {
      const groups = new Map();
      for (const permanent of player.battlefield || []) {
        const chars = this.engine.continuous.characteristics(permanent);
        if (!chars?.supertypes.some(type => String(type).toLowerCase() === 'legendary')) continue;
        const name = chars.name || permanent.cardId;
        const group = groups.get(name) || []; group.push(permanent); groups.set(name, group);
      }
      const duplicate = [...groups.entries()].find(([, permanents]) => permanents.length > 1);
      if (!duplicate) continue;
      const [cardName, permanents] = duplicate;
      this.engine.state.pendingChoice = {
        type: 'LEGEND_RULE', playerId: controller, cardName,
        permanentIds: permanents.map(permanent => permanent.instanceId),
        resume: this.engine.state.phase === 'CLEANUP' ? 'CLEANUP' : 'PRIORITY'
      };
      this.engine.state.priorityPlayer = controller;
      return true;
    }
    return false;
  }

  stabilize() {
    if (this.engine.state.pendingChoice) return false;
    // Ascend does not use the stack. Once earned, the city's blessing persists.
    for (const [playerId, player] of Object.entries(this.engine.state.players)) {
      if (player.citysBlessing || (player.battlefield || []).length < 10) continue;
      const hasAscendPermanent = (player.battlefield || []).some(permanent => {
        const definition = this.engine.copy?.definitionForObject(permanent) || this.engine.db[permanent.cardId] || {};
        return !!definition.ascend || (definition.keywords || []).some(keyword => String(keyword).toLowerCase() === 'ascend');
      });
      if (hasAscendPermanent) {
        player.citysBlessing = true;
        this.engine.log('CITYS_BLESSING_GAINED', { playerId, reason: 'ascend-permanent' });
      }
    }
    let changed = false;
    let guard = 0;
    while (guard++ < 100) {
      const actions = this.collect();
      if (!actions.length) break;
      changed = this.#applyBatch(actions) || changed;
      if (this.engine.state.winner) break;
    }
    if (guard >= 100) throw new Error('State-based action stabilization exceeded safety limit');
    this.engine.checkWinner();
    this.engine._cleanupEliminatedPlayers();
    if (this.engine.state.winner) return changed;
    if (this.#openCommanderChoice()) return true;
    if (this.#openLegendChoice()) return true;
    return changed;
  }
}
