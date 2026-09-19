# Step 4 — Turn, Phase, Step, and Turn-Based Action Engine

This checkpoint replaces the previous fixed-index turn progression with an explicit rules-owned turn state machine while preserving the Step 1 public action boundary and the Step 3 event boundary.

## Module layout

- `src/engine/turn/TurnStructure.js` — canonical turn phase/step definitions and sequence helpers.
- `src/engine/turn/TurnEngine.js` — authoritative turn ordering, phase/step transitions, extra/skipped turn scheduling, altered turn structures, cleanup repetition, and turn history.
- `src/engine/turn/TurnBasedActions.js` — rules-defined actions that do not use the stack.
- `src/engine/turn/index.js` — Step 4 exports.

`GameEngine` remains the owner of the public API. Existing internal `_beginPhase`, `_advancePhase`, and `_finishTurn` compatibility methods now delegate to `TurnEngine` instead of independently managing the fixed `PHASES` array.

## Canonical normal turn structure

The engine models these ordered steps:

1. Untap
2. Upkeep
3. Draw
4. Precombat main
5. Beginning of combat
6. Declare attackers
7. Declare blockers
8. First-strike combat damage, only when created by the rules
9. Regular combat damage
10. End of combat
11. Postcombat main
12. End step
13. Cleanup

Each sequence node carries a phase-group classification, priority policy, turn-based-action kind, occurrence number, origin, and stable deterministic sequence id.

The phase groups are:

- Beginning
- Precombat main
- Combat
- Postcombat main
- Ending

The existing `state.phase` strings are preserved for compatibility with current UI/card data, while `turnSequence`, `turnStepId`, `turnPhaseGroup`, and `phaseIndex` provide the richer authoritative model.

## Turn-based actions

`TurnBasedActions` separates rules-defined actions from stack actions.

### Untap

- No player receives priority in the untap step.
- Phased-out permanents are phased in by the current compatibility behavior.
- Applicable permanents untap through the Step 3 untap event path.
- Summoning-sickness/control-duration state is refreshed.
- Land-play counters and turn-scoped casting permissions are refreshed.
- The engine automatically advances into upkeep.

### Draw

- The active player draws for turn before draw-step priority is granted.
- The draw still routes through the Step 3 `DRAW_CARD` / `MOVE_ZONE` event machinery.

### Declare attackers / blockers

- Declarations are explicit turn-based actions.
- They do not go on the stack.
- Existing combat legality remains authoritative.
- Priority opens only after the required declaration has completed.
- Multiplayer defender blocker declarations remain sequentially collected before combat continues.

### Combat damage

- First-strike and regular combat damage are turn-based actions.
- A first-strike damage step is only entered when at least one relevant creature has first strike or double strike.
- Priority opens after each created combat-damage step.

### Cleanup

- The active player discards to maximum hand size when required.
- Damage marked, prevention shields, and until-end-of-turn compatibility modifiers are removed.
- Cleanup normally grants no priority.
- If cleanup creates triggers, state-based actions, a choice, or a stack object, the engine opens the required priority window.
- After that window finishes, `TurnEngine.repeatCleanup()` creates another cleanup step instead of silently ending the turn.

## Altered turn structures

The Step 4 scheduler supports generic turn modifications instead of hard-coded card branches.

### Extra turns

`addExtraTurn(playerId, count)` queues extra turns immediately after the current turn. Multiple newly created extra turns are LIFO, matching the insertion semantics of “after this one.” The engine separately tracks the normal turn-order anchor so an extra turn taken by the player who was already next in turn order does **not** incorrectly consume that player’s normal turn.

Compatibility field `state.extraTurns` is retained for current card/tests and old serialized states, while `extraTurnQueue`, `turnKind`, and `normalTurnPlayer` provide the authoritative scheduler state.

### Skipped turns

`skipNextTurns(playerId, count)` consumes future turns atomically and records each skip in `skippedTurnHistory` plus the normal history log. Skipping a normal turn advances the normal-turn anchor; skipping an extra turn does not.

### Extra / skipped steps and phases

The turn sequence can be altered through reusable primitives:

- `addExtraUpkeeps(playerId, count)`
- `skipNextDrawSteps(playerId, count)`
- `skipNextCombatPhases(playerId, count)`
- `skipNextStep(playerId, stepKey, count)`
- `skipNextPhaseGroup(playerId, phaseGroup, count)`
- `addExtraCombatAfterCurrent({ includeMainAfter })`
- `addExtraMainPhaseAfterCurrent()`

The corresponding generic EffectEngine hooks are available for `extraTurn`, `skipNextTurn`, `extraUpkeep`, `skipNextDrawStep`, `skipNextCombat`, `extraCombat`, and `extraMainPhase` scripts.

Repeated main/combat/upkeep entries are represented as ordinary sequence nodes with different occurrences/origins, so UI and AI do not need separate special-case phase logic.

## Priority policy at the Step 4 boundary

Step 4 defines **when** priority may exist around turn-based actions:

- no priority during untap;
- priority after upkeep/draw/main/combat windows/end step;
- attacker/blocker declaration must complete first;
- combat damage happens before the post-damage priority window;
- cleanup grants priority only when rules activity requires it.

The complete tournament-correct stack and multiplayer priority manager remains the explicit responsibility of Step 5. Step 4 intentionally retains the existing pass-cycle implementation behind the new state machine rather than implementing Step 5 early.

## Trigger timing integration

Every entered step continues to publish `PHASE_BEGIN` with richer metadata:

- `phase`
- `phaseGroup`
- `stepId`
- `occurrence`
- cleanup iteration when relevant

This preserves existing card data while allowing exact-step trigger conditions to fire from the authoritative turn engine. Full generic APNAP trigger ordering remains Step 9.

## Turn/replay history

Each completed turn records:

- turn number
- active player
- player turn order
- the concrete sequence used for that turn
- origin/occurrence information for altered steps

`serializeReplay()` now includes `turnHistory`, `skippedTurnHistory`, and a current `turnState` snapshot in addition to Step 1 action history and Step 3 event history.

## State serialization

The canonical GameState type now includes the Step 4 fields. `GameStateSchema` hydrates older Step 2/3 serialized states with default turn-engine fields so the migration remains backward-compatible within schema version 2.

## Acceptance coverage

`tests/step4-turn-engine.test.js` verifies:

1. complete normal phase/step definitions and priority exceptions;
2. no-spell traversal through every applicable step;
3. exact upkeep trigger placement;
4. draw-before-priority semantics;
5. extra upkeep + skipped draw + skipped combat sequencing;
6. deterministic extra-combat/main insertion;
7. extra turn ordering plus skipped-turn consumption;
8. targeted extra turns do not consume the target player’s normal scheduled turn;
9. cleanup-trigger priority followed by an additional cleanup step;
10. turn/replay history metadata.

Existing combat, core cleanup, multiplayer, AI, deck, Step 1–3, and stress suites remain green.

## Deliberate Step 4 boundary

This checkpoint does **not** implement Step 5’s complete stack/priority model, Step 6’s universal choice framework, or later rules systems. The new turn engine is the dependency layer those systems will use.
