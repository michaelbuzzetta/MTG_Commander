# Step 13 — Complete Combat Engine

Step 13 expands `CombatEngine` so attacker/blocker legality, defending entities, requirements, restrictions, and combat damage all remain authoritative engine decisions.

## Defending entities

Attacks may target:

- players;
- planeswalkers;
- battles with a defending/protecting player.

The combat state records both the attacked entity and the associated defending player, preserving multiplayer blocker ownership and priority flow. Combat damage to planeswalkers/battles is routed through the generic damage event and updates loyalty/defense counters.

## Attack legality

The declaration solver supports:

- summoning sickness and haste;
- vigilance;
- defender/cannot-attack restrictions;
- must attack;
- must attack a specific player/entity;
- goad and maximum satisfiable attack requirements;
- cannot attack alone;
- target-specific attack restrictions;
- generic attack-cost/tax hooks.

## Blocking legality

The blocker solver supports:

- flying/reach;
- menace;
- fear;
- intimidate;
- shadow;
- horsemanship;
- unblockable restrictions;
- landwalk behavior already supported by the project;
- must block / must block a specific attacker;
- attacker must be blocked if able;
- creatures that may block additional attackers;
- cannot be blocked by more than one creature.

## Damage assignment and timing

Existing Step 4 combat windows are preserved: beginning of combat, after attackers, after blockers, first-strike damage when needed, normal damage, and end of combat. Multiple-blocker damage order is chosen by the attacking player. First strike, double strike, trample, deathtouch, lifelink, and commander combat damage continue to use the generic damage/event/SBA pipeline.

## Public queries

- `GameEngine.getLegalAttackers(playerId)`
- `GameEngine.getLegalDefendingEntities(playerId)`
- `GameEngine.getLegalBlockers(playerId, attackerRef)`
- `GameEngine.canBlock(blockerRef, attackerRef)`
- `GameEngine.validateBlockers(playerId, map)`

## Tests

`tests/step13-combat-engine.test.js` covers planeswalker attacks, goad, cannot-attack-alone, fear/intimidate/shadow/horsemanship, extra block capacity, must-block requirements, and commander damage identity. Existing `tests/combat.test.js` continues to cover first strike, double strike, trample, deathtouch, menace, vigilance, blocker damage order, and priority windows.
