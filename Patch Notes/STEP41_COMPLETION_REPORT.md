# Step 41 Completion Report — Unsupported-Interaction Fail-Safes

## Scope

Step 41 implements the workflow requirement that unsupported card/rules behavior must never be silently approximated in authoritative gameplay or official simulation output. Unsupported capabilities now produce a structured diagnostic before mutation when possible; transactional resolution/action failures are rolled back; permissive approximations are isolated to explicitly labeled sandbox mode; and strict/official simulation paths run support preflight before execution.

## Implemented deliverables

### Structured `UnsupportedInteraction` diagnostics
- Added `src/engine/diagnostics/UnsupportedInteraction.js`.
- Defines `UNSUPPORTED_INTERACTION` as a first-class error with a stable diagnostic ID.
- Captures card/object identity, ability/script node, context, rules version, game/turn/phase, event/stack/action identifiers, current support status, suggested support status, rollback outcome, state hash, replay metadata, and recent event context where available.
- Keeps developer diagnostics outside authoritative `GameState`, allowing rollback without losing the reproduction record.

### Fail-before-mutation enforcement
- `GameEngine.validateAction()` now checks card support before costs or authoritative mutation.
- Explicitly unsupported cards stop at action preflight with a structured error.
- Unknown effect nodes in `EffectEngine` no longer disappear silently.
- Missing authoritative event handlers in `EventDispatcher` no longer disappear silently.
- Standard and strict modes halt on missing behavior instead of guessing.

### Transaction rollback / exact checkpoints
- Stack resolution uses the existing resolution transaction and now records `resolution-checkpoint-restored` on an unsupported failure.
- The outer action dispatcher creates a pre-action replay checkpoint and restores it for unsupported execution failures outside stack resolution.
- Validation-time failures occur before costs/state mutation and therefore require no rollback.

### Strict/preflight enforcement
- Added engine APIs for deck support preflight, unsupported diagnostics/policy, and simulation-statistics eligibility.
- Strict mode requires every selected card to be `strictEligible` before authoritative game state is created.
- `HeadlessSimulationRunner` now has explicit official-simulation support; official batches force strict support and reject sandbox mode.
- Performance/benchmark simulations containing current partially certified decks now require an explicit `allowPartialSimulationOverride: true`; the override is recorded in replay metadata rather than remaining implicit.

### Explicit sandbox mode
- Added `standard`, `strict`, and `sandbox` unsupported-interaction modes.
- Sandbox may continue only through an explicit, recorded approximation. The generic fallback for an unknown effect/event node is a labeled no-op.
- Sandbox is marked `statisticsEligible: false` and carries exclusion reasons, so it cannot be mistaken for official simulation output.
- Official headless simulation rejects sandbox mode.

### Replay and diagnostic persistence
- Replay metadata now records game ID, simulation purpose, unsupported-interaction mode, partial-support override state, diagnostic count, and statistics eligibility.
- Serialized replays include the unsupported-interaction policy and diagnostic records.
- This preserves the missing capability, context, and recovery path for reproduction and debugging.

### Rules-driven UI integration
- Step 39's unsupported-interaction dialog now preserves the richer Step 41 fields rather than flattening the engine error.
- The dialog displays support/mode/recovery information.
- Sandbox approximations are explicitly described as excluded from official statistics.
- Standard/strict failures explicitly state that the interaction was not approximated.

## Verification performed

### Step 41 gates
- `npm run check:step41` — PASS
- `npm run test:step41` — 6/6 PASS
- Step 41 tests verify strict preflight, fail-before-mutation card rejection, exact resolution rollback, sandbox labeling/statistics exclusion, strict official batch rejection, and explicit benchmark partial-support override.

### Reliability regression suites
A combined Step 33–41 run completed with **94/94 tests passing**:
- Step 33 primitive tests — 15/15 PASS
- Step 34 cross-system tests — 13/13 PASS
- Step 35 golden-card tests — 30/30 PASS
- Step 36 judge-scenario tests — 10/10 PASS
- Step 37 fuzz/property tests — 5/5 PASS
- Step 38 performance/scalability tests — 5/5 PASS
- Step 39 rules-driven UI tests — 5/5 PASS
- Step 40 dashboard tests — 5/5 PASS
- Step 41 unsupported-interaction tests — 6/6 PASS

### Performance/architecture regression
- `npm run check:step38` — PASS
- `npm run test:step38` — 5/5 PASS
- `npm run benchmark:step38` — PASS
  - derived-characteristics benchmark: 7.686 ms / 8000 ms threshold
  - target-generation benchmark: 33.598 ms / 8000 ms threshold
  - repeated legal-action benchmark: 1.007 ms / 5000 ms threshold
  - 4-player headless 8-action benchmark: 2358.224 ms / 30000 ms threshold
- `npm run check:architecture` — PASS
- Step 39 UI deliverable check — PASS
- Step 40 dashboard artifact was regenerated from the latest benchmark and its data/deliverable checks pass.

### Repository-wide test/build environment limitations
- `npm test` was attempted but exceeded a 115-second sandbox execution limit; no repository-wide all-tests pass is claimed.
- `npm run build` reached the production Vite command, but the supplied checkpoint does not contain installed npm dependencies, so the sandbox returned `vite: not found`.
- The prebuild Scryfall refresh also had no network access and correctly retained the local 647-card trainer seed.

## Step 41 acceptance mapping

- **Strict mode never silently guesses unsupported card text:** explicit unsupported cards and unknown engine primitives stop with `UNSUPPORTED_INTERACTION`; strict deck preflight blocks non-certified support before game construction.
- **Benchmark simulations cannot include partial cards without explicit override:** benchmark-purpose engines require strict support unless `allowPartialSimulationOverride: true` is deliberately supplied and recorded.
- **Unsupported failures identify the exact missing capability:** diagnostics retain the card/ability/script node or event kind plus rules/game/action context and rollback result.
- **Failures occur before irreversible mutation where possible:** support checks run before costs/actions; unsupported errors during execution restore an exact action or resolution checkpoint.
- **Sandbox approximations cannot contaminate official statistics:** sandbox is explicitly labeled, immediately statistics-ineligible, serialized as such, and rejected by official simulation mode.

## Files added or substantially updated

### Added
- `src/engine/diagnostics/UnsupportedInteraction.js`
- `scripts/check-step41-unsupported-failsafes.mjs`
- `tests/step41-unsupported-interactions.test.js`
- `step41-unsupported-interaction-failsafes.md`
- `STEP41_COMPLETION_REPORT.md`
- `STEP41_RELEASE_MANIFEST.txt`

### Substantially updated
- `src/engine/diagnostics/index.js`
- `src/engine/GameEngine.js`
- `src/engine/EffectEngine.js`
- `src/engine/events/EventDispatcher.js`
- `src/engine/stack/ResolutionPipeline.js`
- `src/engine/replay/ReplayService.js`
- `src/engine/performance/HeadlessSimulationRunner.js`
- `src/engine/public/api.js`
- `src/ui/RulesUiModel.js`
- `src/components/UnsupportedInteractionDialog.jsx`
- `src/App.jsx`
- `scripts/run-step38-benchmarks.mjs`
- `performance-artifacts/step38-benchmarks.json`
- `src/data/generated/rules-coverage-dashboard.json`
- `package.json`
