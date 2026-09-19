import React, { useMemo, useState } from 'react';
import { coverageDashboard } from '../support/index.js';

const STATUS_LABEL = {
  fully_supported: 'Fully supported',
  partially_supported: 'Partially supported',
  unreviewed: 'Unreviewed',
  unsupported: 'Unsupported',
  missing: 'Missing'
};

function Metric({ label, value, note }) {
  return <div className="coverage-metric"><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>;
}

function StatusPill({ status }) {
  return <span className={`coverage-status status-${status}`}>{STATUS_LABEL[status] || status}</span>;
}

function CardDetail({ card, onClose }) {
  if (!card) return <aside className="coverage-detail empty"><h3>Card drill-down</h3><p>Select a card to inspect its executable support record, parser/script path, mechanics, tests, hooks, and caveats.</p></aside>;
  return <aside className="coverage-detail">
    <button className="coverage-detail-close" onClick={onClose} aria-label="Close card detail">×</button>
    <div className="coverage-kicker">CARD SUPPORT RECORD</div>
    <h2>{card.name}</h2>
    <div className="coverage-card-subtitle">{card.manaCost || '—'} · {card.typeLine || 'Type unavailable'}</div>
    <StatusPill status={card.dashboardStatus} />
    <dl className="coverage-detail-grid">
      <div><dt>Implementation</dt><dd>{card.implementationPath}</dd></div>
      <div><dt>Script</dt><dd>{card.scriptStatus}</dd></div>
      <div><dt>Parser</dt><dd>{card.parserStatus} ({card.parserConfidence})</dd></div>
      <div><dt>Casting</dt><dd>{card.castingSupport}</dd></div>
      <div><dt>AI</dt><dd>{card.aiSupport}</dd></div>
      <div><dt>Tests</dt><dd>{card.testCount} behavior · {card.goldenTestCount} golden</dd></div>
      <div><dt>Abilities</dt><dd>{card.abilityCount} abilities · {card.spellEffectCount} spell effects</dd></div>
      <div><dt>Oracle identity</dt><dd>{card.oracleIdentity}</dd></div>
    </dl>
    <h4>Recognized mechanics</h4>
    <div className="coverage-tags">{card.mechanics?.length ? card.mechanics.map(tag => <span key={tag}>{tag}</span>) : <em>None recognized by the mechanic registry.</em>}</div>
    <h4>Custom hooks</h4>
    {card.requiredCustomHooks?.length ? <ul>{card.requiredCustomHooks.map(hook => <li key={`${hook.id}-${hook.version}`}>{hook.id} · {hook.version}</li>)}</ul> : <p className="coverage-muted">No custom hooks required.</p>}
    <h4>Known caveats</h4>
    {card.caveats?.length ? <ul>{card.caveats.map((item, i) => <li key={i}>{item}</li>)}</ul> : <p className="coverage-pass-copy">No tracked caveats.</p>}
    {card.identityWarnings?.length > 0 && <><h4>Identity warnings</h4><ul>{card.identityWarnings.map((item, i) => <li key={i}>{item}</li>)}</ul></>}
    {card.testFiles?.length > 0 && <><h4>Behavior test files</h4><div className="coverage-code-list">{card.testFiles.map(file => <code key={file}>{file}</code>)}</div></>}
    {card.oracleText && <><h4>Oracle text</h4><p className="coverage-oracle">{card.oracleText}</p></>}
  </aside>;
}

