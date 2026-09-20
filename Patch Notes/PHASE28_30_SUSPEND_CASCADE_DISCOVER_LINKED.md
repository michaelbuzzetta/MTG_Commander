# Phases 28–30 — Suspend, Cascade/Discover, and linked abilities

Oracle compiler version: 4.2.0.

## Phase 28 — Suspend
- Adds an exact `Suspend N—{cost}` Oracle template.
- Compiles suspend into declarative card metadata (`suspend.timeCounters`, `suspend.cost`).
- Legal actions now expose `SUSPEND_CARD` from hand when the player has priority, could cast the card at that time, and can pay the suspend cost.
- Resolution moves the card to exile, marks it suspended, and adds time counters through the authoritative counter engine.
- Existing upkeep processing removes time counters and uses the existing mandatory zero-counter suspend cast path.

## Phase 29 — Cascade and Discover
- Adds reusable `cascade` and `discover` effect primitives.
- `Cascade` compiles as a self cast trigger and delegates library iteration to `LibraryOperationService.cascade`.
- `Discover N.` compiles to the `discover` primitive and delegates to `LibraryOperationService.discover`.
- Both paths use authoritative reveal/exile iteration, mana-value filtering, exile casting permissions, and randomized bottom placement already owned by the library service.
- Complex choice variants and replacement interactions not represented by these exact templates remain fail-closed.

## Phase 30 — Linked abilities / advanced-mechanics foundation
- Retains linked temporary exile as a generalized source-linked primitive (`exileUntilSourceLeaves`) rather than card-specific code.
- Exiled object identity is tracked by instance ID on the source, and the normal zone-change path restores linked objects when the source leaves.
- This is the foundation for later expansion of imprint-style and other multi-ability linked references. Unsupported linked relationships are not guessed.

## Validation
- Oracle artifacts regenerated and accepted for parser 4.2.0.
- Artifact check passes for 647 curated cards.
- Focused compiler/scripting suite: 57/57 passing.
- Syntax checks pass for modified GameEngine and EffectEngine.
