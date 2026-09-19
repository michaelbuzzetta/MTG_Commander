# Step 14 — Commander and Multiplayer Rules

Step 14 completes the Commander-specific and multiplayer rules layer on top of the authoritative turn, stack, choice, cost, zone, trigger, replacement, continuous-effect, SBA, and combat systems from Steps 1–13.

## Persistent commander identity

Commander designation is stored independently of printed or derived card characteristics. Each designated commander receives a persistent `commanderIdentity` when game state is created. The identity survives controller changes and ordinary zone changes, while spell copies explicitly do **not** inherit commander designation.

The player state also records the designated commander card ids and commander identities so serialization/restoration and later per-commander ledgers do not depend on the commander's current zone or controller.

## Commander tax ledger

`CommanderRulesService` owns a per-player, per-commander tax ledger. Each entry records:

- persistent commander identity;
- Oracle/runtime card id;
- number of casts from the command zone;
- current additional commander tax.

Only a cast from the command zone increments that commander's ledger, and each prior command-zone cast adds `{2}`. Legal paired commanders therefore accumulate tax independently. The old single scalar `commanderTax` is retained only as a compatibility view for legacy single-commander saves/tests.

## Commander movement

The existing zone engine now participates in the current Commander movement timing model:

- moving a commander to **hand or library** opens a command-zone replacement choice before the move occurs;
- a commander that moves to **graveyard or exile** first completes that zone change, then an SBA window offers its owner the command-zone choice;
- the persistent commander identity survives either route.

## Commander damage matrix

Combat damage from a designated commander is recorded by `commanderIdentity`, not by controller, object incarnation, or card name. Each defending player therefore has a separate damage total for every individual commander. Control changes do not transfer or merge commander-damage identity, and the Step 12 SBA engine evaluates the 21-damage loss threshold per commander.

## Paired commanders and deck validation

`validateCommanderSelection` and `validateCommanderPair` provide data-driven validation for one commander or a legal pair. Supported pair families are:

- Partner;
- Partner with;
- Friends Forever;
- Choose a Background;
- Doctor's companion;
- future/custom pairing families expressed through shared data tags.

The combined color identity of both designated commanders is used for deck validation and game-state initialization. Backgrounds may be designated through Choose a Background even though they are not creatures.

## Player elimination transaction

`PlayerEliminationService` performs multiplayer elimination as one rules transaction. It:

- marks the player lost and records the reason;
- removes all game objects owned by the eliminated player;
- ends known control-changing effects involving that player and restores a surviving prior controller when possible;
- removes surviving-owned objects that would otherwise remain illegally controlled by the departed player;
- removes stack objects, pending triggers, registered effects, continuous effects, replacement/prevention effects, and pending choices belonging to that player or departed sources;
- removes that player from queued extra turns and turn modifiers;
- removes stale combat attackers, targets, defending entities, blockers, damage assignments, defending-player queues, and current-defender references;
- leaves the stable player-order identity list intact while all live turn/priority traversal skips eliminated players.

This cleanup path is shared by life loss, commander-damage SBAs, and explicit win effects rather than allowing ad hoc `lost = true` mutations.

## Multiplayer relation library

`MultiplayerRelationService` is the shared source for multiplayer predicates. It resolves:

- you / self / controller;
- opponent / each opponent / target opponent;
- each player / all players;
- another player;
- teammate (for optional team-aware states);
- active player;
- defending player;
- explicit player ids.

Targeting, composable target filters, static-effect filters, continuous-effect filters, and replacement filters use the same relation service, ensuring human/AI legality sees the same living-player sets.

## Public queries

- `GameEngine.getCommanderTaxLedgerSnapshot(playerId)`
- `GameEngine.getCommanderDamageMatrixSnapshot()`
- `GameEngine.getMultiplayerRelationSnapshot(relation, actorPlayerId, context)`

All return snapshots rather than mutable authoritative state.

## Verification

Dedicated coverage is in `tests/step14-commander-multiplayer.test.js`. It verifies persistent identity/copy behavior, independent tax ledgers, command-zone movement timing, commander damage after control changes, all required paired-commander families, combined pair color identity, atomic four-player elimination cleanup, multiplayer relation predicates, targeting integration, and serialization/restoration of commander identity/tax/damage.
