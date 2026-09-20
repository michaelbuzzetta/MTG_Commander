// Phase 65: narrow escape hatch for cards whose rules cannot be safely generalized.
export class IndividualCardImplementationRegistry {
  constructor() { this.byOracleId = new Map(); this.byName = new Map(); }
  register({ oracleId = null, name = null, compile, execute = null, notes = '' }) {
    if (!oracleId && !name) throw new Error('Individual implementation requires oracleId or name');
    if (typeof compile !== 'function') throw new Error('Individual implementation requires compile()');
    const entry = Object.freeze({ oracleId, name, compile, execute, notes });
    if (oracleId) this.byOracleId.set(oracleId, entry); if (name) this.byName.set(String(name).toLowerCase(), entry); return entry;
  }
  resolve(card = {}) { return this.byOracleId.get(card.oracle_id || card.oracleId) || this.byName.get(String(card.name || '').toLowerCase()) || null; }
  compile(card) { const impl = this.resolve(card); return impl ? impl.compile(card) : null; }
  list() { return [...new Set([...this.byOracleId.values(), ...this.byName.values()])]; }
}
