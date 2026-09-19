# Step 7 — Mana, Costs and Payment

## Purpose

Step 7 makes cost determination and payment a dedicated rules subsystem instead of a collection of cast/activation shortcuts. The engine now separates **what a spell or ability costs** from **how a player pays that cost**, locks the final cost before resources are committed, and treats the entire payment as an atomic transaction.

This checkpoint deliberately does **not** implement the complete rules text of every historical casting mechanic. It establishes the generic cost/payment primitives and registered hooks that later mechanic/card work (especially Step 15) can reuse.

## Module layout

`src/engine/costs/` contains the Step 7 subsystem:

- `ManaSymbol.js` — parses and normalizes mana symbols.
- `ManaPool.js` — represents spendable mana plus per-unit restriction/source/snow metadata.
- `CostEngine.js` — determines and locks spell/ability costs in rules order.
- `PaymentPlanner.js` — finds deterministic legal payment plans and supports explicit source plans.
- `PaymentService.js` — validates and commits mana and non-mana costs atomically.
- `CostMechanics.js` — registry of cost-mechanic extension points.
- `index.js` — package exports.

`src/engine/ManaEngine.js` remains as a compatibility facade. Existing callers keep their old entry points, but affordability/autopay now use the Step 7 planner.

## Mana symbols and mana pools

The symbol model handles:

- `{W}`, `{U}`, `{B}`, `{R}`, `{G}`
- `{C}`
- numeric generic costs such as `{1}` and `{12}`
- hybrid symbols such as `{W/U}` and `{2/G}`
- Phyrexian mana such as `{U/P}`
- snow mana `{S}`
- variable symbols `{X}`, `{Y}`, and `{Z}`

Variable values are supplied as payment/cost context instead of being guessed from rendered text.

A player's ordinary `manaPool` retains the existing W/U/B/R/G/C counters for compatibility. `restrictedMana` adds first-class metadata per annotated mana unit, including source id, spending restriction, snow status, and tags. This lets the engine distinguish, for example, ordinary green mana from green mana that may only be spent on a creature spell.

Chosen-creature-type restrictions are normalized to data carrying the chosen subtype so the restriction remains meaningful after the mana has been produced. This was also locked in with a regression test after stress testing exposed an identity/revalidation edge case.

## Cost determination pipeline

`CostEngine.determineSpellCost()` produces an immutable locked-cost record. The stages are intentionally distinct:

1. Determine the printed/base cost or an applicable alternative cost.
2. Add mandatory and selected optional additional costs.
3. Apply cost increases.
4. Apply cost reductions.
5. Apply a supported minimum-cost floor.
6. Lock the resulting mana cost and variable values before payment.

The locked record preserves the contributing stages for diagnostics instead of only returning a rewritten mana string.

Commander tax is represented as an **additional cost**. The existing single-commander tax state is preserved at this checkpoint; Step 14 is responsible for the later persistent per-commander identity/tax ledger required for paired-commanders and full Commander correctness.

Currently recognized additional/alternative cost data includes the existing engine paths plus hooks for kicker, buyback, entwine, replicate, foretell, escape, emerge, offering, and casting without paying the mana cost. Cost-mechanic registration also exposes extension points for casualty, convoke, delve, improvise, Phyrexian mana, and related mechanics. Those hooks are not a claim that every card using those mechanics is fully scripted yet.

## Payment planning

`PaymentPlanner` evaluates the locked mana requirement against:

- floating mana already in the pool;
- per-unit spending restrictions;
- snow-source metadata;
- untapped legal mana abilities;
- summoning sickness/haste for creature tap abilities;
- source restrictions such as creature-spell or chosen-creature-type mana;
- hybrid/Phyrexian alternatives;
- X/Y/Z values;
- sources reserved for non-mana costs.

The planner is deterministic. It prefers, in order, less life payment, fewer mana-source activations, fewer flexible/any-color activations, less excess production, and stable source order.

The implementation uses a **cost-bounded dynamic program**: states represent the unsatisfied portions of the cost rather than every possible board-wide mana-production vector. This keeps large multiplayer boards practical while still exploring choices such as whether a snow mana unit should satisfy `{S}`, its color, or generic mana.

A manual plan may supply exact mana-source ids (and, where relevant, life/symbol choices). The default game flow continues to use deterministic autopay so existing gameplay is not interrupted. `PaymentDialog.jsx` is the reusable rules-agnostic UI surface for explicit source selection when a caller chooses to expose manual payment.

## Non-mana costs

`PaymentService` provides reusable validation/commit primitives for:

- tap;
- untap;
- sacrifice;
- discard;
- pay life;
- exile from graveyard;
- remove counters;
- reveal;
- return a permanent.

Objects used to satisfy a non-mana cost are reserved from automatic mana-source selection where the two uses would conflict. For example, an artifact that must tap to pay an activated ability's tap cost cannot simultaneously be auto-tapped as the mana source for that same ability.

Mechanic-specific selections such as retrace discard, escape exiles, casualty/emerge/offering sacrifice, convoke/improvise taps, and delve exiles now have a common non-mana-cost representation. The later mechanic library is responsible for complete mechanic-specific legality and semantics.

## Atomic payment

A cast or activation follows this high-level flow:

1. Validate action/targets.
2. Determine and lock cost.
3. Validate all non-mana costs.
4. Produce a legal mana-payment plan while reserving conflicting objects.
5. Snapshot authoritative state.
6. Commit non-mana costs and mana-source activations.
7. Spend the exact mana/life represented by the plan.
8. Only then place the spell/ability on the stack.

If any commit stage fails, state is restored. The cast event is also configured for action-level rollback, so a failure after cost commitment but before successful stack insertion restores the entire pre-cast state.

Stack spell records retain the locked cost and exact payment plan for diagnostics/replay work.

## Public engine queries

Step 7 adds immutable public query surfaces:

- `getCostMechanicRegistrySnapshot()`
- `getCastCostSnapshot(playerId, action)`
- `getPaymentPlanSnapshot(playerId, action)`

UI/AI consumers can inspect legal cost/payment information without reaching into private engine internals.

## Acceptance coverage

The dedicated Step 7 suite covers:

- every required mana-symbol family;
- hybrid, Phyrexian, snow, and X payment;
- restricted-mana legality;
- ordered cost determination and minimum floors;
- commander tax as an additional cost;
- optional additional costs under a free-cast alternative;
- deterministic versus explicitly selected payment sources;
- non-mana source reservation;
- full rollback after a post-payment cast failure;
- locked cost/payment retention on stack objects;
- registered mechanic hooks;
- rules-agnostic payment UI;
- chosen-creature-type restricted-mana atomic-commit regression behavior.

## Boundary to Step 8

Step 7 does not replace Step 8. Zone movement, hidden information, command-zone movement replacement, public-known information, and Last Known Information remain Step 8 responsibilities. This checkpoint stops at the mana/cost/payment dependency boundary.
