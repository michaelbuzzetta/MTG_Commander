# Step 17 — Card Library Migration and Support Classification

Step 17 makes card coverage an auditable data product rather than an estimate. The runtime still uses the Step 16 declarative scripting layer and existing engine primitives; Step 17 adds identity resolution, support classification, deck-readiness reporting, and CI-style consistency checks around that behavior.

## Oracle/rules identity

`src/cards/support/OracleImplementationRegistry.js` resolves each printing to a rules implementation. Real Scryfall `oracleId` values are preferred. When the checked-in local catalog does not contain an Oracle id, the registry records an explicit normalized-name fallback rather than inventing an Oracle id. If two records share an Oracle id but carry different Oracle text, their rules implementation ids are version-split by text fingerprint so materially different rules text is never silently merged.

Rules data and printing data are kept separate. Set code, collector number, image/art references, Scryfall printing id, and similar presentation metadata remain attached to the printing, while abilities/script/rules fields are shared through the canonical implementation.

## Support status model

`CardSupportService` consumes generated support records with three support states:

- `fully_supported`
- `partially_supported`
- `unsupported`

A card is **not** promoted to fully supported merely because it loads or has machine-readable rules. The current certification gate requires an explicit certification entry, an executable implementation, at least one card-specific behavioral test, and no untracked caveat or custom-hook requirement. Unknown runtime cards fail closed to partial support.

Implementation-path classification is also machine-readable:

- auto-template candidate
- declarative scripted
- complex scripted
- custom hook required
- non-digital/unsupported

These paths are migration/planning metadata; they are not power ratings or gameplay heuristics.

## Generated artifacts

`scripts/build-card-support.mjs` generates and `--check` validates:

- `src/data/generated/card-support.json`
- `src/data/generated/oracle-registry.json`
- `src/data/generated/deck-readiness.json`
- `src/data/generated/coverage-report.json`
- `src/data/generated/legacy-handler-removal.json`

The generator reads the authoritative card/deck sources, Step 17 certification data, available cached Scryfall Oracle ids, and repository behavioral tests. Coverage percentages are calculated from the generated status records rather than hand-entered estimates.

At this checkpoint the current project suite contains 647 unique local card definitions across 13 decks. All 647 have a support record and implementation mapping. The conservative certification gate marks 26 fully supported and 621 partially supported; no card is silently treated as supported. The cached Scryfall snapshot supplies real Oracle ids for 178 cards, while 469 explicitly record the local identity fallback pending future catalog enrichment.

## Current-deck migration and strict-readiness behavior

All 13 current decks are included in `deck-readiness.json`. Every referenced card resolves to a support record, and any partial/unsupported card is returned as an explicit blocker. No current deck is incorrectly certified strict-ready while it still contains partial implementations.

This is intentionally different from claiming that Step 17 makes all 647 cards complete. Step 17 makes the incompleteness measurable and safe; Steps 18 onward expand implementation coverage.

## Legacy handler review

`legacy-handler-removal.json` is a review queue, not an automatic deletion list. It identifies production rules paths that still appear card-specific or EffectEngine branches used by only one current card definition. A handler is removed only after an equivalent declarative implementation has behavior tests and is proven equivalent. This preserves the workflow rule against deleting compatibility behavior prematurely.

## Runtime API

`GameEngine` exposes support information without giving UI/AI mutation access:

- `getCardSupportStatus(cardId)`
- `getOracleImplementation(cardId)`
- `getDeckSupportReadiness(deckOrId)`
- `getCardSupportCoverage()`

Support preparation occurs before Step 16 card-script compilation so every compiled runtime card retains its Oracle/rules implementation identity and support metadata.

## Verification commands

- `npm run build-support`
- `npm run check-support`
- `npm run test:step17`
- `npm run check-db`
- `npm run check:architecture`
- `npm run audit:mutations`

The Step 17 checkpoint passes all dedicated tests, support-data consistency checks, database validation, architecture isolation, and the complete non-stress repository suite. Production `vite build` still requires installed project dependencies; the checkpoint ZIP intentionally does not contain `node_modules`.
