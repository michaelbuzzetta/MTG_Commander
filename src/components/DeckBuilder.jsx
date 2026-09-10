import React, { useEffect, useMemo, useState } from 'react';
import { resolveCardArt } from '../utils/cardArt.js';
import {
  autoBuildCommanderDeck,
  BUILDER_ROLES,
  deckCardCount,
  deckManaCurve,
  deckRoleSummary,
  detectCommanderProfile,
  isCommanderCandidate,
  recommendationList,
  recommendedStrategyKey,
} from '../utils/deckBuilder.js';

function ManaPips({ colors = [] }) {
  const symbols = { W: 'W', U: 'U', B: 'B', R: 'R', G: 'G' };
  return <span className="arena-color-pips" aria-label={`Color identity ${colors.join('') || 'colorless'}`}>
    {colors.length ? colors.map(color => <span key={color} className={`mana-pip pip-${color.toLowerCase()}`}>{symbols[color] || color}</span>) : <span className="mana-pip pip-c">◇</span>}
  </span>;
}

function BuilderArt({ def, className = '' }) {
  const [url, setUrl] = useState(def?.image || null);
  useEffect(() => {
    let active = true;
    setUrl(def?.image || null);
    if (!def?.image && def?.name) resolveCardArt(def.name).then(next => { if (active) setUrl(next); });
    return () => { active = false; };
  }, [def?.id, def?.image, def?.name]);

  if (!def) return null;
  return url
    ? <img className={className} src={url} alt={def.name} loading="lazy" />
    : <div className={`arena-art-fallback ${className}`}><b>{def.name}</b><small>{def.typeLine}</small></div>;
}

function CollectionCard({ recommendation, quantity, onAdd }) {
  const { def, score, reasons, roles } = recommendation;
  return <article className={`arena-collection-card ${quantity ? 'in-deck' : ''}`} title={reasons.join(' • ')}>
    <BuilderArt def={def} />
    <div className="arena-card-glass">
      <div className="arena-card-score"><b>{score}</b><span>SYNERGY</span></div>
      <button className="arena-add-card" type="button" onClick={() => onAdd(def)} aria-label={`Add ${def.name}`}>+</button>
    </div>
    {quantity > 0 && <div className="arena-owned-count">{quantity}</div>}
    <div className="arena-card-explain">
      <strong>{def.name}</strong>
      <span>{reasons[0] || roles[0] || 'Commander legal'}</span>
      {def.catalogCard && def.supported === false && <em>FULL CATALOG</em>}
    </div>
  </article>;
}