export default function CardSupportDashboard({ onClose }) {
  const summary = coverageDashboard.getSummary();
  const meta = coverageDashboard.getMetadata();
  const mechanics = coverageDashboard.getMechanics();
  const subsystemHealth = coverageDashboard.getSubsystemHealth();
  const decks = coverageDashboard.getDeckReadiness();
  const releaseGate = coverageDashboard.getReleaseGate();
  const performance = coverageDashboard.getPerformance();
  const ci = coverageDashboard.getCi();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [mechanic, setMechanic] = useState('all');
  const [path, setPath] = useState('all');
  const [selectedCardId, setSelectedCardId] = useState(null);
  const [deckId, setDeckId] = useState(decks[0]?.deckId || '');
  const selectedCard = selectedCardId ? coverageDashboard.findCard(selectedCardId) : null;
  const selectedDeck = decks.find(deck => deck.deckId === deckId) || null;
  const cards = useMemo(() => coverageDashboard.queryCards({ search, status, mechanic, implementationPath: path, limit: 300 }), [search, status, mechanic, path]);
  const paths = [...new Set(coverageDashboard.queryCards({ limit: 5000 }).map(card => card.implementationPath))].sort();

  return <main className="coverage-dashboard-shell">
    <header className="coverage-dashboard-header">
      <div><div className="coverage-kicker">STEP 40 · RULES COVERAGE</div><h1>Card Support & Rules Coverage</h1><p>Measured from repository support records and generated verification artifacts — not estimated implementation effort.</p></div>
      <button className="secondary" onClick={onClose}>Back to Trainer</button>
    </header>

    <section className="coverage-metric-grid">
      <Metric label="Oracle/card records" value={summary.totalCards?.toLocaleString()} note={`${summary.oracleImplementationCount?.toLocaleString()} implementation identities`} />
      <Metric label="Fully supported" value={`${summary.statusCounts?.fully_supported || 0} (${summary.statusPercent?.fully_supported || 0}%)`} note="Strict-eligible support classification" />
      <Metric label="Partial" value={summary.statusCounts?.partially_supported || 0} note="Has some implementation/test evidence" />
      <Metric label="Unreviewed" value={summary.statusCounts?.unreviewed || 0} note="No certification or card/golden tests yet" />
      <Metric label="Unsupported" value={summary.statusCounts?.unsupported || 0} note="Explicitly outside current support" />
      <Metric label="Mechanics registered" value={summary.mechanicsRegistered || 0} note={`${summary.mechanicsSeenInCatalog || 0} recognized in current catalog`} />
      <Metric label="Strict-ready decks" value={`${summary.strictReadyDecks || 0}/${summary.totalDecks || 0}`} note="Imported/built-in readiness records" />
      <Metric label="Known fuzz failures" value={summary.knownEngineFailureCount || 0} note="Persisted failure corpus" />
    </section>

    <section className="coverage-section">
      <div className="coverage-section-title"><div><span>Subsystem health</span><h2>Verification signals</h2></div><div className={`coverage-gate ${releaseGate.criticalVerificationGreen ? 'green' : 'attention'}`}>{releaseGate.criticalVerificationGreen ? 'Critical artifacts green' : 'Verification attention required'}</div></div>
      <div className="coverage-health-grid">{subsystemHealth.map(row => <article key={row.id} className={`coverage-health health-${row.status}`}><div><strong>{row.label}</strong><span>{row.status}</span></div><b>{row.metric}</b><small>{row.detail}</small></article>)}</div>
      <div className="coverage-release-meta"><span>Rules: <b>{meta.rulesVersion || 'unknown'}</b></span><span>Dashboard: <b>{meta.generatedAt || 'unknown'}</b></span><span>CI: <b>{ci.status}</b></span><span>Live CI result: <b>not inferred</b></span></div>
    </section>

    <section className="coverage-section coverage-cards-section">
      <div className="coverage-section-title"><div><span>Per-card drill-down</span><h2>Support records</h2></div><b>{cards.length} shown</b></div>
      <div className="coverage-filters">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search card name, id, type, text, mechanic…" />
        <select value={status} onChange={e => setStatus(e.target.value)}><option value="all">All statuses</option>{Object.entries(STATUS_LABEL).filter(([key]) => key !== 'missing').map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
        <select value={mechanic} onChange={e => setMechanic(e.target.value)}><option value="all">All mechanics</option>{mechanics.filter(row => row.cardCount > 0).map(row => <option key={row.id} value={row.id}>{row.name} ({row.cardCount})</option>)}</select>
        <select value={path} onChange={e => setPath(e.target.value)}><option value="all">All implementation paths</option>{paths.map(value => <option key={value} value={value}>{value}</option>)}</select>
      </div>
      <div className="coverage-card-layout">
        <div className="coverage-table-wrap"><table className="coverage-table"><thead><tr><th>Card</th><th>Status</th><th>Implementation</th><th>Tests</th><th>Mechanics</th></tr></thead><tbody>{cards.map(card => <tr key={card.cardId} className={selectedCardId === card.cardId ? 'selected' : ''} onClick={() => setSelectedCardId(card.cardId)}><td><b>{card.name}</b><small>{card.typeLine || card.cardId}</small></td><td><StatusPill status={card.dashboardStatus} /></td><td>{card.implementationPath}<small>{card.parserStatus}</small></td><td>{card.testCount} + {card.goldenTestCount} golden</td><td>{card.mechanics.slice(0, 4).join(', ') || '—'}{card.mechanics.length > 4 ? ` +${card.mechanics.length - 4}` : ''}</td></tr>)}</tbody></table></div>
        <CardDetail card={selectedCard} onClose={() => setSelectedCardId(null)} />
      </div>
    </section>

    <section className="coverage-section">
      <div className="coverage-section-title"><div><span>Deck readiness</span><h2>Strict-mode preflight</h2></div><select value={deckId} onChange={e => setDeckId(e.target.value)}>{decks.map(deck => <option key={deck.deckId} value={deck.deckId}>{deck.name}</option>)}</select></div>
      {selectedDeck && <div className="coverage-deck-readiness"><div className={`coverage-deck-flag ${selectedDeck.strictReady ? 'ready' : 'blocked'}`}><b>{selectedDeck.strictReady ? 'STRICT READY' : 'BLOCKED'}</b><span>{selectedDeck.cardCount} cards · {selectedDeck.blockerCount} blockers</span></div><div className="coverage-deck-counts">{Object.entries(selectedDeck.statusCounts || {}).map(([key, value]) => <span key={key}><b>{value}</b> {STATUS_LABEL[key] || key}</span>)}</div>{selectedDeck.blockers?.length > 0 && <div className="coverage-blockers"><h4>Blocking cards</h4><div>{selectedDeck.blockers.slice(0, 80).map(blocker => <button key={blocker.cardId} onClick={() => { setSelectedCardId(blocker.cardId); setSearch(blocker.name); }}>{blocker.name}</button>)}</div></div>}</div>}
    </section>

    <section className="coverage-section">
      <div className="coverage-section-title"><div><span>Performance</span><h2>Latest Step 38 benchmark artifact</h2></div><StatusPill status={performance.passed ? 'fully_supported' : 'partially_supported'} /></div>
      <div className="coverage-performance-grid">{Object.entries(performance.measured || {}).map(([key, value]) => <div key={key}><span>{key}</span><b>{Number(value).toLocaleString()} ms</b><small>threshold {Number(performance.thresholds?.[key] || 0).toLocaleString()} ms</small></div>)}</div>
    </section>

    <footer className="coverage-dashboard-footer"><p>{meta.metricPolicy}</p><p>{releaseGate.policy}</p></footer>
  </main>;
}
