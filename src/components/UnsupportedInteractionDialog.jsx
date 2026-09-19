import React from 'react';

export default function UnsupportedInteractionDialog({ interaction, onClose }) {
  if (!interaction) return null;
  return <div className="rules-modal-backdrop unsupported-backdrop" role="presentation">
    <section className="rules-modal unsupported-dialog" role="alertdialog" aria-modal="true" aria-label="Unsupported interaction">
      <header><div><span>STRICT RULES DIAGNOSTIC</span><h2>{interaction.title || 'Unsupported interaction'}</h2></div></header>
      <div className="unsupported-body">
        {interaction.cardName && <p><b>Card/effect:</b> {interaction.cardName}</p>}
        <p>{interaction.message}</p>
        {interaction.ability && <p><b>Ability:</b> {interaction.ability}</p>}
        {interaction.rulesVersion && <p><b>Rules version:</b> {interaction.rulesVersion}</p>}
        {interaction.mode && <p><b>Rules mode:</b> {interaction.mode}</p>}
        {interaction.supportStatus && <p><b>Support status:</b> {interaction.supportStatus}</p>}
        {interaction.rollback && <p><b>Recovery:</b> {interaction.rollback}</p>}
        <p className="diagnostic-id"><b>Diagnostic ID:</b> {interaction.diagnosticId}</p>
        {interaction.mode === 'sandbox'
          ? <p className="unsupported-note">This interaction used an explicitly labeled sandbox approximation. This game is excluded from official simulation/statistics output.</p>
          : <p className="unsupported-note">The engine did not approximate the interaction or guess the missing behavior. The unsupported operation was stopped and any protected resolution/action checkpoint was restored.</p>}
      </div>
      <footer><button type="button" className="primary" onClick={onClose}>Close</button></footer>
    </section>
  </div>;
}
