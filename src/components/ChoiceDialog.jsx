import React, { useEffect, useMemo, useState } from 'react';

function optionValue(option) {
  return option && typeof option === 'object' && Object.prototype.hasOwnProperty.call(option, 'value') ? option.value : option;
}

function optionLabel(option) {
  if (option && typeof option === 'object') return option.label ?? option.name ?? option.id ?? String(optionValue(option));
  return String(option);
}

/**
 * Generic ChoiceRequest renderer. It deliberately contains no Magic legality
 * logic: choice type, options, count bounds and ordering all come from GameEngine.
 * New scripted cards using an existing ChoiceRequest shape therefore need no
 * card-specific React component.
 */
export default function ChoiceDialog({ request, onSubmit, resolveLabel = optionLabel }) {
  const [selected, setSelected] = useState([]);
  const [ordered, setOrdered] = useState([]);
  const [numberValue, setNumberValue] = useState(request?.defaultSelection?.[0] ?? request?.min ?? 0);
  const [textValue, setTextValue] = useState(request?.defaultSelection?.[0] ?? '');
  const [division, setDivision] = useState({});
  const options = request?.legalOptions || [];
  const ordering = !!request?.orderingRequired || request?.choiceType === 'order';
  const selection = ordering ? ordered : selected;

  useEffect(() => {
    setSelected(Array.isArray(request?.defaultSelection) ? [...request.defaultSelection] : []);
    setOrdered([]);
    setNumberValue(request?.defaultSelection?.[0] ?? request?.min ?? 0);
    setTextValue(request?.defaultSelection?.[0] ?? '');
    setDivision({});
  }, [request?.requestId]);

  const optionKeys = useMemo(() => options.map((item, index) => ({ item, key: `${String(item?.id ?? optionValue(item))}:${index}` })), [options]);
  if (!request) return null;

  const numberChoice = request.choiceType === 'number';
  const textChoice = ['name'].includes(request.choiceType) && options.length === 0;
  const booleanChoice = request.choiceType === 'boolean' && options.length === 0;
  const divideChoice = request.choiceType === 'divide';
  const requiredTotal = Number(request.metadata?.total ?? request.metadata?.amount ?? 0);
  const divisionTotal = Object.values(division).reduce((sum, value) => sum + Number(value || 0), 0);
  const selectionReady = selection.length >= Number(request.min || 0) && selection.length <= Number(request.max || 0);
  const dividedSelections = divideChoice
    ? options.filter(option => Number(division[String(optionValue(option))] || 0) > 0).map(optionValue)
    : [];
  const divideCountReady = dividedSelections.length >= Number(request.min || 0) && dividedSelections.length <= Number(request.max || 0);
  const ready = numberChoice
    ? Number(numberValue) >= Number(request.min || 0) && Number(numberValue) <= Number(request.max || Number.MAX_SAFE_INTEGER)
    : textChoice
      ? String(textValue).trim().length > 0
      : divideChoice
        ? divideCountReady && (requiredTotal ? divisionTotal === requiredTotal : true)
        : booleanChoice || selectionReady;

  const toggle = raw => {
    const value = optionValue(raw);
    if (ordering) {
      setOrdered(current => current.some(item => Object.is(item, value)) ? current.filter(item => !Object.is(item, value)) : [...current, value]);
      return;
    }
    setSelected(current => {
      const exists = current.some(item => Object.is(item, value));
      if (exists) return current.filter(item => !Object.is(item, value));
      if (current.length >= request.max) return request.max === 1 ? [value] : current;
      return [...current, value];
    });
  };

  const submit = () => {
    const selections = numberChoice ? [Number(numberValue)] : textChoice ? [String(textValue).trim()] : booleanChoice ? [true] : divideChoice ? dividedSelections : selection;
    onSubmit?.({
      requestId: request.requestId,
      selections,
      ...(ordering ? { orderedSelections: selection } : {}),
      ...(divideChoice ? { division } : {})
    });
  };

  return <div className="rules-modal-backdrop engine-choice-backdrop" role="presentation">
    <section className="rules-modal generic-choice-dialog" role="dialog" aria-modal="true" aria-label="Game choice">
      <header><div><span>{request.targeted ? 'TARGET SELECTION' : 'ENGINE CHOICE'}</span><h2>{request.prompt || 'Make a choice'}</h2><p>{request.visibility === 'private' ? 'This choice is private to you.' : 'Only engine-provided legal options are shown.'}</p></div></header>
      <div className="generic-choice-body">
        {numberChoice && <input className="rules-number-input" type="number" min={request.min} max={request.max} value={numberValue} onChange={event => setNumberValue(event.target.value)} />}
        {textChoice && <input className="rules-text-input" type="text" value={textValue} onChange={event => setTextValue(event.target.value)} autoFocus />}
        {booleanChoice && <div className="rules-option-list"><button className="rules-option" onClick={() => onSubmit?.({ requestId: request.requestId, selections: [true] })}><b>Yes</b></button><button className="rules-option" onClick={() => onSubmit?.({ requestId: request.requestId, selections: [false] })}><b>No</b></button></div>}
        {!numberChoice && !textChoice && !booleanChoice && <div className="rules-option-grid">
          {optionKeys.map(({ item, key }, index) => {
            const value = optionValue(item);
            const chosenIndex = selection.findIndex(selectedValue => Object.is(selectedValue, value));
            if (divideChoice) return <label key={key} className="division-option"><span>{resolveLabel(item, index)}</span><input type="number" min="0" value={division[String(value)] ?? 0} onChange={event => setDivision(current => ({ ...current, [String(value)]: Math.max(0, Number(event.target.value || 0)) }))} /></label>;
            return <button key={key} className={`rules-option ${chosenIndex >= 0 ? 'selected' : ''}`} onClick={() => toggle(item)}>
              <b>{ordering && chosenIndex >= 0 ? `${chosenIndex + 1}. ` : ''}{resolveLabel(item, index)}</b>
            </button>;
          })}
        </div>}
      </div>
      <footer><span>{divideChoice ? `${divisionTotal}${requiredTotal ? `/${requiredTotal}` : ''} assigned` : (!numberChoice && !textChoice && !booleanChoice ? `${selection.length}/${request.max} selected` : '')}</span><div>{request.allowCancel && <button onClick={() => onSubmit?.({ requestId: request.requestId, cancelled: true })}>Cancel</button>} {!booleanChoice && <button className="primary" disabled={!ready} onClick={submit}>Confirm</button>}</div></footer>
    </section>
  </div>;
}
