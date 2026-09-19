# Step 9 Architecture — Triggered Ability Engine

## Objective

Step 9 moves triggered abilities onto the universal Step 3 event stream. Cards no longer need a bespoke callback path for ordinary ETB, dies, upkeep/phase, attack, cast, draw, counter, life-gain, or similar triggers. A completed event is observed, normalized `TriggerDefinition` objects are matched, the resulting triggers are queued, and only after the current action/event and state-based-action boundary is stable are they placed onto the Step 5 stack.

## Trigger subsystem

The Step 9 implementation lives under `src/engine/triggers/`:

- `TriggerDefinition.js` — canonical normalized trigger schema and card-ability compiler.
- `TriggerRegistry.js` — card-backed definitions plus persistent temporary delayed/reflexive registrations.
- `TriggerMatcher.js` — event/source/condition/source-filter/affected-filter matching, including source-zone and LKI rules.
- `PendingTriggerQueue.js` — records simultaneous trigger batches until they may legally be stacked.
- `index.js` — subsystem exports.

`src/engine/TriggerEngine.js` is now the coordinating facade used by `GameEngine`.

## Event-stream subscription

`TriggerEngine` subscribes to `EventDispatcher` using the generic Step 3 subscription API. It observes only completed `committed` or `observed` event records. The dispatcher also provides the immutable raw event payload to subscribers, while the diagnostic event log keeps its compact summarized form.

The dispatcher no longer calls card-specific trigger collection. This means replacement/prevention and other future systems can continue to evolve around the same event lifecycle without special trigger hooks inside individual cards.

## TriggerDefinition

Every data-declared `ability.type === "triggered"` is normalized into a `TriggerDefinition` containing:

- event pattern;
- source zone(s);
- source/card/ability identity;
- controller relationship;
- source and affected-object filters;
- legacy condition predicate data;
- intervening-if predicate;
- optionality;
- target declaration;
- executable effect;
- delayed/reflexive metadata where applicable.

The current authoritative database contains 79 data-declared triggered abilities across 70 cards; all normalize through this path. The previous one-off Bygone Marvels cast-copy handler was also migrated to a normal stack-zone triggered ability in card data.

## Source zones and Last Known Information

Battlefield is the default source zone. A trigger may explicitly declare another zone, including graveyard, exile, command, hand, library, or stack. Hidden-zone cards are not scanned unless their ability explicitly declares that zone.

For leave-the-battlefield/dies events, Step 8 LKI supplies the source as it existed immediately before leaving. The queued trigger therefore retains the prior `gameObjectId`, controller, counters, and other relevant characteristics even though the physical card has already become a new game object in another zone.

Spell-source triggers are supported by scanning stack objects only for abilities explicitly declared with `sourceZone: "stack"`. This is used by Bygone Marvels' cast trigger.

## Matching and filters

Trigger matching is data-driven. `TriggerMatcher` checks:

1. event type;
2. controller/source identity constraints;
3. legal source zone;
4. source card/object identity when specified;
5. shared composable `sourceFilter` and `affectedFilter` predicates from Step 6;
6. trigger condition predicates;
7. intervening-if conditions at trigger time.

The existing condition vocabulary remains supported during migration so current cards continue to function while later scripting/compiler steps replace legacy data shapes with a more general IR.

## Pending trigger queue and rules boundary

A matched trigger is not resolved immediately and is not necessarily put onto the stack immediately. It first enters `GameState.pendingTriggers` with:

- source/LKI snapshot;
- controller;
- triggering event record and causal provenance;
- effect/ability data;
- target/optional/order state;
- definition/kind identity.

Public action submission defers trigger stacking until the action's mutations complete and the current legacy SBA pass has stabilized. Event nesting and trigger observation also suppress premature flushes. Cleanup explicitly flushes newly generated triggers before deciding whether cleanup can end, preserving Step 4's repeated-cleanup rule.

Step 12 will replace the remaining legacy SBA implementation with the complete generic SBA engine; the Step 9 trigger boundary is already structured around that future service.

## Simultaneous triggers and APNAP

Triggers caused by one completed event share a batch. When a batch can be stacked:

1. players are considered in Active Player, Nonactive Player order, rotated from the actual active player in multiplayer turn order;
2. eliminated players are skipped;
3. each player orders only their own simultaneous triggers;
4. that player's ordered triggers are placed onto the stack before moving to the next APNAP player;
5. because the stack is LIFO, the last nonactive player's group resolves first, matching Magic's APNAP behavior.

If a player controls multiple simultaneous triggers, the existing choice protocol opens `TRIGGER_ORDER`. AI and human clients submit the same engine-owned ordering action.

## Optional triggers and targets

Optional triggers open the existing `OPTIONAL_TRIGGER` choice before stack placement. Targeted triggered abilities use the Step 6 targeting service. Targets are chosen when the trigger is put onto the stack and are later revalidated by the Step 5 resolution pipeline.

A triggered ability with no legal target is not illegally placed on the stack.

## Intervening-if conditions

Intervening-if predicates are checked twice:

- when the triggering event is observed; and
- again when the triggered ability resolves.

The matcher can infer the current project's existing intervening-if forms from compatible condition data, or a card/script can supply `interveningIf` explicitly. Resolution failure produces a diagnostic history entry and the effect does not resolve.

## Delayed and reflexive triggers

Temporary triggers are first-class persisted definitions in `GameState.triggerRegistrations`.

`registerDelayedTrigger()` and `registerReflexiveTrigger()` use the same matcher, pending queue, APNAP ordering, target selection, and stack machinery as card-backed triggers. Registrations can:

- retain a source snapshot after the original source leaves;
- expire after firing;
- remain repeatable when explicitly configured;
- expire at a declared event/turn/phase boundary;
- carry a parent ability id for reflexive-trigger provenance.

Temporary registrations serialize and restore with canonical game state.

## Hidden-information integration

Viewer snapshots redact the source snapshot of delayed/reflexive trigger registrations when it refers to a hidden object the viewer is not entitled to know. Pending trigger event/source data continues to use the Step 8 redaction path. Trigger support therefore does not reopen a hidden-information channel.

## Card migration status

All ordinary data-declared triggered abilities in the current card database now flow through `TriggerDefinition` and `TriggerMatcher`; this includes the project's ETB, dies, beginning-of-combat/phase, attack, cast, draw, damage, life-gain, counter-added, and end-step patterns.

Saga chapter creation remains a rules/mechanic producer rather than an ordinary card `abilities[]` trigger declaration; the resulting chapter abilities are still stack objects and will be generalized further in the later mechanic/scripting releases. This does not bypass the matching path for ordinary card-declared triggers.

## Acceptance status

- Four-player simultaneous triggers stack in rotated APNAP order: **PASS**.
- Each player can order only their own simultaneous trigger group: **PASS**.
- Intervening-if conditions are checked at trigger time and resolution: **PASS**.
- Delayed triggers fire/expire through registered temporary definitions: **PASS**.
- Reflexive triggers use the same queue and stack pipeline: **PASS**.
- Leave/dies source data uses Step 8 LKI: **PASS**.
- Nonbattlefield source zones are explicit and enforced: **PASS**.
- Source/affected filters use the shared Step 6 filter library: **PASS**.
- Existing data-declared card triggers compile through the generic TriggerDefinition path: **PASS**.
