# Phases 43–45 — Final Audit, Regression Hardening, Release Candidate

## Phase 43: final full-catalog audit
The complete bundled Oracle catalog was reprocessed through the current compiler. The release audit is `coverage/phase43-final-full-catalog-audit.json`. It contains a per-card classification and preserves unmatched Oracle text for cards that are not fully compiled. The release policy does not silently treat partial/manual cards as supported.

Final catalog result: 38,681 cards; 2,139 fully compiled; 11,271 partially compiled; 25,271 manual review; 0 compiler exceptions. At least one high-confidence construct is understood on 34.67% of catalog entries; 5.53% are fully auto-accepted by the current compiler.

These percentages are compiler coverage, not a claim that only that percentage of gameplay rules work. Shared engine primitives cover many interactions independently of per-card Oracle auto-compilation. Conversely, partial/manual cards are not certified as fully digitally represented.

## Phase 44: regression and hardening
A final targeted release suite was added in `tests/phase43-45-final-release.test.js`. The new suite plus the immediately preceding Phase 34 and Phase 37–42 suites passed 18/18 tests. A broader rules-engine regression campaign covering stack/priority, targeting, costs, triggers, replacements/prevention, continuous layers, state-based actions, combat, Commander/multiplayer, copying, attachments, damage, library operations, invariants, rules primitives, and cross-system interactions passed 199/199 tests.

The repository-wide `npm test` campaign was attempted but exceeded the execution window, so it is not represented as a completed all-tests pass.

## Phase 45: release candidate
`release-artifacts/phase45-release-manifest.json` records the final catalog counts, explicit unsupported-card policy, and hashes the final audit artifact. The release candidate keeps unsupported/partial Oracle text explicit instead of approximating it.

A fresh Vite production build was attempted. The checkpoint does not contain `node_modules`, and `vite` was therefore unavailable in the execution environment. Existing `dist/` artifacts remain in the repository, but this phase does not claim a newly regenerated production build. On a development machine, run `npm ci` under the Node/npm versions declared in `package.json`, then `npm run build:offline` and the desired verification commands before deployment.

## Reproducible commands
- `npm run build:phase43-audit`
- `npm run build:phase45-release`
- `npm run test:phase43-45`
- `npm run build:offline` (after `npm ci`)
