# Phase 72 — Batch 2 structural composition

This continuation targets false unresolved classifications caused by Oracle structural clauses whose game behavior is already owned by an authoritative subsystem.

Implemented:
- Saga reminder text now compiles as a Saga structural rule marker; actual lore-counter progression and chapter queuing remain in CounterService/GameEngine.
- Standalone modal `Choose ... —` headers now compile as composition metadata; actual choices/modes continue through the modal compiler and stack choice locking.
- `Choose a Background` now compiles into the commander pairing flag consumed by CommanderRules.

Validation actually run:
- `node --check src/cards/compiler/OracleTemplateLibrary.js` — PASS.
- Phase 51–55, Phase 61–65, and Phase 68 regression tests — 18/18 PASS.

Not claimed:
- Batch 2 is not declared complete.
- No unsupported mechanic was converted to a no-op to inflate coverage.
- The full catalog audit still exceeds the available execution window, so no new authoritative full-catalog count is claimed here.
