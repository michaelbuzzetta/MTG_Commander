import { ENGINE_EVENT } from '../events/EventTypes.js';

export class MonarchService {
  constructor(engine) { this.engine = engine; }
  current() { const id = this.engine.state.monarch || null; return id && !this.engine.state.players[id]?.lost ? id : null; }
  isMonarch(playerId) { return this.current() === playerId; }
  become(playerId, { source = null, cause = 'become-monarch' } = {}) {
    if (!this.engine.state.players[playerId] || this.engine.state.players[playerId].lost) throw new Error(`Unknown or eliminated player ${playerId}`);
    return this.engine.events.dispatch(ENGINE_EVENT.BECOME_MONARCH, { playerId, source }, { cause, stabilize: false });
  }
  onCombatDamage({ controller, targetPlayer, amount } = {}) {
    if (Number(amount || 0) > 0 && controller && this.isMonarch(targetPlayer) && controller !== targetPlayer) this.become(controller, { cause: 'combat-damage-to-monarch' });
  }
  onEndStep(playerId) { if (this.isMonarch(playerId)) this.engine.draw(playerId, 1); }
}
