# Step 34 — Pairwise and Cross-System Interaction Tests

Step 34 verifies that rules subsystems which pass in isolation still compose correctly when they meet at the same rules boundary. The dedicated interaction suite is intentionally behavioral: it asserts final authoritative state and, where ordering is rules-relevant, the intermediate ordering/relationship that produced that state.

## Interaction matrix

The required matrix covers targeting versus hexproof, protection versus damage and attachments, indestructible versus destroy, commander movement versus replacement timing, token/counter doubling through replacement effects, trample plus deathtouch, first strike plus double strike, copy plus layers, ability removal plus derived/static characteristics, control changes plus attachment and commander identity/ownership, and multiplayer trigger/elimination behavior.

`scripts/check-step34-interaction-matrix.mjs` guards the required pair list and writes machine-readable and Markdown status under `coverage/`. `npm run test:step34` executes the behavioral suite.

## Event/order assertions

The suite checks rules-sensitive ordering rather than only end-state snapshots. Commander-to-hand/library movement pauses before the zone mutation for the replacement choice, while graveyard/exile movement happens first and the commander choice follows at the state-based-action boundary. Multiplayer simultaneous triggers are verified in rotated APNAP stack order. Token/counter doubling is verified through the replacement pipeline rather than direct collection manipulation.

## Multiplayer coverage

The dedicated four-player trigger case verifies APNAP order in an actual four-player engine state. Player elimination coverage verifies that owned objects leave the game and an eliminated player does not retain priority. Existing Step 14 multiplayer tests remain the deeper companion regression suite.

## Strict/verbose execution

Step 42 is the workflow stage that introduces the formal strict-rules release mode. Until that mode exists, Step 34 runs against the authoritative engine with the same legality/event/replacement/SBA paths and can use Step 31 verbose tracing for diagnostics. Once Step 42 lands, this suite is intended to be included unchanged in the strict-mode release gate.

## CI gate

`.github/workflows/cross-system-interactions.yml` runs architecture checks, the Step 33 primitive contracts, the Step 34 matrix checker, the Step 34 behavioral suite, and the high-value trigger/combat/commander/attachment/layer regression suites. Any new confirmed interaction bug should first become a failing Step 34 (or later judge-scenario) regression before the production fix is accepted.
