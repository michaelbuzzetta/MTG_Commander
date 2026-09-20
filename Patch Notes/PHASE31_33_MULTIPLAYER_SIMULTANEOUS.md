# Phase 31–33 — Multiplayer and simultaneous-event foundations

Oracle parser: **4.5.0**.

## Step 31 — unusual multiplayer mechanics
- Added an authoritative Monarch state slot and `BECOME_MONARCH` engine event.
- Added `MonarchService` for ownership queries and combat-damage transfer.
- Added a reusable `becomeMonarch` script primitive and exact Oracle templates for standalone and self-ETB "you become the monarch" text.
- The service exposes the monarch end-step draw operation; broader monarch-dependent Oracle conditions remain fail-closed until their exact condition templates are added.

## Step 32 — multiplayer/APNAP
- Centralized living-player APNAP rotation in `MultiplayerRelationService`.
- Added APNAP grouping for simultaneous player-controlled objects/choices.
- TriggerEngine now consumes the shared multiplayer APNAP implementation instead of maintaining a private copy.
- Eliminated players are omitted deterministically.

## Step 33 — simultaneous events
- Added `EventDispatcher.dispatchSimultaneous()`.
- Every member receives shared batch identity, index, and batch size metadata.
- Trigger stacking is deferred until the complete simultaneous set commits.
- State-based actions run after the set rather than between members (unless explicitly disabled).
- Replacement/prevention processing remains per event, preserving affected-player semantics.

## Validation
Focused regression suite: 64/64 passing across Phase 31–33, Step 9 triggers, Step 14 multiplayer/Commander, and Step 18 Oracle compilation.
Oracle artifact check: 647 curated cards validated under parser 4.5.0.
