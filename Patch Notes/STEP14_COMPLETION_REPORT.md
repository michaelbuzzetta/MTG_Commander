# Step 14 Completion Report — Commander and Multiplayer Rules

## Status

**COMPLETE — gated Step 14 checkpoint. Release B / Core Rules Correctness is complete. Step 15 has not been started in this archive.**

Step 14 completes Commander identity, per-commander tax and damage, command-zone movement timing, paired-commander validation, multiplayer player relations, and atomic player elimination on top of the Step 1–13 authoritative rules engine.

## Implemented deliverables

### 1. Commander identity and tax ledger

Added `src/engine/multiplayer/CommanderRules.js`. Commander designation is independent of current characteristics/controller and each commander receives a persistent `commanderIdentity`. The service stores one command-zone cast/tax ledger per individual commander. Copies explicitly lose commander designation, while ordinary zone/control changes preserve it.

### 2. Commander damage matrix

Combat commander damage is keyed by the persistent commander identity and defending player. Damage therefore remains associated with the original designated commander after control changes or new zone incarnations, and Step 12's SBA threshold remains per individual commander rather than aggregated.

### 3. Commander movement timing

Hand/library movement uses a pre-move command-zone replacement choice. Graveyard/exile movement completes first and then creates the SBA-era command-zone choice. Both routes preserve commander identity.

### 4. Paired-commander validator

Commander selection now accepts one commander or a legal pair. The validator supports Partner, Partner with, Friends Forever, Choose a Background, Doctor's companion, and future/custom shared pairing tags. Paired decks use the union of both commanders' color identities. Database deck validation now understands this model while preserving legacy `deck.commander` input.

### 5. Player-elimination transaction

Added `src/engine/multiplayer/PlayerEliminationService.js`. Elimination removes owned objects, unwinds control effects, removes stack/effect/trigger registrations tied to departed players/sources, cancels their pending choices, removes queued turn modifiers, and prunes combat references. Life-loss, commander-damage and explicit win paths share the elimination service.

### 6. Multiplayer relation library

Added `src/engine/multiplayer/MultiplayerRelations.js`. The same service now resolves you/controller, opponents/each opponent/target opponent, each player, another player, teammate, active player, defending player, and explicit player ids. Targeting, `TargetFilter`, static effects, continuous effects and replacement filters delegate player relations to this service.

### 7. Public engine queries and serialization

Added immutable public queries for commander-tax ledger, commander-damage matrix and multiplayer relation resolution. Canonical state hydration preserves/migrates commander identity/tax metadata without changing the existing schema version; Step 14 regression coverage verifies round-trip identity, tax and damage state.

## Acceptance criteria

| Workflow criterion | Result |
| --- | --- |
| Four-player Commander games can eliminate players without corrupting state | **PASS** — dedicated atomic-cleanup test plus existing multiplayer simulation regression. |
| Tax and commander damage remain correct after control changes/copies/zone changes | **PASS** — persistent identity, independent tax, copy stripping, movement and damage-control-change tests pass. |
| `each opponent` effects hit the proper set of players | **PASS** — relation service excludes self, teammates and eliminated players and is used by targeting/filter paths. |
| Deck validation understands paired commanders | **PASS** — all required pair families plus union color identity and invalid-pair rejection are tested. |

## Verification

Final verification on this Step 14 working tree:

- **357 / 357 non-stress repository tests passing**
- **10 / 10 Step 14-specific tests passing**
- `npm run check:architecture`: **PASS**
- `npm run check-db`: **PASS — 647 cards / 13 decks**
- `npm run audit:mutations`: completed; inventory refreshed (**313 internal direct mutation paths**) with player-zone mutation boundaries still guarded by the architecture check.

The non-stress suite includes the existing deterministic multiplayer/AI regressions, so the Step 14 changes were exercised against the preexisting 2–4 player behavior as well as the dedicated Commander tests.

## Production-build environment note

`npm run build` was attempted. The container could not reach Scryfall and correctly retained the local 647-card seed. This archive intentionally does not include installed `node_modules`, so the command then stops at `vite build` with `sh: 1: vite: not found`. This is an environment/dependency-install limitation, not a rules-engine test failure; engine tests, architecture validation and database validation are green.

## Release gate

Step 14 completes **Gate 2 — Core Rules Correctness**: triggers, replacements, layers, SBAs and combat are generic; four-player Commander rules are engine-enforced; and the resulting interactions remain observable through the existing event/history diagnostics.

## Next workflow step

Step 15 — **Reusable Mechanic Library** — is the next step and has **not** been started in this checkpoint.
