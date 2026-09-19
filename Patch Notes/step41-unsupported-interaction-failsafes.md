# Step 41 - Unsupported-Interaction Fail-Safes

Step 41 prevents unsupported card/rules behavior from being silently approximated in authoritative gameplay or official simulation output.

## UnsupportedInteraction diagnostics

`src/engine/diagnostics/UnsupportedInteraction.js` defines the structured `UNSUPPORTED_INTERACTION` error and the engine-owned `UnsupportedInteractionService`. Diagnostics include the card/object, ability or script node, contextual category, rules version, game/turn/phase, current event/stack/action identifiers where available, current support classification, suggested support status, rollback outcome, state hash, replay metadata, and recent event context.

Diagnostics are retained outside authoritative `GameState`, so a resolution/action rollback does not erase the developer reproduction record.

## Fail-before-mutation behavior

Every submitted action passes through the support fail-safe before costs or authoritative mutation. Explicitly unsupported cards therefore stop at validation. Strict mode additionally requires `strictEligible` card support metadata and runs deck-support preflight before game state is created.

Unknown effect nodes and missing authoritative event handlers no longer disappear silently. They become structured unsupported interactions. Stack resolution already has a transactional checkpoint; Step 41 now annotates that rollback explicitly. The outer action dispatcher also holds a pre-action checkpoint and restores it for unsupported execution failures outside the stack-resolution transaction.

## Standard, strict, and sandbox behavior

- `standard`: explicitly unsupported/missing engine behavior halts instead of guessing; partially supported cards may still use their implemented behavior for backwards-compatible ordinary play.
- `strict`: deck preflight requires every card to be strict-eligible, and runtime support checks continue to guard cards added dynamically.
- `sandbox`: unsupported behavior may continue only through an explicitly recorded approximation. The current generic fallback is a labeled no-op for unknown effect/event nodes. Any sandbox run is marked `statisticsEligible: false` and must not be used as official simulation output.

Replay metadata records the unsupported-interaction mode, game ID, simulation purpose, diagnostic count, and statistics eligibility.

## Strict batch simulation preflight

`HeadlessSimulationRunner` now supports `officialSimulation: true`. Official mode forces strict support and rejects sandbox mode. A strict batch cannot be constructed when any selected deck contains partial, unsupported, missing, or otherwise non-certified cards. `preflight()` returns named blockers before running a batch.

## Commands

```bash
npm run check:step41
npm run test:step41
```

## Benchmark override policy

Simulation purposes containing `official` or `benchmark` are fail-closed against partial/non-certified deck support. A benchmark that intentionally measures the current partially certified corpus must pass `allowPartialSimulationOverride: true`; that decision is serialized into replay metadata. This preserves existing performance workloads while making the exception explicit and auditable.
