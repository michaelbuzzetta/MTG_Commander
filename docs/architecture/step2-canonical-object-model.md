# Step 2 — Canonical Game State and Object Model

This checkpoint implements the Step 2 object-model foundation while preserving the Step 1 authoritative-engine boundary and all existing gameplay behavior.

## Identity model

The engine now separates three different identity concepts:

1. **Card/rules identity** — `cardIdentity` stores the local rules id plus Oracle and printing identifiers when available. This metadata is immutable.
2. **Physical card compatibility identity** — `instanceId` remains stable for the physical card/token. Existing actions, UI selections, commander-damage references, and regression tests continue to use it during the migration.
3. **Rules object incarnation identity** — `gameObjectId` identifies the current Magic rules object. Every zone change assigns a new `gameObjectId`, stores `previousGameObjectId`, and increments `zoneChangeId`.

This allows effects introduced in later steps to distinguish “the card” from “the object it used to be before changing zones” without breaking the current application API.

## Canonical object kinds

`GAME_OBJECT_KIND` defines first-class object categories:

- `card`
- `spell`
- `permanent`
- `ability-on-stack`
- `token`
- `emblem` (reserved for supported future use)
- `card-face`
- `player`

Cards change object kind as their zone/object role changes. Stack entries also have their own unique `gameObjectId`, separate from a spell card contained by the stack entry.

## Base versus derived characteristics

Every canonical card object contains immutable `baseCharacteristics` copied from the authoritative local rules/card definition at object creation. Temporary state remains separate:

- counters
- marked damage
- tapped state
- temporary modifiers
- controller
- attachments
- summoning-sickness/control timestamps
- face state

`StaticEngine` continues to compute derived power/toughness/keywords and now resolves the active face through the generic card-face abstraction before evaluating characteristics. Temporary effects therefore do not overwrite base/printed values.

## Multi-face abstraction

`src/engine/state/CardFace.js` provides one data model for multi-face layouts rather than adding layout-specific React logic. It recognizes model categories for:

- transforming double-faced cards
- modal double-faced cards
- split cards
- adventures
- aftermath
- meld
- prototype
- battles
- flip cards

Each face is a first-class `card-face` object. `faceState` stores the current battlefield face and cast face. Nonbattlefield zone changes reset to front-face characteristics where appropriate; a selected cast face can carry through from the stack to the battlefield.

## Serialization

`src/engine/state/serialization.js` adds versioned complete-state serialization/deserialization.

The serialized envelope records schema version 2 and preserves:

- physical `instanceId`
- `gameObjectId`
- `previousGameObjectId`
- `zoneChangeId`
- player/object state
- stack state
- pending engine state
- special numeric values such as `Infinity`

Deserialization rehydrates canonical objects, re-freezes immutable card/base metadata, validates the state, and reserves restored numeric UID suffixes so newly created objects do not collide with restored identities.

`GameEngine.serializeState()` and `GameEngine.restoreState()` expose the state snapshot round-trip for development/save-state use without changing the Step 1 gameplay action API.

## Runtime schema

The canonical runtime contract is implemented by:

- `src/engine/state/types.d.ts` — typed TypeScript declaration contract for the JavaScript engine
- `src/engine/state/GameStateSchema.js` — schema version, hydration, and executable validation
- `src/engine/state/GameObject.js` — identity/base-characteristic/object-kind primitives
- `src/engine/state/CardFace.js` — card-face model
- `src/engine/state/serialization.js` — serializer/deserializer

## Compatibility rule

Step 2 intentionally does **not** rewrite the action/target API to use `gameObjectId` everywhere. Existing callers can continue to identify physical cards with `instanceId`; `ZoneManager.find()` and `GameEngine.findPermanent()` also accept `gameObjectId`. Later rules layers can progressively move identity-sensitive interactions to `gameObjectId` without a flag-day rewrite.
