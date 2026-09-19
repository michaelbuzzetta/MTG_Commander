# Step 35 — Golden Behavioral Tests for Cards

## Purpose

Step 35 gives every card marked `fully_supported` a version-locked executable behavior contract. Primitive and cross-system tests prove the rules engine in general; golden card tests prove that a specific supported card still maps to the intended rules behavior after card-data, Oracle-text, compiler, or engine changes.

## Golden contract manifest

`tests/golden/step35-golden-cards.json` is the review-locked manifest. Every fully supported card records:

- the card id and display name;
- Oracle identity (real Oracle id when cached, otherwise the explicit local-name fallback already used by Step 17);
- a SHA-256-derived Oracle-text fingerprint;
- the Step 17 support rules version;
- one or more executable golden behavior case ids.

An Oracle-text change therefore makes the Step 35 gate fail until the fixture is intentionally reviewed and updated. The manifest also records the current engine rules version used by these tests.

## Reusable card harness

`tests/golden/CardGoldenHarness.js` provides common rules-authoritative setup operations instead of duplicating state manipulation in every test:

- create a started test game and put it at a legal priority window;
- instantiate a real current database card into hand or battlefield;
- provide deterministic mana;
- cast a spell through `GameEngine.cast`;
- pass multiplayer priority until the top stack object resolves;
- create fixture counters;
- inspect zones and derived characteristics;
- assert critical event ordering.

The harness disables Step 32 invariants because golden fixtures deliberately add isolated physical card objects outside the loaded 100-card deck lists. Actions after setup still go through the authoritative rules engine.

## Behavioral suite

`tests/step35-golden-card-behavior.test.js` executes each manifest case. The current suite contains 28 cases across all 26 fully supported cards. It covers, among other contracts:

- basic and Commander-identity mana abilities;
- permanent casting and zone resolution;
- draw, damage, and destroy spells;
- counter and token replacement effects;
- Academy Manufactor token-type replacement;
- Evolution Sage landfall/proliferate choice flow;
- Merfolk Mistbinder continuous effects;
- flying/reach, menace, trample, vigilance, indestructible, deathtouch, and lifelink;
- cards with multiple material behaviors (Doubling Season and Vampire Nighthawk) with multiple golden cases.

Spell contracts assert not only final state but critical event order such as `CAST -> DRAW_CARD/DEAL_DAMAGE/DESTROY -> MOVE_ZONE -> SPELL_RESOLVED` where applicable.

## Full-support gate

Step 17 support generation now consumes the Step 35 manifest. A certified card cannot remain `fully_supported` unless it has a current golden contract with at least one case, a matching Oracle-text fingerprint, and the expected support rules version. Missing or stale golden metadata downgrades the card to partial support with an explicit caveat.

`npm run check:step35` independently validates the same contract and writes:

- `coverage/step35-golden-card-coverage.json`
- `coverage/step35-golden-card-coverage.md`

`npm run test:step35` executes the behavior contracts. Both commands are part of `npm run verify` and the dedicated GitHub Actions golden-card gate.

## Change policy

When a fully supported card changes:

1. Do not automatically update the fingerprint.
2. Review the changed Oracle text and implementation.
3. Update/add golden behavior cases for every materially distinct changed ability or mode.
4. Run `npm run build-support` so support metadata reflects the reviewed contract.
5. Run `npm run check:step35` and `npm run test:step35`.
6. Only then may the card remain fully supported.
