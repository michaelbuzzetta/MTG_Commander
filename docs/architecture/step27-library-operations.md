# Step 27 - Library Search, Reveal, Look, Reorder and Top-of-Library Operations

Step 27 centralizes library interaction under `src/engine/library/` so search restrictions, hidden information and top-of-library mechanics no longer need card-specific library mutation logic.

## Core services
- `SearchRequest` normalizes searching player, library owner, chooser, min/max count, fail-to-find policy, qualitative filters, destination plans, reveal policy, search scope and shuffle rules.
- `LibraryOperationService` owns search preparation/selection/finalization plus private look, public reveal, top-N reorder, bottoming, scry, surveil and top-iteration primitives.
- Search requests pass through the canonical `SEARCH` event before candidates are shown, so Step 10 replacement effects and Step 21 search locks act before selection.
- Aven-Mindcensor-style scope changes and Opposition-Agent-style choice control are represented at the search-request layer.
- Hidden library identities are exposed only to the authorized chooser through the existing viewer snapshot/known-information system.

## Fail to find
A hidden-zone search with a stated quality defaults to allowing failure to find. Unrestricted searches require the available required count. Selection is revalidated against the live library before resolution.

## Shared top-of-library primitives
- `lookTop`
- `revealTop`
- `reorderTop`
- `putOnBottom`
- `moveTopToZone`
- `scry`
- `surveil`
- `exileUntil`
- `cascade`
- `discover`

Cascade and discover use the same top-iteration/exile/bottom primitives and grant explicit exile casting permissions for the hit card.

## Migrated paths
- Step 16 scripted search primitive.
- Cultivate candidate selection and split battlefield/hand destination plan.
- Sisay legendary-permanent search candidate generation.
- Myriad Landscape search candidate generation/finalization.
- Generic basic-land and land-subtype search effects.
- Existing one-card scry resolution now delegates to the shared scry primitive.

## Hidden information
Private looks update only the authorized viewer's knowledge model; public reveals update all players; shuffling clears library knowledge. Other player snapshots redact search candidates and the pending choice.
