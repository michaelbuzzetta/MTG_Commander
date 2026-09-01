# Category 7 Implementation Notes

## Scope

This update implements **Category 7: Triggered, Static, and Replacement Abilities** only. It resolves **BUG-030, BUG-031, BUG-032, BUG-033, BUG-034, and BUG-043** from the repair plan. Category 8 explore/token-mechanics work is intentionally not included beyond the minimum continuation plumbing needed so Category 7 choices do not discard queued effects.

## Trigger framework — BUG-030, BUG-031, BUG-032

- Trigger matching is now **source-aware**. Trigger conditions can use `sourceEvent` / `selfEvent` to require the event object to be the permanent that owns the trigger.
- River Herald Scout, Pest Summoner, and the current Prosperous Pirate definition now use source-aware ETB matching. Unrelated permanents entering no longer fire their self-ETB abilities, and Pest Summoner no longer recursively retriggers from its own Pest tokens.
- Trigger collection now incorporates **last-known information** carried by Category 5 leave/dies events. A permanent's own dies/LTB ability can be collected after that permanent has already left the battlefield.
- Each emitted event creates a trigger batch. Simultaneous triggers are processed using **APNAP**: active-player triggers are put on the stack first, followed by nonactive-player triggers.
- When one controller has multiple simultaneous triggers, the engine creates a `TRIGGER_ORDER` decision and requires that controller to choose their stack order.
- Optional triggers now create an `OPTIONAL_TRIGGER` decision. The controller can explicitly accept or decline the trigger instead of optional triggers being forced onto the stack.
- AI and UI both consume the same validated trigger-choice actions.

## Static-effect filters — BUG-033

- `StaticEngine` now evaluates static sources across the battlefield and applies explicit reusable filters for controller relationship, type, subtype, source exclusion (`notSelf` / `other`), zone, and card ID.
- Merfolk Mistbinder is now encoded as affecting **other Merfolk you control**. It remains 2/2 by itself, buffs another friendly Merfolk, and does not buff an opposing Merfolk.

## Proliferate — BUG-034

- Proliferate is now a first-class `PROLIFERATE` decision rather than an automatic board-wide mutation.
- The controller can choose **any number**, including zero, of eligible permanents and players that already have counters.
- Only selected objects/players receive one additional counter of each kind they already have.
- Player counter storage was added to the game state so proliferate can operate on player counters as well as permanent counters.
- UI battlefield selection and player buttons expose the proliferate choice; AI selects eligible objects it controls rather than automatically helping the opponent.

## Counter replacement effects — BUG-043

- Counter-replacement applicability is centralized in `ReplacementEngine`.
- Hardened Scales and Branching Evolution now explicitly apply only to **+1/+1 counters on creatures you control**.
- Doubling Season's counter replacement is restricted to permanents its controller controls.
- When multiple counter replacement effects apply, the affected permanent's controller receives a `REPLACEMENT_ORDER` decision instead of battlefield iteration silently choosing the result.
- The chosen replacement order is applied sequentially. This correctly distinguishes, for example, Branching Evolution then Hardened Scales (1 -> 2 -> 3) from Hardened Scales then Branching Evolution (1 -> 2 -> 4).
- Deferred counter/proliferate/explore queues resume after replacement or trigger decisions so a rules choice does not silently drop remaining effect work.

## New validated choice actions

- `CHOOSE_TRIGGER`
- `ORDER_TRIGGERS`
- `CHOOSE_PROLIFERATE`
- `ORDER_REPLACEMENTS`

These actions pass through `GameEngine.validateAction()` / `perform()` like the earlier mulligan, combat-order, legend, commander-zone, and ward choices.

## Regression coverage

Added `tests/category7.test.js` and `tests/category7-ui.test.js`, including regressions for:

- self-ETB source matching;
- Pest Summoner recursion prevention;
- dies/LTB last-known information;
- optional trigger acceptance/decline;
- simultaneous trigger controller ordering and APNAP;
- Merfolk Mistbinder source exclusion/controller filtering;
- selective proliferate on permanents and players;
- Hardened Scales / Branching Evolution applicability and user-selected replacement order;
- UI controls for all new Category 7 decision types.

Existing counter-replacement and Evolution Sage synergy tests were deliberately updated because they previously asserted the old automatic-order / automatic-proliferate behavior.

## Verification

- `npm run build-db`: **PASS** — generated runtime data rebuilt from the authoritative source schema.
- `npm run check-db`: **PASS** — 44 cards and 6 decks validated.
- `npm test`: **PASS** — 99 tests passed, 0 failed after Category 7 integration.
- `node --check` on modified non-JSX engine/AI modules: **PASS**.
- `npm run build`: the uploaded archive did not contain `node_modules`, so Vite was initially unavailable. An attempted `npm ci` could not complete in the sandbox before the environment timeout. Production Vite bundling should therefore be rerun with `npm ci && npm run build` in a normal network-enabled development environment.
