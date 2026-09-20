# Phases 86–90 Continuous Checkpoint

Intermediate resumable checkpoint; release gate remains FAIL.

## Phase 86 — modal composition/audit hardening
- Generalized compiler paragraph composition so ordinary multiline `Choose one/two/three/one or both/one or more —` blocks are preserved as one semantic unit.
- Updated the authoritative Phase 66 audit to use the same structured modal grouping rather than counting bullet lines as independent abilities.

## Phase 87 — Aura reminder + land entry choices
- Aura `Enchant ...` clauses now accept canonical reminder text while preserving executable attachment target restrictions.
- Generalized pay-life-or-enter-tapped land semantics from a fixed 2 life to arbitrary numeric life payments backed by the existing authoritative entry-choice runtime.

## Phase 88 — Phasing
- Added compiler support for Phasing with canonical reminder text.
- Implemented untap-step phase in/out handling.
- Added indirect phasing for attached objects, including attachments controlled by another player and nested attachments.

## Phase 89 — Living metal
- Added compiler support for Living metal.
- Added layer-4 runtime type derivation so a Living metal Vehicle is also a creature only during its controller's turn.

## Phase 90 — own-turn first strike
- Added compiler support for `During your turn, this creature has first strike.`
- Added layer-6 turn-scoped keyword derivation instead of mutating base characteristics.

## Verification
- New Phase 86–90 focused tests: 5/5 passed.
- Phase 80–90 focused regression set: 25/25 passed.
- Full Phase 66 catalog audit rerun after implementation.
- Catalog entries: 38,681.
- Fully executable: 4,409.
- Partially recognized: 12,901.
- Manual/unresolved: 21,112.
- Compiler failures: 0.
- Explicit physical/non-digital exceptions: 259.
- Release gate: FAIL.

## Next autonomous action
Reload this checkpoint, inspect the new highest-frequency unresolved semantic families, implement the highest-impact runtime-backed family, test it, and rerun the complete catalog audit. Do not treat this checkpoint as completion.
