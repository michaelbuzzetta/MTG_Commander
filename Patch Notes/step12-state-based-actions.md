# Step 12 — State-Based Actions

Step 12 centralizes game stabilization in `src/engine/sba/StateBasedActionEngine.js`.

## Stabilization loop

The engine collects all currently applicable state-based actions before committing a batch, commits that batch while triggers are deferred, then repeats until no state-based action remains. Rules choices such as the legend rule are opened only after automatic actions stabilize.

## Implemented checks

- player loss at 0 or less life;
- 10 or more poison counters;
- attempted draw from an empty library;
- 21 or more combat damage from one commander identity;
- creature toughness 0 or less;
- lethal marked damage;
- deathtouch damage;
- indestructible interaction (does not prevent the 0-toughness SBA);
- +1/+1 and -1/-1 counter cancellation;
- legend-rule choice using derived characteristics;
- token ceasing outside the battlefield;
- illegal Aura cleanup and Equipment/Fortification detachment;
- planeswalker loyalty and battle defense reaching zero when those counters are represented;
- completed Saga cleanup hooks.

Every automatic batch is recorded as `SBA_BATCH` in the engine history for judge/debug inspection.

## Tests

`tests/step12-state-based-actions.test.js` covers simultaneous lethal creatures, counter cancellation, each major player-loss condition, indestructible/zero toughness, legend choice, token cleanup, and illegal Equipment attachment cleanup.
