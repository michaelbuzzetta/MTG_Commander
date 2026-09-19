# Step 23 — Attachments

## Goal

Step 23 introduces one engine-owned attachment model for Auras, Equipment, Fortifications, Reconfigure, and future attachment-like mechanics. UI state is descriptive only; authoritative relationships live in `GameState.attachments` and change through engine events.

## Attachment relationships

`src/engine/attachments/AttachmentService.js` owns attachment records. Each relationship records the attached object, host object/player, host kind, attachment class, legal-host filter, reason, timestamp, and controller-at-attach metadata. Legacy `attachedTo` fields are maintained only as a compatibility projection and are reconciled into the canonical relationship store.

`ATTACH` and `DETACH` are canonical engine events. Zone changes detach departing objects/hosts through the same service, keeping event logs, SBAs, LKI, and replay-visible state coherent.

## Auras

Aura spell targeting is inferred from the Oracle `Enchant ...` clause when older card data lacks an explicit target schema. Cast Auras therefore use normal target legality, including protection, while Auras put directly onto the battlefield use a non-targeting `ATTACHMENT_ENTRY` choice as Magic requires.

Aura legality is re-evaluated by state-based actions. If an Aura becomes unattached or its host becomes illegal because of a zone, type, controller, or protection change, the Aura is moved to its owner's graveyard through the canonical zone/event path.

## Equipment, Fortifications, and Reconfigure

Equip, Fortify, and Reconfigure are exposed as generated activated abilities rather than UI-only commands. They use the existing timing, costs/payment, targeting, priority, and stack systems. Equipment and Fortifications that lose a legal host remain on the battlefield unattached.

Reconfigure uses the same relationship model; while attached, a layer-4 continuous effect removes Creature from the reconfigured object. Detaching automatically restores its base type because no printed/base characteristics were overwritten.

## Continuous effects

Attachment-granted characteristics are represented as continuous effects sourced by the attachment. The host is never permanently rewritten. Detaching, losing the host, or otherwise invalidating the relationship therefore removes the granted bonus naturally during derived-characteristic recalculation.

## UI and AI integration

`getAttachmentSnapshot()` and `getAttachmentUiMetadata()` expose immutable relationship/view data for board grouping and visual links. Human and AI clients still submit normal engine actions/choices.

AI recognizes `ATTACHMENT_ENTRY` choices and avoids strategically empty zero-cost reattachment loops. A discovered stress regression where Equipment could oscillate between hosts is permanently covered by Step 23 tests.

## Verification

Run `npm run test:step23` for the dedicated suite. Coverage includes canonical relationship/event behavior, continuous bonuses, Aura SBAs, type/control/protection changes, Equip/Fortify/Reconfigure actions, Aura spell targeting and direct-entry choices, player Auras, legacy hydration, and AI no-op/oscillation prevention.
