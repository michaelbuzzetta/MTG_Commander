import React, { useMemo, useState } from 'react';

function deckCardCount(deck) {
  return (deck?.cards || []).reduce((total, entry) => total + Number(entry.quantity || 0), 0);
}

function unsupportedCount(deck) {
  return Array.isArray(deck?.unsupportedCards) ? deck.unsupportedCards.length : 0;
}

function deckTypeSummary(deck, db) {
  const counts = { Creature: 0, Land: 0, Instant: 0, Sorcery: 0, Artifact: 0, Enchantment: 0, Other: 0 };
  for (const entry of deck?.cards || []) {
    const def = db?.[entry.id];
    const qty = Number(entry.quantity || 0);
    const typeLine = String(def?.typeLine || '');
    const key = Object.keys(counts).find(type => type !== 'Other' && new RegExp(`\\b${type}\\b`, 'i').test(typeLine)) || 'Other';
    counts[key] += qty;
  }
  return counts;
}

function DeckCardList({ deck, db }) {
  const rows = useMemo(() => (deck?.cards || []).map(entry => ({
    ...entry,
    def: db?.[entry.id],
    isCommander: entry.id === deck.commander
  })).sort((a, b) => {
    if (a.isCommander !== b.isCommander) return a.isCommander ? -1 : 1;
    const aLand = /\bLand\b/i.test(a.def?.typeLine || '');
    const bLand = /\bLand\b/i.test(b.def?.typeLine || '');
    if (aLand !== bLand) return aLand ? 1 : -1;
    return String(a.def?.name || a.id).localeCompare(String(b.def?.name || b.id));
  }), [deck, db]);

  return <div className="deck-library-card-list">
    {rows.map(row => {
      const unsupported = row.def?.supported === false;
      return <div className={`deck-library-card-row ${row.isCommander ? 'commander' : ''} ${unsupported ? 'unsupported' : ''}`} key={`${row.id}-${row.quantity}`}>
        <span className="deck-library-card-qty">{row.isCommander ? 'C' : row.quantity}</span>
        <span className="deck-library-card-name"><b>{row.def?.name || row.id}</b><small>{unsupported ? `${row.isCommander ? 'Commander · ' : ''}Unsupported interaction warning` : (row.isCommander ? 'Commander' : (row.def?.typeLine || 'Card'))}</small></span>
        <span className="deck-library-card-mv">{Number(row.def?.manaValue || 0)}</span>
      </div>;
    })}
  </div>;
}

