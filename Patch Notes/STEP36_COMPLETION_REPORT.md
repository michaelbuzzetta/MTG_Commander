# Step 36 Completion Report — Judge Scenario Regression Library

## Status

**COMPLETE**

## Workflow requirements implemented

- Curated judge-scenario format with starting state, actions, expected choices, outcomes, rules references, and notes.
- Deterministic executable scenario harness.
- High-risk scenario coverage for layers/dependencies, replacement ordering, simultaneous deaths/triggers, four-player APNAP, player elimination, control changes, commander movement, and copy + type/ability changes.
- Permanent bug-to-regression policy.
- First migrated bug regression: pending library-search choice while a spell remains in resolution.
- Subsystem/complexity tags.
- Targeted scenario execution through Node test-name filtering.
- Full CI gate plus nightly execution.
- Normalized critical trace snapshots for selected difficult cases.
- Automatic deterministic diagnostic bundle on scenario failure.

## Verification

- `npm run check:step36` — PASS: 9 curated scenarios, 8 critical trace snapshots.
- `npm run test:step36` — PASS: 10/10 tests (schema/coverage gate + 9 executable scenarios).
- `npm run check:architecture` — PASS.
- `npm run check-db` — PASS: 647 cards / 13 decks.
- `npm run check-support` — PASS: 26 fully supported / 621 partial / 0 unsupported.
- `npm run check-oracle-templates` — PASS.
- Step 34 regression — PASS: 13/13.
- Step 35 regression — PASS: 30/30.
- Step 32 regression — PASS: 11/11.
- Step 33 regression — PASS: 15/15.

## Notes

Step 36 adds verification infrastructure and permanent cross-system regression coverage; it does not add card-specific rules shortcuts. The existing engine behavior passed all newly curated scenarios, so no production rules change was required during this step.
