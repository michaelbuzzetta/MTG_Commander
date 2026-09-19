# Step 15 — Reusable Mechanic Library

Step 15 introduces a registry-driven mechanic layer between card definitions and the authoritative rules subsystems completed in Steps 1–14. Cards can now declare or be recognized as using a mechanic and reuse one implementation contract instead of adding card-name branches to the engine.

## Mechanic registry

`src/mechanics/MechanicRegistry.js` owns normalized mechanic definitions. Each mechanic declares:

- a stable mechanic id and display name;
- category (`evergreen`, `commander`, `casting`, or `specialty`);
- explicit subsystem dependencies;
- optional aliases and keyword/Oracle-text recognition patterns;
- rules hooks used by the mechanic;
- conformance surfaces that require regression coverage.

`src/mechanics/MechanicLibrary.js` registers the packages, validates their declared dependencies, recognizes mechanics from card data, and exposes shared behavior queries to the engine.

## Package coverage

### Evergreen

Flying, reach, first strike, double strike, deathtouch, trample, vigilance, lifelink, haste, hexproof, ward, menace, protection, indestructible, and flash are registered as shared mechanics. Existing authoritative combat, targeting, prevention, SBA, cost, and casting paths delegate their reusable keyword decisions to `MechanicLibrary`.

Notable shared behavior includes flying/reach and protection block legality, menace minimum blockers, first/double-strike damage-step participation, deathtouch lethal assignment, trample routing, vigilance attack tapping, haste/summoning-sickness checks, lifelink/deathtouch damage metadata, hexproof/protection targeting, ward-cost normalization, protection damage prevention, indestructible destroy/SBA behavior, and flash timing permission.

### Commander/common recurring mechanics

The registry includes goad, myriad, encore, cascade, discover, proliferate, populate, investigate, Treasure, Clue, Food, surveil, scry, connive, landfall, prowess, exalted, devotion, and domain.

Prowess, exalted, and myriad can synthesize normal `TriggerDefinition` records instead of requiring a card callback. Investigate and populate use the generic token/effect path. Devotion and domain expose reusable game-state calculations. Other registered mechanics carry explicit hook/dependency metadata so cards using the same mechanic resolve through one library contract as their supporting primitives mature.

### Cost/casting mechanics

The package includes kicker, flashback, escape, suspend, foretell, adventure, delve, convoke, improvise, affinity, prototype, mutate, ninjutsu, unearth, and reconfigure.

Affinity uses a shared cost-reduction hook. Convoke, improvise, and delve expose reusable legal resource candidates for the payment layer. The remaining mechanics are recognized centrally and declare their required cost/zone/stack/card-face/attachment hooks instead of requiring core-engine card-name edits.

### Specialty/legacy mechanics

Persist, undying, exploit, devour, dredge, storm, rebound, morph, manifest, disguise, Saga, Battle, and Vehicle are registered with explicit trigger/zone/replacement/counter/combat/card-face hook contracts. Existing game behavior remains intact while later generic counter, attachment, copy, permission, and card-scripting phases can bind to these same stable mechanic identities.

## Engine integrations

Step 15 updates the authoritative engine consumers rather than duplicating rules in card handlers:

- `GameEngine` constructs one `MechanicLibrary` and delegates haste, flash, lifelink, deathtouch, and indestructible checks.
- `CombatEngine` delegates shared keyword combat legality and damage-step/assignment behavior.
- `TargetingEngine` delegates hexproof, protection, and ward behavior.
- `PreventionService` applies protection damage prevention through the normal prevention pipeline.
- `StateBasedActionEngine` queries the mechanic library for indestructible.
- `TriggerRegistry` merges mechanic-generated trigger definitions with explicit card triggers.
- `CostEngine` consumes the shared affinity reduction hook.
- `StaticEngine` consumes the shared devotion calculation.
- `EffectEngine` contains generic mechanic effect primitives for prowess, exalted, investigate, and populate.

## Conformance and extension model

A new card that uses a registered mechanic can be recognized from `keywords`, explicit mechanic tags, or the mechanic package's Oracle-text patterns. Adding another card with an already-supported mechanic does not require adding a card-name branch to `GameEngine`, `CombatEngine`, or `TargetingEngine`.

`tests/step15-reusable-mechanics.test.js` verifies registry/dependency metadata, shared mechanic identity across cards, evergreen combat and targeting, prevention/damage/SBA integration, reusable cost mechanics, generated triggers, token mechanics, game-state values, and discovery of recurring/casting/specialty mechanics.

## Step boundary

Step 15 provides the reusable mechanic layer and the shared hooks that can be expressed safely on the Steps 1–14 engine. Later workflow steps remain responsible for general-purpose scripting/compiler support and the deeper generic systems explicitly scheduled later (for example the full permission/restriction framework, copy rules, attachments, generalized counters/tokens, library operations, and timing framework). Those later systems should extend these mechanic definitions rather than reintroduce card-specific shortcuts.
