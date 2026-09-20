# Phase 81 Continuous Checkpoint
Intermediate resumable checkpoint; release gate remains FAIL.

## Phase 81
- Added runtime-backed triggered modal choices for ETB `choose one` abilities.
- Trigger modes are chosen before target selection and lock their mode effect/target contract on the pending trigger.
- Extended Ability IR, AST lowering, validation, LegalActions, GameEngine choice validation/application, and TriggerEngine.
- Added structured multi-line Oracle composition for ETB modal bullet blocks.
- Added common executable modal clauses (self counters/haste, destroy/exile, draw, scry, surveil, loot, drain, basic 1/1 tokens, Treasure).
- Updated Phase 66 audit so structured modal abilities are verified as whole-card semantics instead of falsely failing line-by-line.

## Verification
- Phase 80 + 81 focused regression: 9/9 passed.
- Full catalog audit rerun after Phase 81.
- Current audit: see coverage/phase66-universal-coverage-audit.json.

## Next action
Continue from the full audit with the next highest-impact unresolved runtime semantic cluster. Do not treat this checkpoint as completion.
