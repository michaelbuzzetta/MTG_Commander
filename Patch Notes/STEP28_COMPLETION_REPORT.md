# Step 28 Completion Report

Status: **COMPLETE**

## Workflow target

Step 28 implements **Timing Restrictions and Activation/Casting Windows**: timing legality is now a first-class engine rule for spells, abilities, land plays, and supported special actions.

## Implemented

- Added `src/engine/timing/` with normalized timing permissions, a centralized timing service, structured timing errors, diagnostics, snapshots, and usage records.
- Integrated timing validation into the authoritative `GameEngine.validateAction()` path before costs are paid or game state mutates.
- Centralized default instant/sorcery cast timing and existing flash/as-though-flash permissions.
- Centralized activated-ability timing, including legacy `sorcerySpeed` compatibility and richer declarative timing objects.
- Added timing predicates for your-turn-only, combat-only, exact steps/phase groups, before/after steps, custom script conditions, once-per-turn, once-per-combat, and not-used-since-step restrictions.
- Added distinct combat-scope tracking so once-per-combat restrictions reset for extra combats within the same turn.
- Corrected Foretell to its special-action timing: during your turn while you have priority, rather than incorrectly requiring sorcery timing.
- Kept land play as an active-player main-phase/empty-stack special action and Encore at sorcery timing.
- Extended canonical game state with `timingUsage` and `timingDiagnostics`, including hydration, validation, restore, replay snapshot, and public query APIs.
- Updated the Step 16 card-script compiler to preserve timing declarations on activated abilities, spell timing, and modes.
- Updated script validation to reject unknown timing fields/speeds and validate custom timing conditions.
- Legal action generation automatically filters all timing-illegal actions because UI and AI candidates pass through the same engine validation path.

## New public/engine surfaces

- `GameEngine.getTimingSnapshot()`
- `GameEngine.getTimingDiagnostics()`
- `TimingService`
- `TimingPermission`
- `TimingError`
- `TIMING_SPEED`
- `TIMING_ACTION`

## Verification

- Dedicated Step 28 suite: **14/14 passed**.
- All workflow Step 1–28 suites: **353/353 passed**.
- Core + Explorers integration suites: **47/47 passed**.
- Architecture boundary check: **PASS**.
- Card/deck schema validation: **647 cards / 13 decks — PASS**.
- Step 17 support-data validation: **26 fully supported / 621 partial / 0 unsupported — PASS**.
- Step 18 Oracle compiler validation: **4 exact / 643 review-required — PASS**.
- Production build was not attempted because `node_modules` is not installed in this sandbox; engine/test verification does not require the Vite dependencies.

## Acceptance criteria

- Sorceries cannot be cast at instant speed without permission: **PASS**.
- Special actions work without abusing stack/sorcery timing: **PASS**.
- Once-per-turn abilities reset correctly, with per-combat and step-relative usage also covered: **PASS**.
- UI/AI legal-action lists are authoritative for timing: **PASS**.

## Files of interest

- `src/engine/timing/TimingService.js`
- `src/engine/timing/TimingPermission.js`
- `src/engine/timing/TimingTypes.js`
- `src/engine/GameEngine.js`
- `src/engine/GameState.js`
- `src/engine/state/GameStateSchema.js`
- `src/engine/state/types.d.ts`
- `src/cards/scripts/CardScriptCompiler.js`
- `src/cards/scripts/ScriptValidator.js`
- `tests/step28-timing-restrictions.test.js`
- `docs/architecture/step28-timing-restrictions.md`

Next: **Step 29 — AI Migration to Authoritative Legal Actions.**
