# Step 29 — AI Migration to Authoritative Legal Actions

Status: **COMPLETE**

## Objective

Separate AI strategy from rules enforcement. The AI may evaluate board state and rank options, but it may only choose from actions exposed by `GameEngine.getLegalActions()` and may only submit through validated engine gateways. Hidden information remains inaccessible to strategy code, and AI decisions can be recorded alongside replay actions.

## Architecture

Step 29 adds a dedicated strategy boundary under `src/ai/`:

- `AIEngineFacade.js` — a narrow read/submit facade. It exposes player-scoped immutable snapshots, public battlefield/rules queries, authoritative legal actions, and validated submission APIs. The underlying `GameEngine` is stored in a JavaScript private field, so strategy code cannot reach authoritative state through the facade.
- `AIKnowledgeView.js` — refreshes the AI player's redacted snapshot and known-information view and fails closed if a hidden opponent card placeholder ever contains a card id/object id.
- `AILegalActionAdapter.js` — consumes `getLegalActions()`, groups actions by strategic class, authorizes strategy output, and revalidates completed/template actions through engine legality before submission.
- `AIActionScorer.js` — pluggable strategy-only scoring and threshold registry. It contains no legality decisions.
- `AIChoiceEvaluator.js` — centralized evaluators for targeting/ordering/payment/search/combat-adjacent and other pending choices. Choice strategy consumes the same legal choice actions surfaced by the engine.
- `AIController.js` — now orchestrates the knowledge view, legal-action adapter, scorer, and choice evaluator instead of mixing rules legality with strategy.

## Authoritative legal-action flow

The production AI flow is now:

1. Refresh the AI player's redacted immutable state.
2. Fetch `GameEngine.getLegalActions(playerId)`.
3. Rank only those legal actions with strategy scorers.
4. For template actions such as attacker/blocker declarations or multi-card choices, construct the strategic completion and revalidate it through the legal-action adapter.
5. Submit through `submitAction()`, `submitChoice()`, or `passPriority()` via the AI facade.
6. Record the accepted AI decision as replay metadata.

A strategy routine can return a bad action, but `AILegalActionAdapter` refuses to submit it. The engine still performs its own final validation, preserving defense in depth.

## Strategy / rules separation

`AIActionScorer` is deliberately ignorant of rules legality. Existing expert heuristics remain available for:

- board development;
- mana/ramp sequencing;
- threat removal;
- stack interaction;
- protection and card advantage;
- commander pressure/lethal detection;
- landfall/counter/token/Saga/legend synergies;
- activated-ability value;
- multiplayer attack/block planning.

Those heuristics now operate only after the authoritative engine has produced the legal candidate set.

## Choice evaluators

Pending choices are routed through `AIChoiceEvaluator`, including:

- engine-native generic `ChoiceRequest` responses;
- combat damage ordering;
- legend rule and commander-zone movement;
- pregame actions;
- Ward and optional mana payments;
- optional triggers/effects;
- tap/untap decisions;
- trigger/replacement ordering;
- proliferate selections;
- explore/Hakbal/Cultivate/Sisay/Scry decisions;
- trigger targets and creature-type choices;
- library/effect-card choices;
- copy targets/permanents;
- attachment-entry hosts;
- land entry life/reveal choices;
- hideaway selection/play;
- mulligan bottoming and cleanup discards.

The evaluator returns strategy selections, while `AILegalActionAdapter` and `GameEngine` enforce legality.

## Hidden-information boundary

AI strategy receives `getPlayerStateSnapshot(aiPlayerId)`, not the authoritative state. Opponent hidden hand/library/exile cards remain redacted placeholders unless the rules have made them known to that player.

`AIEngineFacade` refuses requests for another player's private snapshot/known-information view. It provides only public relationship, battlefield, derived-characteristic, combat, legal-action, and submission queries beyond the AI's own private view.

This prevents strategy code from accidentally using the full internal game state to inspect an opponent's hand or library.

## Deterministic strategy ordering

AI action sorting now has an explicit stable action key after strategic score/type ordering. Equal-score actions therefore resolve through stable action identity rather than unspecified strategy iteration order.

With the same seeded game setup, Step 29 tests reproduce the same semantic AI decision sequence. Step 30 will generalize seeded randomness/replay across the entire engine; Step 29 establishes deterministic AI behavior on top of the current seeded game service.

## Replay decision metadata

`GameEngine` now exposes:

- `recordAIDecision(playerId, record)`
- `getAIDecisionLogSnapshot()`

`serializeReplay()` includes `aiDecisions`. Each accepted production AI decision records:

- decision sequence;
- corresponding authoritative action sequence;
- player;
- pre-action turn/phase;
- AI policy version;
- decision class;
- legal-action count;
- submitted action;
- strategic score/threshold when relevant.

Only strategy metadata is recorded; hidden opponent information is never included.

## Production automation

`App.jsx` no longer calls engine submission APIs directly for opponent strategy output. It creates an `AIController`, obtains its action, and submits through `AIController.submit()`. That path refreshes the legal action set, refuses unauthorized strategy output, submits through the engine's validated gateway, and records replay decision metadata.

Human auto-pass behavior remains separate and continues to use the engine's public priority API.

## Verification

Dedicated Step 29 coverage verifies:

1. Opponent hidden hand/library data is redacted from the AI knowledge view.
2. The AI facade cannot request another player's private snapshot.
3. Fabricated strategy actions are rejected before submission.
4. Deliberately buggy strategy output cannot mutate game state illegally.
5. Action scoring remains a pluggable strategy-only interface.
6. Choice evaluator output must pass the authoritative legal-action adapter.
7. Identically seeded games produce the same semantic AI decision sequence.
8. Accepted AI decisions are serialized alongside authoritative replay actions.
9. Production opponent automation submits through `AIController.submit()` rather than bypassing the guard.

Commands:

```bash
npm run test:step29
node --test tests/step*.test.js
npm run check:architecture
npm run check-db
npm run check-support
npm run check-oracle-templates
```

## Acceptance status

- AI cannot perform an illegal action even when strategy code is wrong: **PASS**.
- AI decisions are reproducible under the same seeded game setup: **PASS**.
- Hidden-information tests detect no AI access to opponent private zones: **PASS**.
- Existing automated turns continue through the priority/choice engine: **PASS**.

## Gate 4 status

Step 29 completes **Release D — Advanced Rules / Game Completeness (Steps 19–29)**. Loops, pregame rules, permissions, copy, attachments, counters, tokens, damage, library operations, timing, and AI legality migration are now integrated.

## Next workflow step

**Step 30 — Deterministic Replay and Seeded Randomness.**
