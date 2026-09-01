import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { resolveCardArt } from '../utils/cardArt.js';

export function Card({ perm, def, onClick, selected = false }) {
  const [url, setUrl] = useState(null);
  const [previewSide, setPreviewSide] = useState(null);

  useEffect(() => { resolveCardArt(def.name).then(setUrl); }, [def.name]);

  const counters = Object.entries(perm.counters || {}).filter(([, value]) => value)
    .map(([kind, value]) => `${kind} ×${value}`).join(' ');
  const rulesText = def.oracleText || def.customRulesText || def.unsupportedReason || 'No local rules text is available.';

  const showPreview = (target) => {
    if (typeof window === 'undefined' || !target?.getBoundingClientRect) {
      setPreviewSide('right');
      return;
    }
    const rect = target.getBoundingClientRect();
    // Put the preview on the side with the most room, opposite the hovered card.
    setPreviewSide(rect.left + rect.width / 2 > window.innerWidth / 2 ? 'left' : 'right');
  };

  const hidePreview = () => setPreviewSide(null);

  const preview = previewSide && typeof document !== 'undefined'
    ? createPortal(
      <div className={`zoom zoom-${previewSide}`} aria-hidden="true">
        {url ? <img src={url} alt="" /> : <div className="zoom-fallback">
          <b>{def.name}</b>
          <small>{def.typeLine}</small>
          <p>{rulesText}</p>
        </div>}
        <div className="zoom-rules">
          <b>{def.name}</b>
          <small>{def.typeLine}</small>
          <p>{rulesText}</p>
          {def.supported === false && <em>Reference only — not playable in the trainer.</em>}
        </div>
      </div>,
      document.body,
    )
    : null;

  return <>
    <div
      className={`card ${perm.tapped ? 'tapped' : ''} ${selected ? 'selected' : ''}`}
      onClick={onClick}
      onMouseEnter={(event) => showPreview(event.currentTarget)}
      onMouseLeave={hidePreview}
      onFocus={(event) => showPreview(event.currentTarget)}
      onBlur={hidePreview}
      aria-label={`${def.name}. ${def.typeLine}. ${rulesText}`}
    >
      <div className="card-inner">
        {url ? <img src={url} alt={def.name} /> : <div className="fallback">
          <div><b>{def.name}</b><small>{def.typeLine}</small></div>
          <p>{rulesText}</p>
        </div>}
        {counters && <span className="counter">{counters}</span>}
      </div>
    </div>
    {preview}
  </>;
}
