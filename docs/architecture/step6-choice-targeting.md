# Step 6 — Universal Choice and Targeting Framework

## Purpose

Step 6 replaces the growing set of one-off choice/target conventions with one engine-owned protocol that can be consumed by human UI and AI without duplicating Magic legality rules.

The implementation deliberately preserves the existing Step 1–5 gameplay while introducing a migration-compatible choice layer. Existing `pendingChoice` records are normalized into canonical `ChoiceRequest` objects, while new engine systems can create native `ENGINE_CHOICE` requests directly.

## ChoiceRequest / ChoiceResponse

`src/engine/choices/ChoiceRequest.js` defines the standardized request/response contract.

A `ChoiceRequest` carries:

- `requestId`
- `requestingPlayer`
- `choiceType`
- `prompt`
- `legalOptions`
- optional composable `filter`
- `min` / `max`
- `orderingRequired`
- `visibility` (`public`, `private`, `hidden`)
- `allowCancel`
- `defaultSelection`
- `contextId`
- `targeted`
- source/source-object context
- metadata for specialized but still generic choice categories

The generic choice vocabulary covers boolean decisions, options, modes, numbers/X values, colors, names, players, targets, cards, permanents, ordering, divided quantities, and actions.

`ChoiceResponse` records the request id, selected values, optional ordered selections, optional division map, cancellation, and metadata.

## ChoiceService

`src/engine/choices/ChoiceService.js` owns the protocol lifecycle.

Responsibilities:

1. Normalize every existing legacy `pendingChoice` into a canonical immutable `ChoiceRequest` snapshot.
2. Create native engine choice requests for new systems without requiring card-specific UI.
3. Validate `ChoiceResponse` count, uniqueness, legal-option membership, filters, live object existence, permanent-zone status, target legality, and divided quantities.
4. Translate canonical responses back through temporary legacy adapters while older rule modules are migrated.
5. Expose engine-native generic legal `SUBMIT_CHOICE` actions.
6. Keep query access pure: legacy request ids are derived deterministically rather than being written into authoritative state during reads.

The public engine query is `GameEngine.getPendingChoiceRequest()`. Choice creation remains engine-internal; UI/AI can answer choices but cannot fabricate authoritative choices.

## Target filters

`src/engine/choices/TargetFilter.js` provides reusable composable filters with `AND`, `OR`, and `NOT` composition.

Supported filter dimensions include:

- object kind and zone
- type / subtype / all types
- controller / owner / player relationship
- mana value exact/min/max
- color / colors / all colors / colorless
- legendary status
- attacking / blocking
- tapped/untapped
- counters
- card id / card name
- nonland
- not-self
- custom predicate hooks for engine-owned exceptional conditions

`TargetingEngine` applies these filters in addition to its existing target-clause rules.

## Targeting versus non-targeting selection

The framework keeps target selection semantically separate from ordinary choices.

- Target requests use `choiceType: "targets"` and `targeted: true`.
- Target validation runs through `TargetingEngine`, so shroud, hexproof, protection, target relationships, and target-clause multiplicity apply.
- Non-targeting card/permanent choices use the generic choice/filter path and do **not** invoke shroud/hexproof/protection.

This prevents the common rules error where "choose" is treated as "target."

## Revalidation

Choice validation is not based only on the options that were displayed when the request opened.

At submission time:

- selected permanents must still be on the battlefield;
- filtered choices must still satisfy their live filter;
- target choices rerun full target validation;
- trigger-target legacy paths now carry their target source and source-object id so the same target engine can revalidate them;
- target legality is still rechecked again by the Step 5 resolution pipeline when the stack object resolves.

This preserves information about the original chosen targets while allowing partial/all-illegal resolution behavior later.

## UI integration

`src/components/ChoiceDialog.jsx` is a standardized renderer for engine-native `ChoiceRequest` data. It contains no card-rule logic. It renders engine-supplied options, min/max counts, ordering, cancellation, and numeric choices, then submits a `ChoiceResponse` through `GameEngine.submitChoice()`.

`App.jsx` consumes `getPendingChoiceRequest()` and uses `ChoiceDialog` for native Step 6 choices. Existing specialized displays remain as compatibility UI for legacy choice records and can be retired incrementally as those rule modules migrate to native requests.

## AI integration

`AIController` reads the same `ChoiceRequest` snapshot for native choices and returns a structured `SUBMIT_CHOICE` action. Validation remains authoritative in the engine; a buggy AI choice cannot bypass the request constraints.

Legacy AI choice heuristics remain available during migration, but all legacy requests are now normalizable to the same public protocol.

## Replay

When `submitChoice()` succeeds, the replay entry stores:

- the submitted choice action/response;
- the canonical `ChoiceRequest` snapshot that was active when the answer was submitted.

This makes the exact decision context and answer reproducible.

## Compatibility boundary

Step 6 does not delete existing card-specific rule continuations. Instead it wraps them:

- old code may still set a legacy `pendingChoice`;
- the engine exposes that state as a canonical `ChoiceRequest`;
- callers may answer with either the old action shape or a canonical `ChoiceResponse`;
- `ChoiceService` translates canonical responses to the existing resolver path;
- future steps can migrate producers one subsystem at a time without changing UI/AI protocol.

## Verification

Dedicated Step 6 tests cover:

- 13 standardized choice classes;
- 20 representative target/filter patterns;
- AND/OR/NOT composition;
- player/opponent target relations;
- shroud separation between target and non-targeting choices;
- native choice submission and replay;
- stale permanent revalidation;
- target revalidation after hexproof changes;
- exact/up-to/any-number/order/division constraints;
- AI use of the same request protocol;
- standardized UI source integration.

See `STEP6_COMPLETION_REPORT.md` for the full acceptance and regression status.
