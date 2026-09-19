# Step 13 Completion Report — Complete Combat Engine

## Status

**COMPLETE — gated Step 13 checkpoint. Step 14 has not been started in this archive.**

Step 13 extends the existing authoritative combat engine from creature-vs-player combat into a reusable multiplayer defending-entity model with attack/block restrictions and requirements, additional evasion mechanics, multiple-block capacity, and planeswalker/battle combat targets.

## Implemented deliverables

### 1. Combat legality solver

`CombatEngine.validateAttackers` and `validateBlockers` now enforce declaration legality instead of leaving combat rules to the UI. Attack requirements use maximum-satisfiable target scoring for conflicting specific-player and goad requirements.

### 2. Defending entity model

`legalDefendingEntities` exposes players, planeswalkers, and battles. Combat stores the attacked entity separately from its defending player so multiplayer blocker sequencing remains correct.

### 3. Attack restrictions and requirements

Implemented generic hooks for cannot attack, defender, must attack, specific player/entity requirements, goad, cannot attack alone, target restrictions, and attack taxes/cost acknowledgements.

### 4. Blocking restrictions and requirements

Implemented/retained flying/reach, menace, islandwalk, unblockable, fear, intimidate, shadow, horsemanship, must-block rules, must-be-blocked rules, additional block capacity, and maximum-one-blocker restrictions.

### 5. Damage assignment

Existing multiple-blocker ordering, first strike, double strike, trample, deathtouch, lifelink, prevention/replacement, and commander combat damage stay on the generic damage pipeline. Unblocked combat damage can now hit planeswalkers/battles through the same event path and update loyalty/defense counters.

### 6. Priority windows

The Step 4 turn engine's combat priority windows remain authoritative: beginning of combat, post-attackers, post-blockers, first-strike damage if created, normal damage, and end of combat. Existing regression tests continue to pass.

### 7. UI/public engine queries

Added public immutable queries for legal defending entities and legal blockers. Existing UI/AI architecture boundaries remain intact; the architecture guard passes.

## Acceptance criteria

| Workflow criterion | Result |
| --- | --- |
| Illegal attacks/blocks cannot be submitted | **PASS** — authoritative validation rejects them. |
| Goad/restriction conflicts maximize legal requirements | **PASS** — target-score solver and dedicated multiplayer regression test. |
| First strike/double strike/trample/deathtouch scenarios pass | **PASS** — legacy combat regressions remain green. |
| Commander combat damage is recorded to the correct commander/player pair | **PASS** — dedicated Step 13 test plus existing damage ledger. |

## Verification

Final verification on this Step 13 working tree:

- **347 / 347 non-stress repository tests passing**
- **20 / 20 Step 11–13-specific tests passing** (6 + 7 + 7)
- `npm run check:architecture`: **PASS**
- `npm run check-db`: **PASS — 647 cards / 13 decks**
- `npm run audit:mutations`: completed; inventory refreshed (**314 internal direct mutation paths**) with player-zone mutation boundaries still guarded by the architecture check.

## Production-build environment note

`npm run build` was attempted. The container could not reach Scryfall and correctly retained the local 647-card seed. The archive does not contain installed `node_modules`, so the command then stops at `vite build` with `sh: 1: vite: not found`. This is an environment/dependency-install limitation, not a failing rules-engine regression; the engine tests, architecture guard, and database validation pass.

## Next gate

Step 13 completes the combat portion of **Release B — Core Rules Correctness**. Step 14 — **Commander and Multiplayer Rules** — is the next workflow step and has **not** been started in this checkpoint.
