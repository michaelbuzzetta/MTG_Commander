# Step 7 Completion Report — Mana, Costs and Payment

## Status

**COMPLETE — gated Step 7 checkpoint. Step 8 has not been started.**

Step 7's objective was to create a complete reusable cost-calculation and payment foundation covering mana symbols, restricted mana, cost ordering, non-mana payments, deterministic/manual payment planning, mechanic extension points, and atomic commitment before stack insertion.

## Delivered

### 1. Mana symbol parser and canonical requirements

Added `src/engine/costs/ManaSymbol.js` with parsing/expansion for:

- W/U/B/R/G colored mana
- colorless `{C}`
- generic numeric mana
- hybrid mana, including numeric hybrid
- Phyrexian mana
- snow mana
- X/Y/Z variables

Hybrid and Phyrexian symbols compile into explicit alternative payment requirements; variable symbols use locked values supplied by the action/cost context.

### 2. Mana pool with restricted-mana metadata

Added `src/engine/costs/ManaPool.js` and extended player state with `restrictedMana`.

The engine can now retain per-unit source, restriction, snow, and tag metadata while keeping the existing W/U/B/R/G/C pool shape compatible with prior code. Spending checks the actual payment context, preventing restricted mana from being used on an illegal class of spell/ability.

### 3. Cost-calculation pipeline

Added `src/engine/costs/CostEngine.js`.

Spell/ability cost determination is now separate from payment. Spell cost calculation records and locks:

1. base or alternative cost;
2. mandatory/selected additional costs;
3. increases;
4. reductions;
5. supported minimum-cost floor;
6. final mana requirement and variable values.

Commander tax is explicitly represented as an additional cost rather than silently rewriting printed mana cost.

### 4. Deterministic/manual payment planner

Added `src/engine/costs/PaymentPlanner.js`.

The shared solver handles floating mana, legal mana sources, any-color sources, hybrid choices, snow requirements, Phyrexian life alternatives, source restrictions, and reserved non-mana-cost objects. It supports both deterministic autopay and explicit source-id plans.

During verification, the initial production-vector search proved too expensive in long multiplayer simulations. It was replaced with a cost-bounded dynamic program keyed by the *remaining requirement*. The four-player simulation returned to practical runtime while preserving the new rules coverage.

### 5. Atomic mana and non-mana payment

Added `src/engine/costs/PaymentService.js`.

Reusable non-mana cost primitives include tap, untap, sacrifice, discard, pay life, exile, remove counters, reveal, and return-permanent. Casts and activations validate and commit costs transactionally. A payment/stack failure restores authoritative state so mana, tapped permanents, sacrificed/discarded resources, and cards do not remain partially committed.

A stress-discovered edge case involving chosen-creature-type restricted mana was fixed by preserving the chosen subtype in the restriction metadata and by maintaining exact mana-unit/source identity during commit. A permanent regression test was added before completion.

### 6. Cost mechanic extension registry

Added `src/engine/costs/CostMechanics.js` with registered Step 7 extension points for:

- commander tax
- kicker
- buyback
- entwine
- replicate
- casualty
- convoke
- delve
- improvise
- Phyrexian mana
- emerge
- offering
- escape

This is the **cost-system hook layer** required by Step 7. It does not claim that every card/mechanic in those families is fully implemented; the reusable mechanic library/card migration occurs in later workflow steps.

### 7. GameEngine and legacy integration

`GameEngine` now owns `CostEngine` and `PaymentService` and exposes immutable cost/payment queries. Spell casts and non-mana ability activations route through locked cost/payment records. `ManaEngine.js` remains a compatibility facade so existing gameplay continues working while using the new planner underneath.

New public queries:

- `getCostMechanicRegistrySnapshot()`
- `getCastCostSnapshot(playerId, action)`
- `getPaymentPlanSnapshot(playerId, action)`

### 8. Payment UI surface

Added `src/components/PaymentDialog.jsx`, a rules-agnostic source selector that submits a `sourceIds` payment plan. Existing gameplay remains deterministic-autopay by default so Step 7 does not force new clicks into every cast.

## Acceptance criteria

| Workflow criterion | Result |
| --- | --- |
| Cost increase/reduction ordering matches rule tests | **PASS** — staged locked-cost test covers base/additional/increase/reduction/minimum ordering. |
| Commander tax is an additional cost | **PASS** — retained separately in `additionalCosts`. |
| Restricted mana cannot be spent illegally | **PASS** — per-unit metadata and payment-context checks. |
| Cancelled/illegal/failed attempts do not consume resources | **PASS** — validation before commit plus transactional rollback; injected post-payment stack failure test restores state. |

## Verification

Final code was verified in deterministic test shards to avoid the execution container's parallel-test wall-clock contention:

- **295 / 295 repository tests passing**
  - foundation/category shard: 92 / 92
  - combat/core/mana/multiplayer shard: 86 / 86
  - Step 1–7 + deck regression shard: 79 / 79
  - AI shard: 16 / 16
  - Explorers complete shard: 21 / 21
  - long stress shard: 1 / 1
- **13 / 13 dedicated Step 7 tests passing**
- `npm run check:architecture`: **PASS**
- `npm run check-db`: **PASS — 647 cards / 13 decks**
- deterministic four-player last-player-standing test: **PASS**
- deterministic long stress regression: **PASS**
- mutation audit regenerated: **307 internal direct-mutation locations; 0 production UI, 0 AI**

The monolithic parallel `node --test tests/*.test.js` invocation can exceed this container's execution window because the multiplayer/stress simulations contend when run concurrently; the same complete file set passes when run in deterministic shards as listed above.

## Production-build environment note

`npm run build` was attempted. The prebuild Scryfall refresh could not reach the network and correctly fell back to the local 647-card catalog. The build then stopped because this execution container does not have the project's `node_modules`/`vite` binary installed:

`sh: 1: vite: not found`

This is an environment/dependency-install limitation, not a rules-test failure. No `node_modules` directory is included in the checkpoint ZIP.

## Files added for Step 7

- `src/engine/costs/ManaSymbol.js`
- `src/engine/costs/ManaPool.js`
- `src/engine/costs/CostEngine.js`
- `src/engine/costs/PaymentPlanner.js`
- `src/engine/costs/PaymentService.js`
- `src/engine/costs/CostMechanics.js`
- `src/engine/costs/index.js`
- `src/components/PaymentDialog.jsx`
- `tests/step7-costs-payment.test.js`
- `docs/architecture/step7-mana-costs-payment.md`
- `STEP7_COMPLETION_REPORT.md`

## Gating statement

Step 8 — Zones, Zone Changes, Hidden Information and Last Known Information — has **not** been started. The output of this checkpoint is therefore a clean Step 7 baseline for the next gated increment.
