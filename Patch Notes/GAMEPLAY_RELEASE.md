# Gameplay-Focused Release

This release uses a practical gameplay endpoint rather than claiming that every printed Magic card has been individually hand-implemented. The authoritative engine is expected to correctly execute reusable rules primitives and the combinations built from them; unusual behavior that is not represented by those primitives must fail closed with an explicit `UNSUPPORTED_INTERACTION` diagnostic instead of being silently approximated.

## Acceptance scope

The release audit covers the stack and multiplayer priority ring; triggered and activated abilities; cost construction/payment; target declaration and resolution legality; hexproof, shroud, protection and ward; replacement/prevention ordering; continuous effects and layers; combat and combat keywords; graveyard/exile/library operations; copy/copiable values; arbitrary counters; tokens; control changes; and attachments. Cross-system judge scenarios and golden real-card behavior tests exercise combinations of those systems.

Compiler 1.3 keeps exact full-text templates as its first path and now also supports conservative paragraph composition. A card containing multiple independent Oracle-text paragraphs can compile through the generic card-script path only when every paragraph has exactly one high-confidence template match. Composition remains fail-closed when any paragraph is unknown or ambiguous, and multiple independently targeted spell paragraphs are deliberately left review-required until the script IR has per-effect target binding.

## Unsupported-card policy

`fully_supported` means the card is strict/golden-certified. `partially_supported` means it has executable behavior but has not satisfied every strict certification gate; it does not mean the engine should invent missing text. If an unsupported runtime operation is actually encountered, standard and strict gameplay stop the operation, emit a reproducible diagnostic, and restore the protected action/resolution checkpoint. Sandbox mode is the only mode allowed to use an explicit approximation, and sandbox games are marked ineligible for official statistics.

## Real-deck audit

Run `npm run audit:gameplay-release` to exercise Explorers of the Deep, Temporal Paradox, and Never Ending Story repeatedly through the same authoritative legal-action API used by the game. The generated report is `release-artifacts/gameplay-release-audit.json`. The audit is intended to discover crashes, rejected legal actions, invariant failures, and unsupported interactions; it is not a deck-power or win-rate simulation.

## Verification

Run `npm run verify:gameplay-release` for the gameplay release gate. It validates the runtime database/support artifacts, runs the compiler/card-script and core rules interaction suites sequentially, performs the real-deck audit, and creates an offline Vite production build. Production-wide Oracle compiler snapshots remain retained as evidence, but regenerating the entire production Oracle universe still requires the raw production catalog cache; that full-catalog recertification is outside this gameplay-focused endpoint.

The machine-readable verification summary is `release-artifacts/gameplay-release-verification.json`.
