import React, { useState } from 'react';
import { buildStackPriorityModel } from '../ui/RulesUiModel.js';

export default function StackPriorityPanel({ engine, db, playerLabel }) {
  const [expanded, setExpanded] = useState(false);
  const view = engine?.getStackPriorityView?.() || {};
  const state = engine?.getPlayerStateSnapshot?.('player') || { players: {} };
  const resolveTarget = target => {
    const id = typeof target === 'string' ? target : (target?.id || target?.instanceId || target?.playerId || null);
    if (!id) return 'unknown target';
    if (state.players?.[id]) return playerLabel(id);
    for (const player of Object.values(state.players || {})) for (const zone of ['battlefield','graveyard','exile','command','hand']) {
      const card = player?.[zone]?.find?.(candidate => candidate.instanceId === id || candidate.gameObjectId === id);
      if (card) return db[card.cardId]?.name || card.cardId || id;
    }
    return id;
  };
  const model = buildStackPriorityModel(view, db, playerLabel, resolveTarget);
  return <div className={`stack-priority-shell ${expanded ? 'expanded' : ''}`}>
    <button type="button" className="stack-priority-summary" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>
      <span className="stack-kicker">STACK {model.stackDepth}</span>
      <b>{model.items[0]?.label || 'Empty'}</b>
      <span className={`priority-pill ${model.priorityPlayer === 'player' ? 'yours' : ''}`}>{model.priorityPlayerLabel ? `${model.priorityPlayerLabel} priority` : 'No priority'}</span>
    </button>
    {expanded && <section className="stack-priority-popover" role="dialog" aria-label="Stack and priority">
      <header><div><span>AUTHORITATIVE STACK</span><b>{model.stackDepth ? `${model.stackDepth} object${model.stackDepth === 1 ? '' : 's'}` : 'Stack empty'}</b></div><div><span>PRIORITY</span><b>{model.priorityPlayerLabel || 'None'}</b><small>{model.consecutivePasses} consecutive pass{model.consecutivePasses === 1 ? '' : 'es'}</small></div></header>
      <div className="stack-object-list">
        {model.items.length === 0 && <div className="stack-empty">No spells or abilities are currently on the stack.</div>}
        {model.items.map((item, index) => <article key={item.id || index} className="stack-object-row">
          <span className="stack-order">{index === 0 ? 'TOP' : `#${model.stackDepth - index}`}</span>
          <div><b>{item.label}</b><small>Controller: {item.controllerLabel}{item.targetLabels.length ? ` · Targets: ${item.targetLabels.join(', ')}` : ''}</small></div>
        </article>)}
      </div>
    </section>}
  </div>;
}
