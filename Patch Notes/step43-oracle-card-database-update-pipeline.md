# Step 43 — Oracle/Card Database Update Pipeline

Step 43 keeps the catalog current while preserving the last known-good database and avoiding unnecessary rules reimplementation.

## Update flow

1. `sync-scryfall-catalog.mjs` checks Scryfall's Oracle bulk snapshot metadata before downloading. If `updated_at` matches the cached complete snapshot, no bulk redownload occurs.
2. `update-card-database-step43.mjs` compares the candidate catalog to the committed Step 43 snapshot by stable Oracle identity.
3. Changes are classified as:
   - new printing only
   - new Oracle card
   - Oracle text change
   - legality change
   - ruling metadata change
   - new keyword/mechanic indicator
4. New printings reuse the existing Oracle implementation. Only new or semantically changed Oracle identities enter the implementation-review queue.
5. The pipeline writes an affected-test plan from existing support metadata. The affected-test runner executes only relevant card tests plus compiler/golden validation when those layers are implicated.
6. Generated artifacts are written atomically using temporary files + rename. A failed network refresh leaves the prior catalog intact, and a failed Step 43 validation never replaces the last known-good snapshot.

## Commands

- `npm run update:step43` — check Scryfall, then classify and commit the validated catalog snapshot.
- `npm run update:step43:offline` — classify the currently cached catalog without network access.
- `npm run check:step43` — verify required artifacts and confirm they are current.
- `npm run test:step43` — unit/property tests for change classification and targeted test planning.
- `npm run test:step43:affected` — run only tests associated with changed Oracle identities.

## Generated artifacts

`src/data/updates/` contains the catalog snapshot, update state, classified update plan, Oracle diff/review queue, and affected-test plan. These are intentionally separate from the curated runtime card implementations in `src/data/source/cards.json`: catalog discovery must never silently grant rules support.

## Failure behavior

If Scryfall is unavailable, the app continues with the most recent complete cached catalog; if no complete catalog has ever been downloaded, it uses the local trainer seed and clearly records `offline-fallback`. No failed update deletes or partially overwrites the prior usable data.
