# MTG Commander Practical-100 Checkpoint — 2026-09-17

## What changed in this checkpoint

This checkpoint advances the Step 45 architecture without pretending that the application is practical-100 before the production catalog and certification backlog are complete.

1. **Removed the known fallback-catalog MDFC engine blocker.** Esika, God of the Tree is now a real `modal_dfc` definition with both cast faces. The existing face-state/cast-action architecture is used instead of a card-specific alternate-face exception. The chosen face is preserved on the stack and through permanent resolution.
2. **Added a reusable reveal-until operation.** `LibraryOperationService` now supports reveal-until-a-filter-matches, moving the matching card to the battlefield, and placing the other revealed cards on the bottom in deterministic random order. The Prismatic Bridge uses this generic operation.
3. **Added MDFC/reveal-until regression coverage.** New release tests cover hand casting of either face, command-zone face selection, Bridge upkeep resolution, face persistence, hidden-information cleanup, and random-bottom behavior. Step 35 now has separate golden scenarios for Esika's front-face mana/static behavior and the Bridge back face.
4. **Fixed legacy Category 9 test fixtures.** Library fixture replacement now moves pre-existing physical cards to an authoritative zone instead of orphaning them. All 17 Category 9 tests pass with runtime invariants enabled.
5. **Hardened production catalog ingestion.** `sync-scryfall-catalog.mjs` now records SHA-256 provenance, validates complete inputs before replacement, stages catalog writes with rollback copies, and supports offline import of official Scryfall Oracle/default-card bulk files.
6. **Hardened Step 43 update-state integrity.** Catalog/printing hashes are persisted in the update state. The update plan is tied to exact candidate bytes, reviewed changes can be archived, and `check:step43` no longer self-invalidates immediately after the updater advances its snapshots.
7. **Made release certification more exhaustive.** `npm run certify` now enumerates database, support, compiler, census, capability-gap, mechanic, architecture, Steps 33–45, release-evidence, full-test, and production-build gates instead of acting as a narrower smoke test.
8. **Added release-evidence gating.** Certification now requires fresh long-fuzz evidence, fresh passing performance evidence, and clean-install Windows/macOS artifacts matching the current rules/catalog/compiler identity.
9. **Improved release identity.** The Step 45 practical-100 report now records the rules version, package version, Oracle/printing catalog SHA-256 values, catalog source timestamp, and compiler SHA-256.

## Current measured state

- Comprehensive Rules tag: `mtg-cr-2026-08-07`
- Catalog: fallback/trainer catalog, **647 cards**, explicitly incomplete
- Fully strict-supported: **31**
- Unresolved in-scope: **616**
- Strict coverage of fallback catalog: **4.79%**
- Remaining fallback classifications: **432 missing test/certification**, **184 missing script/template/compiler work**
- Known engine-capability blockers in the fallback census: **0** after the MDFC/Bridge work
- Observed fallback mechanic audit: **16 observed keywords, 0 missing**
- Step 35 golden gate: **31/31 fully supported cards covered by 34 behavior cases**
- Step 43 update queue: **0 pending changes** after archiving/acknowledging the reviewed MDFC update

These figures describe only the incomplete 647-card fallback catalog. They are not an estimate of total Magic card coverage.

## Validation performed here

Passing checks/tests include support metadata, Oracle-template artifacts, Oracle support census, capability-gap report, mechanic registry audit, architecture boundaries, Steps 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43 and 44 structural checks, the Step 45 deliverable check, all 17 Category 9 tests, three new release MDFC/reveal-until tests, both Esika golden cases, Step 43 unit tests, and Step 45 edge-case tests.

The monolithic `npm test` invocation did not complete in this sandbox because Node's all-file parallel test run made no progress before the execution ceiling. Individual affected suites do execute normally. The Vite production build was also not runnable in this extracted checkpoint because `node_modules` is intentionally absent and this sandbox cannot reach the package registry. Do not interpret either limitation as a passing result.

## Current honest blockers

The project is still **BLOCKED**, by design. The production Scryfall Oracle/default-card catalogs have not been loaded in this environment, so practical-100 remains fail-closed. Once the full catalog is available, the census must be rebuilt and the expanded engine/compiler/certification backlog handled by behavior family.

Release evidence is also intentionally red: the current recorded long-fuzz artifact contains only 160 executed legal actions versus the new 1,000,000-action release minimum, and clean Windows/macOS certification artifacts are absent. These are now explicit gates instead of undocumented expectations.

## How to load official bulk files without relying on runtime network access

After obtaining Scryfall's official `oracle_cards` and `default_cards` bulk files, run:

```bash
node scripts/sync-scryfall-catalog.mjs \
  --oracle-file=/path/to/oracle-cards.json \
  --printing-file=/path/to/default-cards.json \
  --source-updated-at=YYYY-MM-DDTHH:mm:ssZ

npm run build-db
npm run build-support
npm run build-oracle-templates
npm run build:census
npm run build:gaps
npm run build:mechanics-audit
npm run update:step43:offline
npm run build:step40
npm run build:step44
npm run build:step45
```

Both bulk inputs must contain at least 10,000 records or the updater rejects them and retains the last-known-good catalog.

## Next implementation campaign

