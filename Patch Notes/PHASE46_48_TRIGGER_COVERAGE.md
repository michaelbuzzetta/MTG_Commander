# Phase 46–48 — Trigger Coverage Expansion

This batch continues the post-release-candidate card-coverage campaign. It does not claim universal card support.

## Step 46 — High-frequency trigger families
- Extended self-ETB recognition to Oracle wording for Aura and Equipment permanents.
- Added exact high-confidence beginning-of-upkeep draw and common utility-token payloads.
- Reused existing authoritative trigger/effect primitives rather than adding card-specific execution paths.

## Step 47 — Trigger payload expansion
- Added beginning-of-end-step fixed life-gain and common Treasure/Clue/Food token creation.
- Added self-attack fixed life-gain and self-dies fixed life-gain templates.
- All templates remain fail-closed: wording outside the exact supported grammar remains review-required.

## Step 48 — Cross-permanent death triggers and recensus
- Added the common "another creature you control dies" fixed-card-draw trigger.
- Added dedicated Phase 46–48 regression tests.
- Re-ran the complete bundled 38,681-card catalog census.

### Census
Phase 45 baseline: 2,139 fully compiled; 11,271 partial; 25,271 manual review; 0 failures.
Phase 48: 2,159 fully compiled; 11,262 partial; 25,260 manual review; 0 failures.

Fully compiled coverage increased from 5.53% to 5.58%; at-least-partial coverage increased from 34.67% to 34.70%. The small movement is expected because this batch intentionally implements only trigger forms whose complete semantics can be expressed by existing authoritative primitives. Complex trigger payloads remain explicit review items.
