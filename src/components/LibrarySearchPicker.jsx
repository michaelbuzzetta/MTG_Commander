import React from 'react';
import { Card } from './Card.jsx';

export function LibrarySearchPicker({
  title = 'Search Your Library',
  prompt,
  cards = [],
  db,
  selectedIds = [],
  onToggle,
  onSelect,
  max = 1,
  min = 0,
  onConfirm,
  onDecline,
  confirmLabel = 'Confirm Selection',
  declineLabel = 'Find Nothing',
  selectionHint = null,
  resolveOnSingleSelect = false,
}) {
  const selectedOrder = id => selectedIds.indexOf(id);
  const selectionRange = min === max ? `${min}` : `${min}–${max}`;
  const confirmDisabled = selectedIds.length < min || selectedIds.length > max;

  const chooseCard = id => {
    // One-card library searches should behave like the old name buttons: a
    // single click chooses the card and resolves the search immediately.
    // Multi-card searches keep the selection/confirm workflow.
    if (resolveOnSingleSelect && max === 1) {
      onSelect?.(id);
      return;
    }
    onToggle?.(id);
  };

  return <div className="library-search-backdrop" role="presentation">
    <section className="library-search-modal" role="dialog" aria-modal="true" aria-label={title}>
      <header className="library-search-header">
        <div>
          <div className="library-search-kicker">LIBRARY SEARCH</div>
          <h2>{title}</h2>
          {prompt && <p>{prompt}</p>}
        </div>
        <div className="library-search-count">
          <b>{selectedIds.length}</b>
          <span>{resolveOnSingleSelect && max === 1 ? 'click a card to choose it' : `selected · choose ${selectionRange}`}</span>
        </div>
      </header>

      {selectionHint && <div className="library-search-hint">{selectionHint}</div>}

      <div className="library-search-grid" role="list" aria-label="Eligible cards in your library">
        {cards.length === 0 && <div className="library-search-empty">No eligible cards remain in your library.</div>}
        {cards.map(card => {
          const def = db[card.cardId] || { name: card.cardId, typeLine: '', oracleText: '' };
          const order = selectedOrder(card.instanceId);
          const selected = order >= 0;
          return <div key={card.instanceId} className={`library-search-option ${selected ? 'selected' : ''}`} role="listitem">
            <button
              type="button"
              className="library-search-card-button"
              onClick={() => chooseCard(card.instanceId)}
              aria-label={`Choose ${def.name}`}
            >
              <Card perm={card} def={def} selected={selected} />
            </button>
            {selected && <span className="library-search-order">{max > 1 ? order + 1 : '✓'}</span>}
            <span className="library-search-name">{def.name}</span>
          </div>;
        })}
      </div>

      <footer className="library-search-actions">
        <span>{resolveOnSingleSelect && max === 1 ? 'Click the card you want to find.' : `Click a card to ${max > 1 ? 'select or deselect it' : 'select it'}.`}</span>
        <div>
          {!resolveOnSingleSelect && selectedIds.length > 0 && <button type="button" onClick={() => selectedIds.forEach(id => onToggle?.(id))}>Clear</button>}
          {onDecline && <button type="button" onClick={onDecline}>{declineLabel}</button>}
          {!resolveOnSingleSelect && onConfirm && <button type="button" className="primary" disabled={confirmDisabled} onClick={onConfirm}>{confirmLabel}</button>}
        </div>
      </footer>
    </section>
  </div>;
}