function CommanderPicker({ db, onChoose, onClose }) {
  const [query, setQuery] = useState('');
  const commanders = useMemo(() => Object.values(db)
    .filter(isCommanderCandidate)
    .filter(def => !query.trim() || `${def.name} ${def.typeLine} ${def.oracleText || ''}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 80), [db, query]);

  return <div className="arena-commander-picker-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="arena-commander-picker" role="dialog" aria-modal="true" aria-labelledby="arena-commander-title">
      <div className="arena-picker-header">
        <div><span>COMMANDER</span><h2 id="arena-commander-title">Choose Your Commander</h2></div>
        <button type="button" onClick={onClose}>×</button>
      </div>
      <div className="arena-search-shell"><span>⌕</span><input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Search legendary creatures, rules text, or creature type…" /></div>
      <div className="arena-commander-grid">
        {commanders.map(def => <button type="button" className="arena-commander-choice" key={def.id} onClick={() => onChoose(def)}>
          <BuilderArt def={def} />
          <span className="arena-commander-choice-name"><b>{def.name}</b><ManaPips colors={def.colorIdentity || []} /></span>
        </button>)}
      </div>
      {!commanders.length && <div className="arena-empty-state"><b>No local commanders match that search.</b><span>Try a different name or rules-text keyword.</span></div>}
    </section>
  </div>;
}

function DeckRow({ entry, def, onIncrement, onDecrement }) {
  return <div className="arena-deck-row">
    <span className="arena-deck-qty">{entry.quantity}</span>
    <span className="arena-deck-name"><b>{def.name}</b><small>{def.typeLine}</small></span>
    <span className="arena-deck-mv">{Number(def.manaValue || 0)}</span>
    <span className="arena-deck-row-actions">
      <button type="button" onClick={() => onDecrement(def)}>−</button>
      <button type="button" onClick={() => onIncrement(def)}>+</button>
    </span>
  </div>;
}

function Curve({ values }) {
  const max = Math.max(1, ...values);
  return <div className="arena-curve" aria-label="Mana curve">
    {values.map((value, index) => <div className="arena-curve-column" key={index}>
      <span className="arena-curve-value">{value}</span>
      <i style={{ height: `${Math.max(4, (value / max) * 38)}px` }} />
      <b>{index === 7 ? '7+' : index}</b>
    </div>)}
  </div>;
}

export function DeckBuilder({ db, catalogStatus, onCancel, onSave }) {
  const [commander, setCommander] = useState(null);
  const [showCommanderPicker, setShowCommanderPicker] = useState(true);
  const [deckName, setDeckName] = useState('New Commander Deck');
  const [entries, setEntries] = useState([]);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('Recommended');
  const [strategyKey, setStrategyKey] = useState(null);
  const [saveError, setSaveError] = useState('');

  const profile = useMemo(() => detectCommanderProfile(commander), [commander]);
  const recommendations = useMemo(() => recommendationList(db, commander, { strategyKey, search, role, limit: role === 'All' ? 1000 : 120 }), [db, commander, strategyKey, search, role]);
  const quantities = useMemo(() => new Map(entries.map(entry => [entry.id, entry.quantity])), [entries]);
  const count = deckCardCount(entries);
  const summary = useMemo(() => deckRoleSummary(entries, db), [entries, db]);
  const curve = useMemo(() => deckManaCurve(entries, db), [entries, db]);

  const chooseCommander = (def) => {
    setCommander(def);
    setDeckName(`${def.name} — Commander`);
    setEntries([]);
    const nextProfile = detectCommanderProfile(def);
    setStrategyKey(recommendedStrategyKey(nextProfile));
    setRole('Recommended');
    setSearch('');
    setSaveError('');
    setShowCommanderPicker(false);
  };

  const incrementCard = (def) => {
    setSaveError('');
    setEntries(current => {
      if (deckCardCount(current) >= 99) return current;
      const existing = current.find(entry => entry.id === def.id);
      const basic = /\bBasic Land\b/i.test(def.typeLine || '');
      if (existing) {
        if (!basic) return current;
        return current.map(entry => entry.id === def.id ? { ...entry, quantity: entry.quantity + 1 } : entry);
      }
      return [...current, { id: def.id, quantity: 1 }];
    });
  };

  const decrementCard = (def) => {
    setSaveError('');
    setEntries(current => {
      const existing = current.find(entry => entry.id === def.id);
      if (!existing) return current;
      if (existing.quantity <= 1) return current.filter(entry => entry.id !== def.id);
      return current.map(entry => entry.id === def.id ? { ...entry, quantity: entry.quantity - 1 } : entry);
    });
  };

  const autoBuild = () => {
    if (!commander) return;
    setEntries(autoBuildCommanderDeck(db, commander, { strategyKey, existing: entries }));
    setSaveError('');
  };

  const saveDeck = () => {
    if (!commander) { setSaveError('Choose a commander first.'); return; }
    if (count !== 99) { setSaveError(`Your main deck needs exactly 99 cards. It currently has ${count}.`); return; }
    try {
      onSave({ deckName, commander, entries });
    } catch (error) {
      setSaveError(error.message || String(error));
    }
  };

  const sortedEntries = useMemo(() => [...entries].sort((a, b) => {
    const aDef = db[a.id], bDef = db[b.id];
    const aLand = /\bLand\b/i.test(aDef?.typeLine || '');
    const bLand = /\bLand\b/i.test(bDef?.typeLine || '');
    if (aLand !== bLand) return aLand ? 1 : -1;
    return Number(aDef?.manaValue || 0) - Number(bDef?.manaValue || 0) || String(aDef?.name).localeCompare(String(bDef?.name));
  }), [entries, db]);

  return <main className="arena-builder-shell">
    <header className="arena-builder-topbar">
      <button className="arena-back-button" type="button" onClick={onCancel}>‹ <span>DECKS</span></button>
      <div className="arena-title-block">
        <span>COMMANDER DECK BUILDER</span>
        <input value={deckName} onChange={e => setDeckName(e.target.value)} aria-label="Deck name" />
      </div>
      <div className="arena-top-actions">
        <span className={`arena-legality ${count === 99 ? 'legal' : ''}`}>{count === 99 ? '✓ 100 / 100 LEGAL' : `${count + (commander ? 1 : 0)} / 100 CARDS`}</span>
        <button className="arena-done-button" type="button" disabled={!commander || count !== 99} onClick={saveDeck}>DONE</button>
      </div>
    </header>

    <div className="arena-builder-body">
      <aside className="arena-commander-panel">
        <div className="arena-panel-caption">COMMANDER</div>
        {commander ? <>
          <button className="arena-commander-card" type="button" onClick={() => setShowCommanderPicker(true)} title="Choose a different commander">
            <BuilderArt def={commander} />
            <span className="arena-change-commander">CHANGE</span>
          </button>
          <div className="arena-commander-meta">
            <h2>{commander.name}</h2>
            <ManaPips colors={commander.colorIdentity || []} />
            <p>{commander.oracleText || 'No local rules text available.'}</p>
          </div>
          <div className="arena-strategy-label">DETECTED SYNERGIES</div>
          <div className="arena-strategy-chips">
            <button type="button" className={!strategyKey ? 'selected' : ''} onClick={() => setStrategyKey(null)}>Balanced</button>
            {profile.strategies.slice(0, 6).map(strategy => <button key={strategy.key} type="button" className={strategyKey === strategy.key ? 'selected' : ''} onClick={() => setStrategyKey(strategy.key)}>{strategy.label}</button>)}
          </div>
        </> : <button className="arena-empty-commander" type="button" onClick={() => setShowCommanderPicker(true)}><span>+</span><b>Choose Commander</b></button>}
        <button className="arena-auto-build" type="button" onClick={autoBuild} disabled={!commander}>✦ AUTO BUILD 99</button>
        <button className="arena-clear-build" type="button" onClick={() => setEntries([])} disabled={!entries.length}>Clear Deck</button>
      </aside>

      <section className="arena-collection-panel">
        <div className="arena-browser-toolbar">
          <div className="arena-search-shell"><span>⌕</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search every MTG card by name, type, or rules text…" /></div>
          <ManaPips colors={commander?.colorIdentity || []} />
          <span className="arena-card-pool-count">{recommendations.length} shown</span>
        </div>
        {catalogStatus && <div className={`arena-catalog-banner ${catalogStatus.complete ? 'complete' : 'fallback'}`} title={catalogStatus.message}>
          <span>◉</span>
          <b>{catalogStatus.complete ? `Scryfall catalog: ${catalogStatus.count.toLocaleString()} cards` : catalogStatus.message}</b>
          {catalogStatus.sourceUpdatedAt && <small>Source updated {new Date(catalogStatus.sourceUpdatedAt).toLocaleDateString()}</small>}
        </div>}
        <div className="arena-role-tabs">
          {BUILDER_ROLES.map(item => <button key={item} type="button" className={role === item ? 'selected' : ''} onClick={() => setRole(item)}>{item}</button>)}
        </div>
        {!commander ? <div className="arena-empty-browser"><span className="arena-empty-glyph">✦</span><h2>Choose a commander to open the collection</h2><p>The builder will automatically enforce color identity and rank cards by commander synergy.</p><button type="button" onClick={() => setShowCommanderPicker(true)}>CHOOSE COMMANDER</button></div> :
          <div className="arena-collection-scroll">
            <div className="arena-collection-grid">
              {recommendations.map(item => <CollectionCard key={item.def.id} recommendation={item} quantity={quantities.get(item.def.id) || 0} onAdd={incrementCard} />)}
            </div>
            {!recommendations.length && <div className="arena-empty-state"><b>No cards match these filters.</b><span>Change the role or clear the search field.</span></div>}
          </div>}
      </section>

      <aside className="arena-deck-panel">
        <div className="arena-deck-heading">
          <div><span>DECK</span><strong>{count} / 99</strong></div>
          <small>Commander + 99</small>
        </div>
        <div className="arena-deck-progress"><i style={{ width: `${Math.min(100, count / 99 * 100)}%` }} /></div>
        <div className="arena-deck-list">
          {commander && <div className="arena-deck-row commander-row"><span className="arena-deck-qty">C</span><span className="arena-deck-name"><b>{commander.name}</b><small>Commander</small></span><span className="arena-deck-mv">{Number(commander.manaValue || 0)}</span></div>}
          {sortedEntries.map(entry => <DeckRow key={entry.id} entry={entry} def={db[entry.id]} onIncrement={incrementCard} onDecrement={decrementCard} />)}
          {!entries.length && commander && <div className="arena-deck-empty">Click <b>+</b> on recommendations, or use <b>Auto Build 99</b>.</div>}
        </div>
        <div className="arena-deck-stats">
          <div className="arena-stat-grid">
            <span><b>{summary.Land || 0}</b> Lands</span>
            <span><b>{summary.Ramp || 0}</b> Ramp</span>
            <span><b>{summary['Card Draw'] || 0}</b> Draw</span>
            <span><b>{summary.Removal || 0}</b> Removal</span>
            <span><b>{summary.Protection || 0}</b> Protect</span>
            <span><b>{summary.Tutor || 0}</b> Tutors</span>
          </div>
          <Curve values={curve} />
        </div>
        {saveError && <div className="arena-save-error">{saveError}</div>}
        <button className="arena-save-bottom" type="button" onClick={saveDeck} disabled={!commander || count !== 99}>SAVE DECK & RETURN</button>
      </aside>
    </div>

    {showCommanderPicker && <CommanderPicker db={db} onChoose={chooseCommander} onClose={() => setShowCommanderPicker(false)} />}
  </main>;
}
