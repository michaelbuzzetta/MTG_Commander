import React, { useEffect, useMemo, useState } from 'react';

/** Presentation-only generic picker for engine-provided action variants. */
export default function RulesActionPicker({ picker, onClose }) {
  const numericOptions = Array.isArray(picker?.numberOptions) ? picker.numberOptions : [];
  const allowedNumbers = useMemo(() => numericOptions.map(option => Number(option.value)).filter(Number.isFinite), [picker]);
  const [numberValue, setNumberValue] = useState(allowedNumbers[0] ?? 0);
  useEffect(() => { setNumberValue(allowedNumbers[0] ?? 0); }, [picker?.title, allowedNumbers.join(',')]);
  if (!picker) return null;
  const options = Array.isArray(picker.options) ? picker.options : [];
  const numeric = numericOptions.length > 0;
  const selectedNumeric = numericOptions.find(option => Number(option.value) === Number(numberValue));
  return <div className="rules-modal-backdrop" role="presentation">
    <section className="rules-modal action-picker" role="dialog" aria-modal="true" aria-label={picker.title || 'Choose action'}>
      <header><div><span>RULES ENGINE CHOICE</span><h2>{picker.title || 'Choose an action'}</h2>{picker.prompt && <p>{picker.prompt}</p>}</div></header>
      {numeric ? <div className="rules-number-choice">
        <label>X <input type="number" min={Math.min(...allowedNumbers)} max={Math.max(...allowedNumbers)} value={numberValue} onChange={event => setNumberValue(Number(event.target.value))} /></label>
        <small>{allowedNumbers.length} legal value{allowedNumbers.length === 1 ? '' : 's'} available · {Math.min(...allowedNumbers)}–{Math.max(...allowedNumbers)}</small>
      </div> : <div className="rules-option-list">
        {options.map((option, index) => <button key={option.id ?? option.value ?? index} type="button" className="rules-option" onClick={() => { picker.onPick?.(option, index); onClose?.(); }}>
          <b>{option.label || String(option.value ?? option.id ?? `Option ${index + 1}`)}</b>
          {option.detail && <span>{option.detail}</span>}
        </button>)}
      </div>}
      <footer>
        <button type="button" onClick={onClose}>Cancel</button>
        {numeric && <button type="button" className="primary" disabled={!selectedNumeric} onClick={() => { picker.onPick?.(selectedNumeric); onClose?.(); }}>Confirm X</button>}
      </footer>
    </section>
  </div>;
}
