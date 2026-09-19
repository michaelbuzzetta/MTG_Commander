# Step 3 — Universal Actions and Events

This checkpoint implements the workflow's Step 3 event foundation without pulling Step 4+ turn/priority, Step 9 trigger, Step 10 replacement, or Step 12 state-based-action rewrites forward.

## Action vocabulary

`src/engine/actions/ActionTypes.js` defines the canonical player-intent names used by the current public GameEngine gateway. The constants intentionally preserve the existing action wire strings so Step 1 callers and replay actions remain backward compatible.

Core intents include:

- `CAST_SPELL` / `CAST_COMMANDER`
- `PLAY_LAND`
- `ACTIVATE_ABILITY` / `ACTIVATE_MANA`
- `DECLARE_ATTACKERS` / `DECLARE_BLOCKERS`
- `PASS_PRIORITY`
- current pregame/cost-mechanic actions such as mulligan, foretell, and encore

Actions remain requests. They are validated by `GameEngine.validateAction()` before execution.

## Canonical event vocabulary

`src/engine/events/EventTypes.js` defines state-transition and rules-operation events:

- cast / copy
- draw / discard / mill
- move zone
- damage
- life gain / life loss
- destroy / sacrifice / exile
- tap / untap
- add / remove counters
- create token
- search / shuffle
- attack / block
- transform
- control change

Existing trigger-facing names such as `CARD_DRAWN`, `ENTER_BATTLEFIELD`, and `CREATURE_DIED` remain available as compatibility observations. Those observations are also recorded by the Step 3 dispatcher, but they are not a second state-mutation path.

## Event dispatcher lifecycle

`src/engine/events/EventDispatcher.js` owns the common event lifecycle:

1. Construct an event envelope and assign a sequence/event id.
2. Validate the requested event before mutation.
3. Pass the event through generic transformer hooks for future replacement/prevention systems.
4. Revalidate a transformed event.
5. Commit through exactly one registered authoritative handler.
6. Record status, summarized payload/result, and provenance.
7. Publish completed records to generic subscribers.
8. Allow trigger-facing compatibility observations to be queued through the same logging/provenance service.
9. Optionally invoke the current stabilization hook at an outer event boundary when explicitly requested.

The Step 10 replacement/prevention implementation can use `addTransformer()` without adding card-specific hooks to the dispatcher. The Step 9 trigger engine can use `subscribe(type, fn)` or the wildcard subscription rather than requiring bespoke callbacks in core state mutation functions.

## Atomicity

Built-in event handlers validate every failure-prone precondition before the first authoritative write. Invalid events are rejected without changing `GameState` and are captured in the non-authoritative rejected-event diagnostics.

For handlers that can fail after mutation, registration supports `snapshotOnCommitError: true`. The dispatcher restores the complete authoritative state snapshot before propagating the error. Step 3 tests deliberately inject a mutating failure and verify byte-for-byte serialized-state equivalence after rollback.

This is the Step 3 transaction boundary. A more specialized transaction/performance implementation can replace the snapshot fallback later without changing event callers.

## Provenance and causal relationships

Every event record includes provenance from `src/engine/events/provenance.js`:

- source object id and source controller when available
- affected object/player ids
- cause
- parent event id
- turn and phase
- active player and priority player
- current public action sequence/type/acting player

Nested events automatically inherit the currently committing event as `parentEventId`. For example, `DRAW_CARD` dispatches `MOVE_ZONE`; the move and the legacy `CARD_DRAWN` observation are children of the draw event.

Records are kept in creation/causal sequence order even though nested child handlers complete before their parent handler returns.

## Event log placement

The event log is intentionally **not stored inside canonical `GameState`**. It is diagnostic/replay metadata owned by `EventDispatcher` and exposed through `GameEngine.getEventLogSnapshot()` and `serializeReplay()`.

Keeping it outside the authoritative state is important because UI and AI receive cloned immutable GameState snapshots. Including an ever-growing event log in every snapshot caused quadratic copying during long four-player simulations. The private log preserves full Step 3 diagnostics while keeping gameplay snapshots bounded.

Restoring/resetting GameState begins a fresh event-log segment. Full replay/checkpoint persistence and seeded deterministic replay are Step 30 responsibilities.

## Migrated mutation paths

The current reusable mutation helpers now route through canonical events rather than changing state independently:

- draw -> `DRAW_CARD` -> nested `MOVE_ZONE`
- zone movement -> `MOVE_ZONE`
- life -> `GAIN_LIFE` / `LOSE_LIFE`
- tap/untap -> `TAP` / `UNTAP`
- add/remove counters (including player counters used by proliferate) -> counter events
- discard/mill -> discard/mill events plus nested zone movement
- shuffle -> `SHUFFLE`
- control changes -> `CONTROL_CHANGE`
- damage -> `DEAL_DAMAGE`, with nested life/counter events where applicable
- destroy/sacrifice/exile -> dedicated events plus zone movement
- token creation -> `CREATE_TOKEN`
- spell copying -> `COPY`
- casting -> `CAST`
- attacker/blocker declarations -> `ATTACK` / `BLOCK`

Existing search effects now issue a canonical `SEARCH` envelope before continuing through the current search-choice implementation. Step 27 will replace those compatibility paths with the complete generalized library-operation subsystem.

## Compatibility adapters

`src/engine/events/legacyMutationAdapters.js` is the machine-readable migration registry for helper APIs retained by existing cards/tests. It documents which canonical event each legacy helper now routes through. This allows later steps to remove old helpers only after their callers migrate.

## Deliberate Step 3 boundaries

This checkpoint does **not** claim to implement later workflow systems early:

- complete phase/turn state machine — Step 4
- tournament stack/priority — Step 5
- universal choices — Step 6
- full cost/payment — Step 7
- complete zone/LKI — Step 8
- generic trigger subscriptions/APNAP — Step 9
- rules-complete replacement/prevention — Step 10
- complete SBAs — Step 12
- complete search/reveal/reorder subsystem — Step 27
- deterministic replay service — Step 30

Step 3 provides the stable event boundary those systems will build on.
