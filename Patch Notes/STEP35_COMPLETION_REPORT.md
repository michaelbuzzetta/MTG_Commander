# Step 35 Completion Report — Golden Behavioral Tests for Cards

## Status

**COMPLETE**

Step 35 adds a versioned, executable golden-behavior contract for every card currently classified as `FULL` support. The support pipeline now refuses to retain `FULL` status when a card's golden contract is missing, stale against current Oracle text, stale against the support rules version, or has no executable behavior cases.

## Workflow objective satisfied

The implementation satisfies Step 35 of the MTG Commander Rules Engine workflow:

- Every fully supported card has at least one repeatable behavioral test.
- Complex/multi-behavior cards receive separate cases for materially distinct behavior.
- Golden fixtures are tied to Oracle identity/text fingerprints and rules/support versions.
- Reusable card-test helpers provide authoritative engine setup/execution/assertion primitives.
- `FULL` support is gated on current golden-test coverage.
- Oracle text changes become visible as fingerprint mismatches instead of silently updating expected behavior.

## Added

### Golden contract manifest

`tests/golden/step35-golden-cards.json`

- Schema/versioned manifest for all currently fully supported cards.
- Records card name, Oracle identity, Oracle-text fingerprint, support rules version, and one or more executable case IDs.
- Current coverage: **26 fully supported cards / 28 behavioral cases**.

### Reusable golden-card harness

`tests/golden/CardGoldenHarness.js`

Provides reusable fixtures/helpers for:

- constructing test games,
- placing cards in hand/battlefield for isolated fixtures,
- granting mana/priority,
- casting from hand through the authoritative `GameEngine`,
- resolving the stack,
- creating/querying permanents,
- setting counters,
- inspecting zones,
- inspecting/asserting event sequences,
- counting battlefield objects by card name.

Runtime actions still use the authoritative engine. Direct placement is restricted to fixture setup.

### Golden behavior suite

`tests/step35-golden-card-behavior.test.js`

Includes:

- manifest/support-set equivalence gate,
- Oracle identity and text-fingerprint gate,
- rules/support-version gate,
- executable-case registration gate,
- 28 behavioral cases covering all 26 `FULL` cards.

Representative behavior includes casting/resolution, draw, direct damage, destruction, mana production, counter replacement, token replacement, proliferate, continuous P/T effects, indestructible, flying/reach/menace, trample, vigilance, deathtouch and lifelink.

### Full-support gate integration

`scripts/build-card-support.mjs`

A card can now remain `FULL` only when it has:

1. explicit support certification,
2. executable implementation,
3. existing behavioral coverage,
4. no unresolved custom-hook requirement,
5. a current Step 35 golden contract,
6. at least one golden behavior case,
7. a matching Oracle-text fingerprint,
8. a matching support-rules version.

Stale or missing golden coverage downgrades the card to `PARTIAL` with a visible caveat instead of silently preserving `FULL` status.

Support records now expose golden-test metadata and coverage totals.

### Golden coverage checker

`scripts/check-step35-golden-cards.mjs`

Validates:

- exact correspondence between `FULL` support and the golden manifest,
- non-empty/unique case IDs,
- Oracle identities,
- Oracle-text fingerprints,
- support/rules versions,
- generated support metadata,
- sufficient separate cases for current multi-ability definitions.

Generates:

- `coverage/step35-golden-card-coverage.json`
- `coverage/step35-golden-card-coverage.md`

### CI gate

`.github/workflows/golden-card-behavior.yml`

Runs database/support validation, the Step 35 coverage gate, Step 35 behavioral tests, and Step 17 support regression tests.

### Documentation

- `docs/architecture/step35-golden-card-behavior.md`
- `STEP35_RELEASE_MANIFEST.txt`
- README checkpoint updated to Step 35.

## Current golden coverage

Fully supported cards covered: **26 / 26**

Golden behavioral cases: **28**

Cards with multiple dedicated cases include:

- **Doubling Season** — counter replacement and token replacement.
- **Vampire Nighthawk** — flying/blocking legality and deathtouch/lifelink damage behavior.

## Verification results

Completed successfully:

- `npm run check:step35` — **PASS, 26/26 FULL cards; 28 golden cases**
- `npm run test:step35` — **30/30 tests passed**
- `npm run check-support` — **PASS: 647 cards / 13 decks; 26 FULL / 621 PARTIAL / 0 UNSUPPORTED**
- `npm run test:step17` — **12/12 passed**
- `npm run test:step34` — **13/13 passed**
- `npm run test:step33` — **15/15 passed**
- `npm run check:architecture` — **PASS**
- `npm run check-db` — **PASS: 647 cards / 13 decks**
- `npm run check-oracle-templates` — **PASS: 4 exact high-confidence / 643 review-required**

A final rerun after implementation also confirmed:

- `npm run check:step35` — **PASS**
- `npm run test:step35` — **30/30 passed**

## Environment-limited checks

A full aggregate `npm test` invocation was attempted, but it exceeded the available execution window before producing a final aggregate result. A targeted core/Explorers/Step-32 aggregate likewise exceeded the execution window after the first 26 reported core tests had passed. These incomplete runs are **not** claimed as full passes.

The direct production build could not be conclusively validated in this sandbox because the extracted delivery package does not contain an installed dependency tree, and a dependency-install attempt exceeded the container execution/transport window. No build-pass claim is made from that incomplete attempt.

The Step 35 acceptance tests, support gates, relevant prior-step regressions, architecture checks, database checks, and Oracle-template checks all completed successfully.

## Acceptance criteria

- [x] Every currently fully supported Oracle card has at least one passing golden behavior contract.
- [x] Materially distinct behavior is separately represented where required by the current supported definitions.
- [x] Fixtures are bound to Oracle/rules/support metadata.
- [x] Oracle-text changes invalidate stale fingerprints and require review.
- [x] Reusable card behavior test harness exists.
- [x] `FULL` support cannot survive absent/stale golden coverage.
- [x] CI gate exists for golden behavior coverage.

## Next workflow step

**Step 36 — Judge Scenario Regression Library**
