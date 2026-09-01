# Category 2 Implementation Notes

## Scope
Category 2: Action Legality, Priority, and Turn Structure.

This update is layered on top of the completed Category 1 data/architecture repair and does not revert the Category 1 source-of-truth work.

## Implemented repairs

### BUG-001 — Rules / action validation
- Added a single authoritative `GameEngine.validateAction()` + `GameEngine.perform()` gateway for externally initiated actions.
- Public compatibility methods such as `cast()`, `playLand()`, `activateMana()`, `activateAbility()`, `mulligan()`, and `passPriority()` route back through that gateway.
- Validation now checks the acting player, card ownership/location, current zone, priority, turn/phase timing, spell type, mana affordability, ability source/control, tap/summoning-sickness restrictions, declaration legality, pending choices, and target specifications when a card/ability defines them.
- `getLegalActions()` remains a UX/output aid and derives spell/land/ability options by asking the authoritative validator.
- Combat state-mutating methods require an engine-only private token, preventing direct attacker/blocker/damage mutation from bypassing the action gateway.

### BUG-002 — Commander timing
- Commanders now use the same normal spell-timing path as other spells.
- Non-Flash creature commanders require active-player main phase timing with an empty stack.
- Commander tax remains part of the normal casting-cost path and increments only when the commander is cast from the command zone.

### BUG-003 — Priority
- A player who casts a spell or activates an ability retains priority after placing the object on the stack.
- Consecutive-pass tracking resets when a player takes an action.
- Two consecutive passes resolve exactly one top stack object if the stack is nonempty; the active player receives priority after resolution.
- With an empty stack, two consecutive passes advance the current step/phase.

### BUG-004 — Turn / combat priority
- Turn-based actions and priority windows are now represented separately with `turnActionPending`.
- Draw performs the turn-based draw and then opens priority instead of auto-advancing.
- Attackers are declared first; then priority opens in the declare attackers step.
- Blockers are declared first; then priority opens in the declare blockers step.
- First-strike combat damage is created only when applicable, resolves as a turn-based action, and then opens a priority window.
- Normal combat damage resolves as a turn-based action and then opens a priority window.
- Combat no longer jumps directly from blockers through all damage to end combat.

### BUG-009 / BUG-010 — Cleanup and cleanup choice
- Only the active player discards to maximum hand size.
- Cleanup hand-size discard is an explicit `CLEANUP_DISCARD` decision state.
- The acting player must select the exact cards to discard.
- Damage and temporary modifiers are cleared during cleanup.
- If cleanup creates triggers/state-based-action consequences that put objects on the stack, the active player receives priority and another cleanup step occurs after the stack/priority window is finished.
- If nothing requires priority, the turn ends without an unnecessary priority window.

### BUG-011 / BUG-012 — Pregame / mulligan
- Added a real pregame mulligan state before turn one.
- Mulligan actions cease to be legal once pregame ends.
- Commander/London flow is modeled with the first mulligan free.
- Each mulligan redraws seven cards; required bottoming happens only after the player keeps.
- Bottom cards are selected explicitly by the player rather than removed automatically.
- Mulligan reshuffling uses the existing Fisher-Yates `shuffle()` utility instead of `array.sort(() => rng() - .5)`.
- UI includes an opening-hand screen with Mulligan, Keep Hand, and explicit bottom-card selection.

### BUG-013 — Initialization
- `start()` now rejects a second call instead of dealing another opening hand.
- Added an explicit `reset()` path for deliberate new-game initialization.

## UI / AI integration
- Phase messaging now distinguishes turn-based declaration/damage events from open-priority windows.
- The main action button now uses `turnActionPending`, so a declaration is not accidentally submitted twice while priority is open in the same step.
- Cleanup discard selection is exposed in the hand UI.
- AI understands pregame keep decisions, mulligan/cleanup card choices, declaration states, and the revised priority machine.
- Block assignment UI removes a creature from its previous block before assigning it elsewhere, matching the engine's single-block assignment validation.

## Regression coverage
The test suite now includes 53 passing tests, including new regressions for:
- duplicate `start()` protection;
- pregame-only mulligans;
- explicit London/Commander bottom selection;
- opponent-owned-card cast rejection;
- commander sorcery timing;
- caster-held priority;
- activator-held priority;
- draw-step priority;
- priority after attackers;
- priority after blockers;
- first-strike priority before regular damage;
- active-player-only cleanup discard;
- explicit cleanup discard choice;
- cleanup repetition after a cleanup trigger;
- protection against direct combat mutator bypass;
- 100 randomized stress games.

## Verification performed in this environment
- `npm run check-db`: PASS — 44 cards and 6 decks validated.
- `npm test`: PASS — 53/53 tests.
- Production Vite build could not be executed in this sandbox because the uploaded source archive does not include `node_modules` and the sandbox package cache/network could not supply the missing packages. The source archive itself remains dependency-clean (no partial `node_modules` is included). Run `npm install` / `npm ci` followed by `npm run build` on a network-enabled development machine for the final browser bundle check.
