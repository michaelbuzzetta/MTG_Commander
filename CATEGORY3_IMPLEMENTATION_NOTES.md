# Category 3 Implementation Notes — Mana System

Category 3 implements the mana-system repair pass from the audit/repair plan and is intentionally limited to BUG-005 through BUG-008.

## BUG-005 — Mana pools
- Kept the Category 2 phase-transition centralization and verified that `_advancePhase()` empties **both players'** mana pools before the next step/phase begins.
- Turn transitions also clear both pools defensively.
- Added a regression test that floats mana for both players and confirms both pools are empty after a normal priority-driven phase transition.

## BUG-006 — Summoning sickness on tap-symbol mana abilities
- Mana-source discovery now excludes summoning-sick creatures whose mana ability requires tapping.
- This restriction now applies consistently to manual legality, `canAfford()`, and auto-tap/payment planning.
- Added `controlledSinceTurn` instance metadata and a `changeController()` engine helper so control changes re-establish summoning sickness for creatures and can be tracked across turns.
- Untap-step processing clears summoning sickness only after the creature has been continuously controlled since before that turn began.
- Haste remains an exception to the tap-cost restriction.

## BUG-007 — Any-color mana choice
- Any-color mana abilities now expose one legal `ACTIVATE_MANA` action per valid color in the player's color identity.
- The engine requires and validates `manaColor`; it no longer silently chooses the first color.
- The React table prompts the human player to choose a color when a permanent has multiple legal any-color actions.
- Invalid/missing color selections are rejected by the authoritative action gateway.

## BUG-008 — Mana solver
- Replaced the greedy source-order algorithm with a deterministic constrained payment solver.
- The solver consumes existing floating mana first, then evaluates legal source/production choices while preventing reuse of the same permanent.
- It prefers fewer activations and fixed sources before flexible any-color sources, preserving flexible sources for requirements only they can satisfy.
- `canAfford()` and `autoTapAndPay()` now call the exact same `solvePayment()` implementation.
- The solver returns an explicit activation plan containing permanent, ability, chosen color, produced mana, and tap requirement.
- Auto-tap executes the returned plan atomically and rolls back source/pool mutations if payment unexpectedly fails.
- Added the audit regression: Command Tower listed before Plains correctly pays `{W}{U}` by using Plains for W and Tower for U.

## Regression coverage added
`tests/mana.test.js` covers:
1. both players' mana pools emptying at phase transitions;
2. summoning-sick creature mana abilities being unavailable to manual and automatic payment paths;
3. control changes restoring summoning sickness;
4. explicit any-color choices and invalid-choice rejection;
5. Command Tower + Plains paying `{W}{U}` independent of battlefield order;
6. shared solver behavior for generic plus true colorless requirements.

## Verification in this environment
- `npm run check-db`: **PASS** — 44 cards and 6 decks validated.
- `npm test`: **PASS** — 59/59 tests, including 6 new Category 3 mana regressions and the 100-game stress test.
- `npm run build`: **not executable in this sandbox snapshot** because the uploaded archive intentionally does not contain `node_modules`, so the local Vite binary is unavailable (`vite: not found`). No partial dependency install was added to the deliverable.
