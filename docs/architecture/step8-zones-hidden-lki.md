# Step 8 Architecture — Zones, Hidden Information, and Last Known Information

## Objective

Step 8 centralizes every player-zone transition and establishes a viewer-aware information boundary so zone movement, hidden-card visibility, known information, and Last Known Information (LKI) are all owned by the rules engine.

The architectural rule for this checkpoint is simple: production code may *query* zones from anywhere, but it may mutate player-zone containers only through `src/engine/zones/` and canonical `MOVE_ZONE` events.

## Zone subsystem

The Step 8 subsystem lives under `src/engine/zones/`:

- `ZoneTypes.js` — canonical player/public/hidden zone classification.
- `ZoneService.js` — authoritative zone lookup, detach/place/move/reorder/shuffle/replace/control-transfer operations.
- `HiddenInformation.js` — per-viewer state redaction and hidden-card placeholders.
- `KnownInformationTracker.js` — tracks legal look/reveal knowledge and invalidates it when information becomes stale.
- `LastKnownInformation.js` — captures pre-zone-change characteristics for later rules queries.
- `legacyStateZoneApi.js` — compatibility-only state helpers kept behind the zone boundary.
- `index.js` — subsystem exports.

`ZoneManager.js` remains only as a compatibility facade for older tests/callers. Production engine movement is routed through `ZoneService` and `MOVE_ZONE`.

## Canonical MOVE_ZONE transaction

`GameEngine` registers `ENGINE_EVENT.MOVE_ZONE` as the canonical zone-change transaction. The handler:

1. validates the source and destination;
2. captures source-zone, owner, controller, object identity, and LKI before mutation;
3. removes the object from its current zone/stack location;
4. creates the new rules-object incarnation required by a zone change;
5. places the object in the destination zone;
6. records `fromZone`, owner/controller provenance, previous/new `gameObjectId`, `zoneChangeId`, and `lkiId` on the event;
7. updates legal known-information state;
8. emits leave-battlefield information using the pre-change LKI snapshot when appropriate;
9. prunes the bounded LKI store.

Spell copies are handled specially: a copied spell removed from the stack does not become a physical card in another zone.

All new player-zone movement paths use this transaction rather than direct `push`/`splice` logic outside the zone subsystem.

## Object identity and zone changes

Step 2 established physical-card identity separately from rules-object identity. Step 8 applies that model uniformly to zone transitions:

- `instanceId` remains the physical-card identity;
- every rules-relevant zone change produces a new `gameObjectId`;
- `previousGameObjectId` links the prior incarnation;
- `zoneChangeId` increments on each new incarnation;
- temporary battlefield state is cleared by the zone-entry preparation path.

This allows effects and tests to distinguish “the same physical card” from “the same rules object.”

## Hidden-information boundary

`GameEngine.getPlayerStateSnapshot(viewerId)` now returns a detached immutable viewer-specific state through `HiddenInformationService`.

Visibility rules include:

- a player sees their own hand;
- opponent hands are represented by opaque placeholders that preserve count but not identity;
- libraries are hidden by default, including the viewer's own library;
- cards become visible only when the viewer has an explicit legal look/reveal/search permission;
- public zones are visible except where face-down rules require concealment;
- another player's private pending choice does not expose candidate ids;
- event/trigger payloads embedded in player snapshots are redacted if they would reveal hidden cards;
- raw LKI maps are never exposed to player/AI snapshots.

The public snapshot retains enough structural information for rendering and AI decisions without leaking authoritative hidden objects.

## Known-information tracking

`KnownInformationTracker` stores information separately per viewer.

Supported operations include:

- `look(viewerId, card)` — private knowledge for one player;
- `reveal(card)` — public knowledge for all players;
- `forget` / `forgetForAll` — invalidate stale tracking;
- `clearLibraryKnowledge(playerId)` — clears tracked knowledge after a shuffle;
- `onZoneChange(...)` — forgets stale hidden-zone identity unless the resolving effect explicitly grants continuing knowledge.

Search/choice windows may authorize only the exact candidate objects involved. The rest of the hidden zone remains opaque.

## Last Known Information

`LastKnownInformationService.capture()` records the object *before* it changes zones, including:

- owner/controller;
- prior `gameObjectId` / `zoneChangeId`;
- counters;
- damage and attachment state;
- face/base characteristics;
- derived power/toughness and other derived characteristics;
- effective abilities;
- source zone, reason, event id, turn, and phase.

Legacy fixtures are canonicalized before capture so LKI always has a valid rules-object identity. Records can be queried internally by prior `gameObjectId` or physical `instanceId` and are bounded by pruning.

## Commander movement integration

Step 8 supplies both categories required by the workflow:

- hand/library movement can request the Commander replacement choice *before* the move;
- graveyard/exile movement is observable first, then the existing state-based-action choice may move the commander to the command zone.

The eventual movement to the command zone also uses `MOVE_ZONE`, preserving event provenance and object identity.

## Tokens and zone changes

Tokens use the same `MOVE_ZONE` path as cards. A token can therefore leave the battlefield, generate zone-change/LKI information, and trigger relevant observations. The existing state-based-action loop then removes tokens that remain in non-battlefield player zones, so they cannot persist illegally.

## Architecture enforcement

`scripts/check-architecture.mjs` now statically rejects direct mutation or replacement of player zone arrays outside `src/engine/zones/`.

The guarded zones are:

- library
- hand
- battlefield
- graveyard
- exile
- command

This is in addition to the Step 1 UI/AI authoritative-state boundary.

## Performance note

The first secure player-snapshot implementation cloned full hidden libraries and full diagnostic history before redaction, which made long multiplayer simulations progressively expensive. The final implementation builds player views from public metadata plus per-zone visibility and retains only a bounded redacted history window. Hidden information remains protected while deterministic four-player/stress simulations remain practical.

## Acceptance status

- No production code directly edits player-zone arrays outside the zone subsystem: **PASS**.
- AI/player hidden-card snapshots do not expose unauthorized cards: **PASS**.
- Dies/LKI scenarios use pre-zone-change characteristics: **PASS**.
- Commander movement choices route through canonical zone changes: **PASS**.
- Zone/known-information/LKI state survives canonical serialization and restoration: **PASS**.