The next highest-value work is to load the complete Oracle catalog, rerun the census, then group newly exposed unsupported cards by reusable engine capability or reusable compiler/effect pattern. Do not implement cards alphabetically. Once reusable gaps are closed, batch-certify behavior-backed cards through real engine actions, classify genuinely non-digital cards explicitly, and keep running the final certification system until every gate is green against one frozen rules/catalog/compiler/source identity.

## Production-catalog phase started after this checkpoint

The next practical-100 campaign has now begun. The following additional hardening is included in the updated working tree:

1. **The practical-100 census now enumerates the production Oracle universe.** When the catalog is marked complete, the census and Step 45 gate enumerate every declared Oracle identity rather than only the curated `src/data/source/cards.json` implementations. A complete catalog with missing implementations therefore fails closed instead of producing a false high coverage percentage.
2. **Catalog/census cardinality is release-critical.** The Step 45 report records whether the production universe was actually loaded and whether the census row count matches the Step 43 declared Oracle count. Mismatches are blocking errors.
3. **Pending semantic/legality review is release-blocking.** New Oracle text or legality changes discovered by Step 43 cannot be acknowledged away into a practical-100 pass; the review queue must be clear for the exact catalog bytes being certified.
4. **Production bulk validation is stronger.** Official Oracle/default-card inputs must be large enough, structurally valid, and unique by Oracle/printing identity. Duplicate-heavy or swapped/corrupt bulk inputs are rejected even if they exceed a superficial record-count threshold.
5. **A one-command production ingestion campaign exists.** `npm run ingest:production-catalog` performs online ingestion when network access is available. `npm run ingest:production-catalog:offline -- --oracle-file=/path/to/oracle.json[.jsonl/.gz] --printing-file=/path/to/default.json[.jsonl/.gz] --source-updated-at=...` imports official bulk files offline, classifies Step 43 changes, rebuilds support/Oracle mappings, compiler inventory, full census, gap report, mechanic audit, Step 40 dashboard, and Step 45 report.
6. **Oracle compiler inventory scales to the full catalog.** Complete production catalog identities are analyzed even when no hand-authored runtime implementation exists. High-confidence compiler output remains a promotion candidate, not automatic runtime certification.
7. **Step 40 scales to the full census.** When the production catalog is authoritative, its dashboard shows every Oracle identity, including unimplemented/unreviewed cards, instead of silently displaying only the 647 trainer cards.
8. **Authoritative Oracle text drift invalidates certification.** If the production Oracle text for an implemented card differs from the text fingerprint used by its implementation/certification, the support builder demotes the card until the changed behavior is reviewed and retested.
9. **Catalog snapshots are compact.** Step 43 stores only the identity/change-detection fields needed for future diffs instead of duplicating full artwork and printing payloads into update snapshots.
10. **Silent heuristic gameplay promotion is closed.** Full-catalog cards and newly fetched Scryfall metadata remain `supported:false` by default until a certified runtime implementation exists. The legacy generic Oracle-text heuristic parser is executable only through an explicit `allowApproximation: true` sandbox opt-in; such definitions are labeled `sandboxApproximation`, `approximateRules`, and `certificationEligible:false` and therefore can never satisfy practical-100.

### Scale/integration validation

A disposable isolated fixture containing 10,000 unique Oracle identities and 10,000 unique printing identities was run through the complete production ingestion pipeline. The pipeline successfully generated a 10,000-row compiler inventory, census and Step 40 dashboard, while Step 45 correctly remained blocked at 0/10,000 certified cards because none of the synthetic Oracle identities had certified runtime implementations. This validates the fail-closed integration and basic scale path without contaminating the real checkpoint with synthetic card data.

A separate isolated Oracle-drift fixture confirmed that changing authoritative Oracle text for an otherwise certified card immediately demotes its support record and adds an explicit stale-certification caveat.

### Additional validation after production-catalog hardening

Passing checks/tests now also include:

- `npm run check-db`
- `npm run check:architecture`
- `npm run check-support`
- `npm run check-oracle-templates`
- `npm run check:census`
- `npm run check:gaps`
- `npm run check:mechanics-audit`
- `npm run check:step43`
- `npm run test:step43` — 10/10 passing, including malformed/duplicate production-bulk tests
- `npm run test:step17` — 12/12 passing
- `npm run test:step18` — 15/15 passing
- `npm run build:step40`, `check:step40:data`, `check:step40`, `test:step40` — 5/5 Step 40 tests passing
- `npm run check:step44`, `npm run test:step44` — 6/6 passing
- `npm run build:step45`, `check:step45`, `test:step45` — 9/9 Step 45 tests passing
- `node --test tests/card-catalog.test.js` — 6/6 passing
- `node --test tests/deck-import.test.js` — 6/6 passing, including strict rejection of downloaded-but-uncertified cards
- `node --test tests/fetchlands.test.js` — 3/3 passing

### Immediate external input still required

This execution environment cannot currently reach Scryfall's bulk-data endpoint, so the real production Oracle/default-card payload has **not** been downloaded here. The code is ready for either the online command above in an environment with outbound access or offline ingestion of the official bulk files. Until those real bytes are loaded, the repository intentionally remains on the 647-card incomplete fallback and practical-100 stays blocked.
