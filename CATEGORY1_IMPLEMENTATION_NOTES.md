# Category 1 Implementation Notes

Implemented against the Category 1 plan: Core Engine Architecture and Data Pipeline.

## Completed findings

- BUG-059 — Consolidated the runtime around one card schema and one deck schema. Authoritative inputs live in `src/data/source`; generated runtime artifacts live in `src/data/generated`; both the app and tests import the generated artifacts.
- BUG-060 — Added `build-db`, `build-db:refresh`, and `check-db` package scripts.
- BUG-061 — Centralized Scryfall access through one request helper that always applies the project User-Agent and `Accept: application/json`; collection POSTs add `Content-Type: application/json`. Non-404 HTTP failures are treated as API/transport failures rather than missing cards.
- BUG-062 — Removed arbitrary commander fallback, missing-card skipping, and filler padding. The builder validates commander/card resolution and deck totals and fails with a clear error.
- BUG-063 — Removed stale `public/data` output and documentation. Added `src/data/README.md` and `src/data/database-schema.json` describing the actual runtime pipeline.
- BUG-064 — Removed obsolete migration-era engine/AI/card-registry modules that referenced incompatible APIs.
- BUG-065 — Removed dormant UI components built against the obsolete `Card` API/stack shape.
- BUG-069 — Replaced `latest` dependency declarations with the tested versions recorded by the lockfile and updated the launcher to use `npm ci`.
- BUG-070 — Updated Windows launcher metadata to MTG AI Trainer v3.

## Verification

- `npm run build-db` — PASS: built 44 cards and 6 decks.
- `npm run check-db` — PASS.
- `npm test` — PASS: 42/42 tests, including 7 new Category 1 architecture regression tests.
- Local-import resolution check — PASS.
- Production `npm run build` could not be rerun in this sandbox because the npm registry was temporarily unreachable (`EAI_AGAIN`) while installing Vite/React dependencies. The source-level test suite does not require those packages and completed successfully.

## Scope control

No Category 2+ rules fixes were intentionally implemented. The current Commander singleton/color-identity issues, combat/timing defects, mana defects, targeting, triggers, card accuracy, AI, and UI behavior assigned to later categories remain for their planned implementation cycles.