function DeckDetail({ deck, db, onClose, onEdit, onDelete, onPlay }) {
  const commander = db?.[deck.commander];
  const summary = useMemo(() => deckTypeSummary(deck, db), [deck, db]);
  return <div className="deck-library-modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="deck-library-modal" role="dialog" aria-modal="true" aria-labelledby="deck-detail-title">
      <header>
        <div>
          <span>COMMANDER DECK</span>
          <h2 id="deck-detail-title">{deck.name}</h2>
          <p>{commander?.name || deck.commander} · {deckCardCount(deck)} cards · {deck.custom ? 'Saved deck' : 'Included deck'}{unsupportedCount(deck) ? ` · ${unsupportedCount(deck)} unsupported` : ''}</p>
        </div>
        <button type="button" className="deck-library-close" onClick={onClose} aria-label="Close deck details">×</button>
      </header>
      {unsupportedCount(deck) > 0 && <div className="deck-library-support-warning"><b>{unsupportedCount(deck)} card{unsupportedCount(deck) === 1 ? '' : 's'} not fully certified.</b> The deck can be saved and started, but those cards will use the trainer's explicit unsupported-interaction warning if their unimplemented behavior is reached.</div>}
      <div className="deck-library-detail-body">
        <aside className="deck-library-commander-preview">
          {commander?.image ? <img src={commander.image} alt={commander.name} /> : <div className="deck-library-art-fallback"><span>COMMANDER</span><b>{commander?.name || deck.commander}</b></div>}
          <h3>{commander?.name || deck.commander}</h3>
          <p>{commander?.typeLine || 'Commander'}</p>
          <div className="deck-library-summary-grid">
            {Object.entries(summary).filter(([, value]) => value > 0).map(([key, value]) => <span key={key}><b>{value}</b>{key}</span>)}
          </div>
        </aside>
        <DeckCardList deck={deck} db={db} />
      </div>
      <footer>
        <button type="button" className="deck-library-danger" onClick={() => onDelete(deck)}>Delete</button>
        <div>
          <button type="button" onClick={() => onEdit(deck)}>Edit Deck</button>
          <button type="button" className="primary" onClick={() => onPlay(deck)}>Use This Deck</button>
        </div>
      </footer>
    </section>
  </div>;
}

export function DeckManager({ decks, db, hiddenDefaultCount = 0, onBack, onEdit, onDelete, onPlay, onBuildNew, onRestoreDefaults }) {
  const [query, setQuery] = useState('');
  const [selectedDeck, setSelectedDeck] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredDecks = useMemo(() => decks.filter(deck => {
    if (!normalizedQuery) return true;
    const commanderName = db?.[deck.commander]?.name || deck.commander;
    return `${deck.name} ${commanderName}`.toLowerCase().includes(normalizedQuery);
  }), [decks, db, normalizedQuery]);

  const requestDelete = deck => {
    setSelectedDeck(null);
    setPendingDelete(deck);
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    onDelete(pendingDelete);
    setPendingDelete(null);
  };

  return <main className="deck-library-shell">
    <header className="deck-library-topbar">
      <button type="button" className="deck-library-back" onClick={onBack}>‹ <span>HOME</span></button>
      <div>
        <span>DECK COLLECTION</span>
        <h1>Your Commander Decks</h1>
      </div>
      <button type="button" className="deck-library-build" onClick={onBuildNew}>+ BUILD NEW DECK</button>
    </header>

    <section className="deck-library-toolbar">
      <div className="deck-library-search"><span>⌕</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search decks or commanders…" /></div>
      <div className="deck-library-count"><b>{decks.length}</b> available deck{decks.length === 1 ? '' : 's'}</div>
      {hiddenDefaultCount > 0 && <button type="button" className="deck-library-restore" onClick={onRestoreDefaults}>Restore {hiddenDefaultCount} deleted default deck{hiddenDefaultCount === 1 ? '' : 's'}</button>}
    </section>

    <section className="deck-library-grid">
      {filteredDecks.map(deck => {
        const commander = db?.[deck.commander];
        return <article className="deck-library-tile" key={deck.id}>
          <button type="button" className="deck-library-art" onClick={() => setSelectedDeck(deck)} aria-label={`View ${deck.name}`}>
            {commander?.image ? <img src={commander.image} alt="" /> : <div className="deck-library-art-fallback"><span>COMMANDER</span><b>{commander?.name || deck.commander}</b></div>}
            <span className={`deck-library-origin ${deck.custom ? 'custom' : 'default'}`}>{deck.custom ? 'CUSTOM' : 'INCLUDED'}</span>
          </button>
          <div className="deck-library-tile-copy">
            <h2>{deck.name}</h2>
            <p>{commander?.name || deck.commander}</p>
            <div className="deck-library-meta"><span>{deckCardCount(deck)} cards</span><span>{(deck.colorIdentity || commander?.colorIdentity || []).join('') || 'C'}</span>{unsupportedCount(deck) > 0 && <span>{unsupportedCount(deck)} unsupported</span>}</div>
          </div>
          <div className="deck-library-actions">
            <button type="button" onClick={() => setSelectedDeck(deck)}>View</button>
            <button type="button" onClick={() => onEdit(deck)}>Edit</button>
            <button type="button" className="danger" onClick={() => requestDelete(deck)}>Delete</button>
          </div>
        </article>;
      })}
      {!filteredDecks.length && <div className="deck-library-empty"><span>✦</span><h2>No decks found</h2><p>{query ? 'Try a different search.' : 'Build or import a Commander deck to add it here.'}</p></div>}
    </section>

    {selectedDeck && <DeckDetail deck={selectedDeck} db={db} onClose={() => setSelectedDeck(null)} onEdit={deck => { setSelectedDeck(null); onEdit(deck); }} onDelete={requestDelete} onPlay={deck => { setSelectedDeck(null); onPlay(deck); }} />}

    {pendingDelete && <div className="deck-library-modal-backdrop" onMouseDown={event => event.target === event.currentTarget && setPendingDelete(null)}>
      <section className="deck-library-confirm" role="alertdialog" aria-modal="true" aria-labelledby="deck-delete-title">
        <span>DELETE DECK</span>
        <h2 id="deck-delete-title">Delete “{pendingDelete.name}”?</h2>
        <p>{pendingDelete.custom ? 'This removes the saved deck from this browser.' : 'This included deck will be hidden on this browser. You can restore deleted default decks from the deck collection page.'}</p>
        <div>
          <button type="button" onClick={() => setPendingDelete(null)}>Cancel</button>
          <button type="button" className="deck-library-danger" onClick={confirmDelete}>Delete Deck</button>
        </div>
      </section>
    </div>}
  </main>;
}
