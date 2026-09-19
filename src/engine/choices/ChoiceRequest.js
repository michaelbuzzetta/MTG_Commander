export const CHOICE_TYPE = Object.freeze({
  BOOLEAN: 'boolean',
  OPTION: 'option',
  MODE: 'mode',
  NUMBER: 'number',
  COLOR: 'color',
  NAME: 'name',
  PLAYER: 'player',
  TARGETS: 'targets',
  CARDS: 'cards',
  PERMANENTS: 'permanents',
  ORDER: 'order',
  DIVIDE: 'divide',
  ACTION: 'action'
});

export const CHOICE_VISIBILITY = Object.freeze({
  PUBLIC: 'public',
  PRIVATE: 'private',
  HIDDEN: 'hidden'
});

const TYPES = new Set(Object.values(CHOICE_TYPE));
const VISIBILITIES = new Set(Object.values(CHOICE_VISIBILITY));

function asFiniteCount(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

export function createChoiceRequest(input = {}) {
  const requestId = String(input.requestId || input.id || '').trim();
  if (!requestId) throw new Error('ChoiceRequest.requestId is required');
  const requestingPlayer = String(input.requestingPlayer || input.playerId || '').trim();
  if (!requestingPlayer) throw new Error('ChoiceRequest.requestingPlayer is required');
  const choiceType = String(input.choiceType || input.kind || '').trim();
  if (!TYPES.has(choiceType)) throw new Error(`Unsupported ChoiceRequest.choiceType ${choiceType || '(empty)'}`);

  const min = asFiniteCount(input.min ?? input.minCount, choiceType === CHOICE_TYPE.BOOLEAN ? 1 : 0);
  const max = asFiniteCount(input.max ?? input.maxCount, choiceType === CHOICE_TYPE.BOOLEAN ? 1 : Math.max(1, min));
  if (max < min) throw new Error('ChoiceRequest.max must be greater than or equal to min');
  const visibility = input.visibility || CHOICE_VISIBILITY.PUBLIC;
  if (!VISIBILITIES.has(visibility)) throw new Error(`Unsupported ChoiceRequest.visibility ${visibility}`);

  const request = {
    requestId,
    requestingPlayer,
    choiceType,
    prompt: input.prompt == null ? '' : String(input.prompt),
    legalOptions: Array.isArray(input.legalOptions) ? structuredClone(input.legalOptions) : [],
    filter: input.filter == null ? null : structuredClone(input.filter),
    min,
    max,
    orderingRequired: !!(input.orderingRequired ?? input.ordering),
    visibility,
    allowCancel: !!(input.allowCancel ?? input.cancelAllowed),
    defaultSelection: input.defaultSelection == null ? null : structuredClone(input.defaultSelection),
    contextId: String(input.contextId || input.requestId || requestId),
    targeted: !!input.targeted,
    source: input.source == null ? null : structuredClone(input.source),
    sourceObjectId: input.sourceObjectId || input.sourceObject?.instanceId || input.sourceObject?.gameObjectId || null,
    metadata: input.metadata == null ? {} : structuredClone(input.metadata)
  };

  if (request.targeted && request.choiceType !== CHOICE_TYPE.TARGETS) {
    throw new Error('Targeted ChoiceRequests must use choiceType="targets"');
  }
  if (request.orderingRequired && request.max < 2 && request.choiceType !== CHOICE_TYPE.ORDER) {
    throw new Error('orderingRequired is only meaningful for multi-selection choices');
  }
  return request;
}

export function createChoiceResponse(input = {}) {
  const requestId = String(input.requestId || '').trim();
  if (!requestId) throw new Error('ChoiceResponse.requestId is required');
  return {
    requestId,
    selections: Array.isArray(input.selections)
      ? structuredClone(input.selections)
      : (input.selection === undefined ? [] : [structuredClone(input.selection)]),
    orderedSelections: Array.isArray(input.orderedSelections) ? structuredClone(input.orderedSelections) : null,
    division: input.division == null ? null : structuredClone(input.division),
    cancelled: !!input.cancelled,
    metadata: input.metadata == null ? {} : structuredClone(input.metadata)
  };
}

export function validateChoiceRequest(request) {
  try {
    createChoiceRequest(request);
    return { ok: true, errors: [] };
  } catch (error) {
    return { ok: false, errors: [error.message] };
  }
}
