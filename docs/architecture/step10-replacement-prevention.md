# Step 10 Architecture — Replacement and Prevention Effects

## Objective

Step 10 moves event replacement and damage prevention into reusable rules services that operate inside the Step 3 authoritative event lifecycle. An event is proposed, replacement effects may transform or replace it before state changes, prevention then modifies preventable damage, and only the final event is validated and committed. UI, AI, and card code do not perform replacement mutations directly.

## Subsystem layout

The implementation lives under `src/engine/replacement/`:

- `ReplacementEffect.js` — normalized replacement-effect definition plus declarative transforms for the current card-data vocabulary.
- `ReplacementRegistry.js` — registry for programmatic replacements and dynamic discovery of card-backed replacement abilities.
- `ReplacementService.js` — applicability, replacement-order selection, re-evaluation, choice deferral, loop protection, and diagnostics.
- `PreventionEffect.js` — normalized consumable prevention-shield definition.
- `PreventionService.js` — damage-prevention matching, shield consumption/expiration, shield-counter handling, and prevention tracing.
- `index.js` — subsystem exports.

`GameEngine` creates both services. The event transformer order is intentionally:

1. replacement effects;
2. prevention effects;
3. authoritative event validation/commit.

That ordering lets a damage replacement change the amount/source/recipient metadata before a prevention shield decides what can actually be prevented.

## ReplacementEffect model

A `ReplacementEffect` declares:

- stable `id`;
- one or more canonical engine event types;
- optional applicability predicate;
- affected-player resolver;
- transformation function;
- source/controller/source-name metadata;
- per-event usage limit;
- optional duration constraints;
- arbitrary diagnostic/script metadata.

Durations currently support turn limits, source-presence requirements, and programmatic predicates. A replacement is considered only when active and when its event type/predicate matches the proposed event.

The service records the IDs already applied to a single event. An effect therefore cannot replace the same event again unless a future rules module explicitly models a distinct new event. A hard safety guard also prevents malformed replacement graphs from hanging the engine.

## Card-data migration

`ReplacementRegistry` discovers `ability.type === "replacement"` definitions from permanents on the battlefield and compiles them into the same `ReplacementEffect` model used by programmatic tests/hooks.

The current authoritative gameplay database has **11 replacement declarations across 10 cards**. These include the existing counter-addition/counter-doubling effects, token doublers, Academy Manufactor-style token replacement, and Barbara Wright's lore-counter replacement. They no longer require the removed pre-Step-10 `ReplacementEngine`.

Current declarative transform vocabulary includes:

- add one to an event amount;
- double an event amount/token batch;
- Academy Manufactor utility-token replacement;
- set a zone destination;
- enter tapped;
- enter with counters;
- prevent an event;
- replace one canonical event type with another.

Later card-scripting/compiler steps can produce these definitions directly instead of adding rules logic to React or card-specific handlers.

## Replacement selection loop

For each proposed event, `ReplacementService`:

1. collects currently applicable replacements;
2. excludes effects already applied to this event or over their usage limit;
3. identifies the affected player/object;
4. selects the next replacement according to an approved order or deterministic order when no meaningful choice exists;
5. applies that replacement;
6. records diagnostic information;
7. re-evaluates the transformed event for newly applicable replacement effects;
8. repeats until no replacement remains.

When multiple noncommutative replacement effects apply, `dispatchWithChoice()` creates a standard Step 6 `REPLACEMENT_ORDER` choice owned by the correct affected player. Human UI and AI therefore answer the same engine-owned choice request. After the order is submitted, the original event is reconstructed and dispatched with that order.

Known commutative combinations are allowed to resolve without interrupting play. For example, the current token-doubling/Academy-Manufactor transformations produce the same token quantities regardless of order, so they do not open a meaningless dialog. This optimization does not bypass the replacement loop.

## Event-type replacement and final validation

A replacement may change both payload and canonical event type. `EventDispatcher` first validates the originally requested event enough to reject malformed requests, runs the transformer chain, then looks up and validates the authoritative handler for the **final transformed event type** before any state mutation occurs.

This allows rules such as a draw being replaced by a different event category without calling the wrong commit handler or partially performing the original event.

