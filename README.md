# MTG AI Trainer v3

A React/Vite Commander practice simulator built around a standalone game engine. The current repair program is being implemented category-by-category from the full code audit so that each engine layer can be stabilized before the next one changes.

## Current architecture

The application, tests, and database builder now share one data model:

- `src/data/source/cards.json` — authoritative card records.
- `src/data/source/decks.json` — authoritative deck records.
- `src/data/generated/cards.json` — runtime card artifact imported by the app/tests.
- `src/data/generated/decks.json` — runtime deck artifact imported by the app/tests.
- `src/data/database-schema.json` — schema and build validation contract.

`npm run build-db` validates the source data and atomically regenerates the exact files consumed by the running program. It fails instead of substituting filler cards or arbitrary commanders when a required card id cannot be resolved. Category 10 also makes this a Commander-legality build gate: nonbasic singleton violations, off-color cards, commander identity mismatches, and unsupported cards in playable decks all fail validation.

`npm run build-db:refresh` additionally refreshes descriptive Scryfall metadata. Every Node-side Scryfall request uses the same identifying User-Agent and Accept headers. Transport/API failures are treated separately from a genuine 404 card-not-found result. Local machine-readable rules fields remain authoritative.

## Run

Use Node.js with the checked-in lockfile:

```bash
npm ci
npm run check-db
npm test
npm run dev
```

On Windows, `start.bat` performs the locked install when needed, validates the data, and starts MTG AI Trainer v3.

## Database commands

```bash
npm run build-db          # deterministic local build
npm run check-db          # validate without writing
npm run build-db:refresh  # build + Scryfall descriptive metadata refresh
```

## Verification

```bash
npm run verify
```

`verify` validates the database, runs the engine/test suite, and produces the Vite production build.

## Scope

This is a training simulator implementing the mechanics represented by its structured card database, not a complete implementation of every rule/card ever printed in Magic. The published Explorers of the Deep 100-card list is preserved as a non-playable reference record; cards whose mechanics are not yet modeled are explicitly marked unsupported rather than silently simplified. A separate fully supported Hakbal training deck remains selectable for gameplay. All selectable decks pass Commander singleton, color-identity, resolvability, and support validation.
