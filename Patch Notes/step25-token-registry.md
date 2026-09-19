# Step 25 — Token Registry and Generated Game Objects

The engine now owns reusable generated-token definitions through `src/engine/tokens/`.

## Design

`TokenDefinition` normalizes one reusable rules identity: name, type line, colors, subtypes, abilities, P/T and other copiable characteristics, multi-face data, attachment metadata, token family, and stable definition ID. `TokenRegistry` stores common definitions, card-local definitions, replacement-derived definitions, and deterministic copy-generated definitions. `TokenService` converts a requested definition into an authoritative `CREATE_TOKEN` event payload and materializes the resulting game objects only after replacements have completed.

A token definition is not a token permanent. Many created game objects can share one definition while retaining unique `gameObjectId` / `instanceId` identities and independent mutable battlefield state.

## Common package

The reusable registry includes Treasure, Clue, Food, Blood, Map, Powerstone, Incubator, and supported Role definitions. Incubator uses multi-face token data plus generic Step 24 entry counters. Roles use the Step 23 attachment service and source their continuous bonuses from the token Aura rather than copying bonuses onto the host.

## Copies

Token copies are generated from Step 22 `CopiableValues`. The registry fingerprints those base/copiable characteristics and can reuse the same generated definition for identical copies. Counters, tapped state, damage marked, and temporary continuous modifications are not folded into the copied token definition.

## Events and replacement effects

All creation continues through `CREATE_TOKEN`. Quantity/controller/source/definition data remain visible to replacement effects. Token-doubling and token-type-changing replacements transform the event before commit. Multi-batch replacement effects can expand one creation into multiple token definitions without bypassing the normal event path.

## Zone/SBA behavior

Tokens may change zones long enough for ordinary move-zone observations and triggers to see the transition. The SBA layer then removes token objects that are no longer on the battlefield as required, so they cannot persist in hand, library, graveyard, exile, or command.

## Compatibility

`src/engine/TokenDefinitions.js` is now only a compatibility facade over `TokenRegistry`. Legacy inline custom IDs of the form `token:<Name>` are retained where they are unambiguous. Same-name custom tokens with materially different rules receive separate deterministic identities rather than being conflated.

## Invariants

- A token rules definition is immutable reusable data; mutable battlefield state belongs to the created game object.
- `CREATE_TOKEN` remains the authoritative creation path.
- Replacement effects operate before token objects are committed.
- Token copies derive from copiable values, not rendered derived state.
- Entry counters are applied once through the Step 24 counter service.
- Role/Aura attachment state is owned by the Step 23 attachment service.
- Off-battlefield token cleanup is performed by state-based actions rather than hidden array surgery.
