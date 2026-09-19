# Step 33 — Unit Tests for Every Rules Primitive

Step 33 turns the reusable rules primitives into explicit behavioral contracts. The goal is not line-count vanity coverage; it is to prove that each reusable operation has a legal path, failure path, transactional behavior, and the important cross-system hooks that downstream cards depend on.

## Covered primitive contracts

The dedicated suite covers draw, damage, zone movement, destroy, exile, sacrifice, counters, token creation, library search, targeting, cost payment, copy, and control change. It also asserts the canonical event types used by these primitives so future refactors cannot silently bypass the event engine.

## Failure and interaction coverage

The suite verifies rejected operations leave authoritative state unchanged, prevention changes actual damage before lifelink observes it, counter replacement can alter placement, target legality is rechecked for partial resolution, copy uses copiable rather than temporary state, and stabilized damage reaches state-based actions after event commit.

A Step 33 regression also covers a spell that pauses resolution for a library-search choice. The resolving physical spell remains visible to runtime invariants while the choice is pending, and completing the choice resumes the pending resolution so the spell reaches its destination zone instead of being orphaned.

## Reusable fixtures

`tests/fixtures/primitive-fixtures.js` provides deterministic setup helpers, runtime card definitions, battlefield construction, state hashing, atomicity assertions, mana setup, and locked-cost construction. Legacy regression fixtures that intentionally empty a hand now relocate those cards to another legal zone rather than deleting physical cards from authoritative state.

## Coverage gate

`scripts/check-rule-primitive-coverage.mjs` checks the required behavioral contract set and writes machine-readable and Markdown reports under `coverage/`.

`npm run test:step33:coverage` uses Node's test coverage over the core primitive service modules. The gate currently requires aggregate coverage of at least 55% lines, 40% branches, and 50% functions for the targeted primitive modules. Behavioral contracts remain the primary gate.

GitHub Actions workflow `.github/workflows/rules-primitives.yml` runs architecture checks, the Step 32 invariant suite, Step 33 contract validation, Step 33 tests, and the Step 33 coverage threshold on pushes and pull requests.
