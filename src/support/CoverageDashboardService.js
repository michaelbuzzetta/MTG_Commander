import dashboardData from '../data/generated/rules-coverage-dashboard.json' with { type: 'json' };

const clone = value => structuredClone(value);
const statusOrder = Object.freeze({ fully_supported: 0, partially_supported: 1, unreviewed: 2, unsupported: 3, missing: 4 });

export class CoverageDashboardService {
  constructor(payload = dashboardData) {
    this.payload = payload || {};
    this.cards = Array.isArray(this.payload.cards) ? this.payload.cards : [];
    this.cardById = new Map(this.cards.map(card => [card.cardId, card]));
    this.decks = Array.isArray(this.payload.decks) ? this.payload.decks : [];
  }

  getSummary() { return clone(this.payload.summary || {}); }
  getSubsystemHealth() { return clone(this.payload.subsystemHealth || []); }
  getMechanics() { return clone(this.payload.mechanics || []); }
  getReleaseGate() { return clone(this.payload.releaseGate || {}); }
  getPerformance() { return clone(this.payload.performance || {}); }
  getCi() { return clone(this.payload.ci || {}); }
  getMetadata() { return { generatedAt: this.payload.generatedAt || null, rulesVersion: this.payload.rulesVersion || null, cardDatabaseVersion: this.payload.cardDatabaseVersion || null, metricPolicy: this.payload.metricPolicy || '' }; }

  findCard(cardId) { return this.cardById.has(cardId) ? clone(this.cardById.get(cardId)) : null; }

  queryCards({ search = '', status = 'all', mechanic = 'all', implementationPath = 'all', limit = 250 } = {}) {
    const needle = String(search).trim().toLowerCase();
    return this.cards
      .filter(card => status === 'all' || card.dashboardStatus === status)
      .filter(card => mechanic === 'all' || (card.mechanics || []).includes(mechanic))
      .filter(card => implementationPath === 'all' || card.implementationPath === implementationPath)
      .filter(card => !needle || [card.name, card.cardId, card.typeLine, card.oracleText, ...(card.mechanics || [])].join(' ').toLowerCase().includes(needle))
      .sort((a, b) => (statusOrder[a.dashboardStatus] ?? 99) - (statusOrder[b.dashboardStatus] ?? 99) || a.name.localeCompare(b.name))
      .slice(0, Math.max(1, Number(limit || 250)))
      .map(clone);
  }

  getDeckReadiness(deckId = null) {
    if (!deckId) return clone(this.decks);
    const deck = this.decks.find(row => row.deckId === deckId);
    return deck ? clone(deck) : null;
  }
}

export const coverageDashboard = new CoverageDashboardService();
