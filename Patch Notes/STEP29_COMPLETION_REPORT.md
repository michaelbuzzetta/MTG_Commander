# Step 29 Completion Report

Status: **COMPLETE**

## Workflow target

Step 29 implements **AI Migration to Authoritative Legal Actions**: AI strategy is separated from rules enforcement, receives player-scoped knowledge plus engine-generated legal actions, and can no longer bypass the authoritative submission/choice gateways.

## Implemented

- Added a narrow `AIEngineFacade` so AI strategy code is never handed the mutable/internal `GameEngine` surface.
  - Private player snapshots and known-information snapshots are self-scoped.
  - Public board/rules queries remain available through read-only APIs.
  - All mutation-capable AI paths use validated `submitAction`, `submitChoice`, or `passPriority` gateways.
- Added `AIKnowledgeView` as the AI's knowledge boundary.
  - Refreshes from `getPlayerStateSnapshot()` and legal known-information APIs only.
  - Fails closed if an opponent hidden-zone placeholder ever exposes a card/object identity.
- Added `AILegalActionAdapter` around `getLegalActions()`.
  - Normalizes engine-issued casts, land plays, activations, combat actions, special actions, choices, and pass actions.
  - Requires a candidate to correspond to an offered engine action/template and revalidates it with `isActionLegal()` before submission.
  - Provides an engine-authorized pass fallback where passing is actually legal.
- Refactored `AIController` so strategy ranks **only engine-issued legal actions**.
  - Existing spell, land, activation, combat, multiplayer-threat, removal-discipline, synergy, and lethal heuristics are retained as strategy only.
  - Constructed combat/choice responses are re-authorized against the current legal-action set before submission.
  - Deliberately buggy strategy output is rejected before authoritative state can mutate.
- Added `AIActionScorer` as an extensible scoring/threshold interface.
  - Rules legality is explicitly outside the scorer.
  - Current cast, commander, activation, Foretell, Encore, and land strategy plugs into this interface.
- Added `AIChoiceEvaluator` for specialized engine choices.
  - Handles standardized target/card selection, scry, searches, trigger ordering, replacement ordering, combat ordering, commander/legend decisions, proliferate, attachment/copy choices, mulligan/cleanup selections, and other currently surfaced choice classes.
  - Every produced response still passes through the legal-action adapter and engine validation.
- Preserved deterministic AI decision ordering.
  - Equal strategy scores use stable action identity ordering rather than incidental iteration order.
  - Same-seed test games produce the same semantic AI action sequence.
- Added AI decision metadata to authoritative replay serialization.
  - Records policy version, player, turn/phase, decision kind, legal-action count, chosen action, score, threshold, and action-sequence correlation.
  - Step 30 remains responsible for centralizing all engine randomness and full replay/seed identity guarantees.
- Updated production opponent automation in `App.jsx`.
  - The UI now asks `AIController` to choose **and submit** opponent actions.
  - It no longer bypasses the AI guard by directly submitting the AI's chosen action to `GameEngine`.
- Added public immutable engine query helpers required by the migrated AI without exposing mutable state.
- Added Step 29 architecture documentation, package test command, README checkpoint, and acceptance/regression tests.

## New AI surfaces

- `AIEngineFacade`
- `AIKnowledgeView`
- `AILegalActionAdapter`
- `AIActionScorer`
- `AIChoiceEvaluator`
- `GameEngine.recordAIDecision()`
- `GameEngine.getAIDecisionLogSnapshot()`

## Verification

- Dedicated Step 29 suite: **8/8 passed**.
- All workflow Step 1–29 suites: **361/361 passed**.
- Legacy/existing AI behavior suite: **16/16 passed**.
- Core + Explorers integration suites: **47/47 passed**.
- Architecture boundary check: **PASS**.
- Card/deck schema validation: **647 cards / 13 decks — PASS**.
- Step 17 support-data validation: **26 fully supported / 621 partial / 0 unsupported — PASS**.
- Step 18 Oracle compiler validation: **4 exact / 643 review-required — PASS**.
- Production build was not attempted because `node_modules` is not installed in this sandbox; engine/test verification does not require the Vite dependencies.

## Acceptance criteria

- AI cannot perform an illegal action even if strategy code is buggy: **PASS**.
- AI decisions are reproducible under the same seed at the semantic action level: **PASS**.
- Hidden-information tests prove AI cannot request or inspect another player's private hand/library identities: **PASS**.
- Existing automated turns continue through priority/choice and authoritative submission paths: **PASS**.

## Release D / Gate 4 status

**Gate 4 — Full-game completeness is complete.** Steps 19–29 now cover loops, pregame rules, permissions/restrictions, copy, attachments, counters, tokens, damage, library operations, timing, and AI legal-action migration.

## Files of interest

- `src/ai/AIEngineFacade.js`
- `src/ai/AIKnowledgeView.js`
- `src/ai/AILegalActionAdapter.js`
- `src/ai/AIActionScorer.js`
- `src/ai/AIChoiceEvaluator.js`
- `src/ai/AIController.js`
- `src/engine/GameEngine.js`
- `src/engine/public/api.js`
- `src/App.jsx`
- `tests/step29-ai-authoritative-actions.test.js`
- `docs/architecture/step29-ai-authoritative-actions.md`

Next: **Step 30 — Deterministic Replay and Seeded Randomness.**
