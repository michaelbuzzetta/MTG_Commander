# Phase 73 — Batch 2 continuation

Implemented two previously unresolved Oracle families only where authoritative runtime behavior already exists:
- Doctor's companion now compiles to CommanderRules pairing metadata and is validated by the paired-commander rules path.
- Aftermath now compiles to a graveyard-only, sorcery-timing casting option with exile-on-leave-stack behavior, using the existing casting-option/stack-resolution path.

Validation actually run:
- `node --check src/cards/compiler/OracleTemplateLibrary.js` — PASS.
- `tests/phase73-batch2-next-step.test.js`, `tests/step14-commander-multiplayer.test.js`, and `tests/step21-permissions-restrictions.test.js` — 28/28 PASS.

Batch 2 remains open. No full-catalog promotion count is claimed by this incremental step, and no unsupported behavior was converted into a no-op.
