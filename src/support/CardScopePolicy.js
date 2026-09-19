export const CARD_SCOPE_CLASSIFICATION = Object.freeze({
  IN_SCOPE: 'in-scope',
  FORMAT_EXCLUDED: 'format-scope-exclusion'
});

/**
 * Practical-100's executable card scope is the Commander card pool, not every
 * auxiliary/non-format object carried by Scryfall's Oracle bulk file.
 *
 * - Commander-legal and Commander-banned cards remain rules-execution scope.
 *   Banned cards are still real Magic cards and may appear in sandbox/replay
 *   scenarios; strict deck construction rejects them separately.
 * - Identities explicitly marked `not_legal` in Commander are reviewed and
 *   recorded as format-scope exclusions. This includes tokens, emblems,
 *   schemes, Vanguard/Plane objects, art cards, acorn/non-format cards, and
 *   digital-only identities that are not part of Commander deck construction.
 * - Missing legality metadata fails closed into scope rather than being
 *   silently excluded.
 */
export function classifyCatalogCardScope(card = {}) {
  const commanderLegality = card?.legalities?.commander || null;
  if (commanderLegality === 'not_legal') {
    return {
      inScope: false,
      classification: CARD_SCOPE_CLASSIFICATION.FORMAT_EXCLUDED,
      commanderLegality,
      reason: 'Scryfall marks this Oracle identity as not legal in Commander; it is explicitly outside the declared Commander card-execution scope.'
    };
  }
  return {
    inScope: true,
    classification: CARD_SCOPE_CLASSIFICATION.IN_SCOPE,
    commanderLegality,
    reason: commanderLegality === 'banned'
      ? 'Commander-banned card remains in rules-execution scope; strict deck validation must reject it for sanctioned deck construction.'
      : commanderLegality === 'legal'
        ? 'Commander-legal Oracle identity is inside the declared card-execution scope.'
        : 'Commander legality metadata is absent; practical-100 fails closed by retaining this identity inside execution scope until reviewed.'
  };
}
