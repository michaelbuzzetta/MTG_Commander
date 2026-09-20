// Phase 63-65: census-driven classification used by the final universal audit.
export function classifyCatalog(cards = [], compiler, mechanicRegistry = null) {
  const rows = [];
  for (const card of cards) {
    const result = compiler.compileCard(card);
    const mechanics = mechanicRegistry?.recognize?.(card)?.map(x => x.id) || [];
    const status = result.autoAccepted ? 'executable' : result.partial ? 'partial' : 'manual';
    rows.push({ id: card.id || card.oracle_id || card.name, name: card.name, status, mechanics, reason: result.reason || null });
  }
  return rows;
}
export function summarizeCoverage(rows = []) {
  const summary = { total: rows.length, executable: 0, partial: 0, manual: 0 };
  for (const row of rows) if (row.status in summary) summary[row.status]++;
  summary.remaining = summary.partial + summary.manual;
  return summary;
}
export function remainingOracleFamilies(rows = [], cards = []) {
  const byId = new Map(cards.map(c => [c.id || c.oracle_id || c.name, c]));
  const families = new Map();
  for (const row of rows.filter(r => r.status !== 'executable')) {
    const text = String(byId.get(row.id)?.oracleText || byId.get(row.id)?.oracle_text || '').replace(/\d+/g, 'N').replace(/\{[^}]+\}/g, '{M}').trim();
    const key = text.split(/\n|\./)[0].slice(0, 120) || '(blank)';
    const item = families.get(key) || { pattern: key, count: 0, cards: [] };
    item.count++; if (item.cards.length < 20) item.cards.push(row.name); families.set(key, item);
  }
  return [...families.values()].sort((a,b) => b.count-a.count || a.pattern.localeCompare(b.pattern));
}
