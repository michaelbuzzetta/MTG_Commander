# Step 33 Completion Report — Unit Tests for Every Rules Primitive

## Objective
Prove the reusable engine primitives before additional card coverage depends on them, with explicit positive/negative paths, transaction guarantees, cross-system behavior, reusable fixtures, measurable coverage, and a CI gate.

## Completed work

- Added a dedicated primitive behavior suite for draw, damage, move-zone, destroy, exile, sacrifice, counters, token creation, search, targeting, cost payment, copy, and control change.
- Added canonical event-contract assertions for the core event-backed primitives.
- Added positive and negative paths, including atomic state-hash checks after rejected operations.
- Added prevention, replacement, partial target-resolution, copy-state, and SBA-boundary interaction cases.
- Added reusable primitive fixture builders in `tests/fixtures/primitive-fixtures.js`.
- Added a behavioral coverage checker and generated JSON/Markdown reports under `coverage/`.
- Added Node test-coverage thresholds for the targeted primitive engine modules.
- Added a GitHub Actions rules-primitive gate for architecture, Step 32 invariants, Step 33 behavior contracts, tests, and coverage.
- Updated legacy cast-test setup so clearing a hand relocates physical cards instead of deleting them from authoritative state.
- Fixed a regression exposed by the new tests: resolving spells waiting on an engine choice are now included in invariant inventory, and a Cultivate-style search choice resumes pending spell resolution before priority returns.

## Acceptance criteria

- Every workflow-listed rules primitive has dedicated behavioral coverage: PASS.
- Failed primitive operations are checked for no partial authoritative mutation: PASS.
- Critical replacement, prevention, target-legality, zone-transition, and SBA/event-boundary branches are exercised: PASS.
- Reusable fixture builders are present: PASS.
- Behavioral and coverage gates are executable locally and in CI: PASS.

## Verification snapshot

- `npm run test:step33`: PASS, 15/15 tests.
- `npm run check:step33`: PASS, 13/13 required primitive contracts.
- `npm run test:step33:coverage`: PASS — 63.21% lines, 43.56% branches, 62.37% functions across the targeted primitive modules (thresholds: 55/40/50).
- `npm run test:step32`: PASS.
- `node --test tests/core.test.js`: PASS, 26/26.
- Explorers short deterministic regression: 220 consecutive legal AI actions completed with invariants enabled after the pending-resolution fix.
- Architecture check: PASS. Card database: 647 cards / 13 decks PASS. Support database regenerated and validated: 26 full / 621 partial / 0 unsupported. Oracle compiler: 4 exact high-confidence / 643 review-required PASS.
- A direct Vite production-build check was attempted but exceeded the sandbox execution window, so it is not reported as a passing verification item.

See `coverage/step33-primitive-coverage.md` and `coverage/step33-node-coverage.txt` for generated gate output.
