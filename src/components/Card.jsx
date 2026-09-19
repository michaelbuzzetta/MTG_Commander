import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { resolveCardArt } from '../utils/cardArt.js';

export function Card({ perm, def, onClick, selected = false, actionState = null }) {
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
          {def.supported === false && <em>Not fully supported — gameplay will warn before an unsupported interaction is used.</em>}
        </div>
      </div>,
      document.body,
    )
    : null;

  return <>
    <div
      className={`card ${perm.tapped ? 'tapped' : ''} ${selected ? 'selected' : ''} ${actionState?.state === 'legal' ? 'legal-action' : ''} ${actionState?.state === 'blocked' ? 'rules-blocked' : ''} ${perm.phasedOut ? 'phased-out' : ''}`}
      onClick={onClick}
      onMouseEnter={(event) => showPreview(event.currentTarget)}
      onMouseLeave={hidePreview}
      onFocus={(event) => showPreview(event.currentTarget)}
      onBlur={hidePreview}
      aria-label={`${def.name}. ${def.typeLine}. ${rulesText}${actionState?.tooltip ? ` ${actionState.tooltip}` : ''}`}
      title={actionState?.tooltip || undefined}
    >
      <div className="card-inner">
        {url ? <img src={url} alt={def.name} /> : <div className="fallback">
          <div><b>{def.name}</b><small>{def.typeLine}</small></div>
          <p>{rulesText}</p>
        </div>}
        {counters && <span className="counter">{counters}</span>}
        {perm.attachedTo && <span className="state-badge attachment-badge" title={`Attached to ${perm.attachedTo}`}>ATT</span>}
        {perm.isToken && <span className="state-badge token-badge">TOKEN</span>}
        {perm.copyState && <span className="state-badge copy-badge">COPY</span>}
        {perm.phasedOut && <span className="state-badge phased-badge">PHASED</span>}
        {(perm.faceDown || Number(perm.faceState?.currentFaceIndex || 0) > 0) && <span className="state-badge face-badge">{perm.faceDown ? 'FACE DOWN' : `FACE ${Number(perm.faceState?.currentFaceIndex || 0) + 1}`}</span>}
      </div>
    </div>
    {preview}
  </>;
}
