# Phase 34 — Commander edge cases

Phase 34 hardens the Commander-specific rules boundary before the full-catalog census.

## Verified behavior

- Commander designation persists independently of controller and zone changes.
- Commander tax is maintained per designated commander and increases only after casts from the command zone.
- Alternative zones do not increase commander tax; later command-zone casts retain the accumulated ledger.
- Hand/library commander moves use the pre-move command-zone replacement choice.
- Graveyard/exile commander moves occur first and then expose the state-based command-zone choice.
- A commander controlled by another player still routes to its owner for commander-zone decisions.
- Commander combat damage is tracked per persistent commander identity, not per controller or transient object location.
- Only combat damage contributes to the 21-damage loss condition.
- Copies of commanders are not commanders and do not inherit commander-damage identity.
- Legal paired-command relationships and independent tax ledgers remain covered by the existing Step 14 Commander suite.
- Multiplayer player-elimination cleanup and serialization of commander ledgers remain covered by the existing Step 14 suite.

## Verification

Run:

```sh
npm run check:phase34
npm run test:phase34
npm run test:step14
npm run test:step26
```

Phase 35 can now run the complete Oracle/MongoDB catalog through the compiler and classify full-catalog support.