## Entry replacement effects

`MOVE_ZONE` is a first-class replacement point. A replacement can redirect the destination or attach `entryState` data before the zone-change transaction is committed.

For battlefield entries, the event transaction applies replacement-created entry state before enter-the-battlefield trigger observation. The currently implemented generic entry state includes:

- entering tapped;
- entering with arbitrary counter batches.

The replacement architecture also provides the pre-entry transaction/choice point needed by future copy-entry rules. Full Magic copiable-value semantics are intentionally implemented in the workflow's later dedicated copy subsystem rather than duplicated here.

## Prevention effects

`PreventionService` handles preventable `DEAL_DAMAGE` events after replacement transformations and before the damage handler commits.

A prevention effect records:

- stable ID;
- source metadata;
- target reference;
- remaining preventable amount (including an unlimited value);
- optional runtime predicate;
- expiration data;
- metadata used by compatibility/diagnostics.

The service supports:

- fixed-amount consumable damage shields;
- all-damage shields through an unlimited remaining amount;
- source/class filtering through predicates;
- end-of-turn expiration and cleanup pruning;
- existing shield counters;
- the legacy public `damagePrevention` field as a compatibility mirror while authoritative consumption is service-owned.

`preventable: false` or `unpreventable: true` bypasses prevention without consuming any shield, representing the Step 10 "damage can't be prevented" hook.

Prevention consumptions are proposed during the transform phase but committed only inside the authoritative damage event handler. This prevents a rejected/failed damage event from consuming resources before state mutation succeeds.

## Replacement/prevention categories

The generic event vocabulary now permits replacement effects over any canonical event type. Step 10 specifically exercises and/or migrates:

- counter placement;
- token creation;
- card draw;
- life events;
- zone changes;
- battlefield-entry modifications;
- damage replacement;
- damage prevention.

Because counter/token/draw/zone/life operations already route through Step 3 events, future card scripts can register replacements without bypassing those shared systems.

## Diagnostics

Two diagnostic layers are available:

- each committed event record carries `replacementTrace` and `preventionTrace` describing the transformations actually applied to that event;
- `GameEngine.getReplacementTraceSnapshot()` exposes the service trace, including `considered`, `selected`, `choice_requested`, and `applied` stages.

Replacement diagnostics include replacement IDs, source names, affected player, and summarized before/after payloads. Prevention traces record shield/source identity, amount prevented, and target. These traces are diagnostic/non-authoritative data and do not grant UI/AI mutation rights.

## Serialization and cleanup

Normal prevention shields live in canonical `GameState.preventionEffects`, so save/restore preserves them. Runtime-only function predicates remain in memory because functions are not serializable game data. `GameStateSchema` hydrates the new field when older snapshots are restored.

Step 4 cleanup calls `PreventionService.pruneExpired()` so end-of-turn shields disappear at the correct boundary and the compatibility mirror is cleared.

## Compatibility notes

The old `src/engine/ReplacementEngine.js` has been removed. `EffectEngine` now delegates counter and token replacements to `ReplacementService` and damage prevention to `PreventionService`. Existing serialized replacement-order choices retain a compatibility path while new replacement choices use the generic `replacementEvent` payload.

The pre-Step-10 `_preventDamage` helper remains only as an unused compatibility-era method in `GameEngine`; authoritative `DEAL_DAMAGE` now consumes prevention through `PreventionService`.

## Acceptance status

- Multiple applicable replacements can be ordered by the correct affected player: **PASS**.
- The same replacement cannot illegally reapply to one event: **PASS**.
- Replacement effects are re-evaluated after each transformation: **PASS**.
- A replacement can change canonical event type and use the correct final handler: **PASS**.
- Zone and battlefield-entry replacements execute before observable entry triggers: **PASS**.
- Counter, token, draw/life, and zone replacement scenarios have regression coverage: **PASS**.
- Damage replacement executes before damage prevention: **PASS**.
- Consumable shields, shield counters, expiration, and unpreventable damage are service-owned: **PASS**.
- Replacement diagnostics expose considered/selected/applied decisions: **PASS**.
- UI and AI use the existing engine-owned generic replacement-order choice protocol: **PASS**.
