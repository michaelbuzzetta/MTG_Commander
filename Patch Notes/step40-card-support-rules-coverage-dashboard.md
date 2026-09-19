# Step 40 - Card Support and Rules Coverage Dashboard

Step 40 makes rules/card implementation progress measurable from repository data instead of estimated effort. The dashboard is available from the trainer setup screen and combines the existing Step 17 card-support database, Step 18 parser artifacts, Step 33-36 verification coverage, Step 37 persisted fuzz failures, Step 38 benchmark artifact, and deck-readiness records.

## Data pipeline

`npm run build:step40` writes `src/data/generated/rules-coverage-dashboard.json`. The artifact contains:

- total card/Oracle implementation records;
- fully supported, partially supported, unreviewed, and unsupported dashboard classifications;
- registered mechanics and catalog mechanic usage;
- per-card parser/script/casting/AI/test/custom-hook/caveat details;
- strict-mode deck readiness and named blocking cards;
- rules primitive, pairwise interaction, golden card, judge scenario, fuzz failure, performance, rules-UI, and CI-configuration health signals;
- Step 38 performance measurements and thresholds;
- release-gate metadata derived from actual records/artifacts.

`unreviewed` is a dashboard-only classification for a card that is still partially supported but has no certification and no card/golden behavior tests. It is never counted as fully supported.

## UI

`CardSupportDashboard.jsx` provides filters for support status, mechanic, implementation path, and free-text search. Selecting a card opens its support drill-down. The deck readiness section shows strict-mode blockers and lets a blocker jump directly to its card support record.

The dashboard deliberately distinguishes **CI configured** from **CI passing**. Static repository inspection cannot prove the current remote CI run is green, so the UI does not claim that it is.

## Commands

```bash
npm run build:step40
npm run check:step40
npm run check:step40:data
npm run test:step40
```
