# Step 28 — Timing Restrictions and Activation/Casting Windows

Status: **COMPLETE**

## Objective

Make timing legality an authoritative engine rule for every supported spell, activated ability, mana ability, land play, and special action. UI and AI callers receive only actions the engine currently considers legal; visual disabled states are never the enforcement boundary.

## Architecture

Step 28 adds `src/engine/timing/`:

- `TimingTypes.js` — timing speed/action constants plus structured `TimingError`.
- `TimingPermission.js` — normalization for string/object timing declarations.
- `TimingService.js` — authoritative predicate evaluation, usage scopes, diagnostics, serialization-facing snapshots, and action recording.
- `index.js` — public timing exports.

`GameEngine.validateAction()` now sends normal priority-window actions through `TimingService` after Step 21 permission/restriction checks and before costs/state mutation. Existing action-specific validators continue to check source, zone, target, and payment legality, while timing decisions are delegated to the shared timing layer.

## Supported timing predicates

`TimingPermission` supports:

- instant timing / flash-equivalent timing;
- sorcery timing;
- special-action timing;
- mana-ability manual timing;
- priority required or explicitly not required;
- only during your turn;
- combat-only timing;
- exact step(s);
- exact phase-group(s);
- before a specified step;
- after a specified step;
- once per turn / max uses per turn;
- once per combat / max uses per combat;
- not used since a specified turn step;
- custom declarative script conditions.

Repeated/extra-combat turn sequences are handled by resolving before/after boundaries relative to the current occurrence rather than assuming there is only one combat in a turn.

## Default spell timing

- Instant cards default to instant timing.
- Non-Instant spells default to sorcery timing.
- Sorcery timing requires all of:
  - the acting player has priority;
  - the acting player is the active player;
  - the current step is a precombat or postcombat main phase;
  - the stack is empty.
- Existing flash/as-though-flash permissions from casting permissions, Step 21 legality rules, static effects, and mechanic hooks are consumed by the timing service.
- Modal spell timing declarations are preserved and evaluated by the same service.

## Ability timing

- Ordinary activated abilities default to instant timing.
- Legacy `sorcerySpeed: true` remains supported and is normalized into the shared timing behavior.
- Mana abilities submitted as player actions require priority, but still bypass the stack. Internal mana payment remains handled by the cost/payment subsystem and is not forced through a stack action.
- Declarative scripted abilities may provide rich `timing` objects; the compiler preserves them instead of lowering only a boolean sorcery-speed flag.

## Special actions

Step 28 makes supported special actions explicit instead of treating all of them as sorcery-speed actions:

- **Play a land:** requires priority, active-player main phase, and empty stack.
- **Foretell:** requires priority and your turn, but does **not** require a main phase or empty stack. It remains a special action and never uses the stack.
- **Encore:** uses sorcery timing.
- **Pass priority / loop shortcut:** require the acting player to hold priority.

This also corrects the previous Foretell implementation, which incorrectly limited Foretell to sorcery timing.

## Usage counters

Timing usage is stored in canonical `GameState` as `timingUsage`. Records include:

- turn and phase;
- phase index;
- combat identity;
- player;
- action type;
- source object identity;
- ability identity/fingerprint;
- timing usage key;
- normalized permission metadata.

Per-object once-per-turn and once-per-combat restrictions therefore survive state serialization/restoration and correctly reset when their scope changes. Extra combats receive distinct combat identities.

## Script/compiler integration

`CardScriptCompiler` now preserves timing data for:

- activated abilities;
- spell abilities when a script supplies card-level timing;
- scripted spell modes.

`ScriptValidator` rejects unknown timing speeds/fields and validates timing conditions before gameplay. Rich timing declarations therefore remain fail-closed like the rest of the Step 16 scripting layer.

## Legal-action generation

`LegalActions` already probes candidates through `GameEngine.isActionLegal()`. Because timing is now part of that authoritative validation path:

- a Sorcery does not appear during upkeep without a permission;
- an Instant can appear whenever its controller has priority;
- exhausted once-per-turn/per-combat abilities disappear from the legal-action list;
- AI and human UI consume the same timing-correct options.

No client-side disabled button or AI heuristic is required to enforce these rules.

## Public diagnostics

The GameEngine public API now exposes:

- `getTimingSnapshot()`
- `getTimingDiagnostics()`

Replay serialization also includes the timing snapshot so timing usage and denial context can be inspected alongside legality, loops, events, and turn state.

## Canonical-state integration

The canonical state schema now contains:

- `timingUsage: []`
- `timingDiagnostics: []`

Hydration supplies defaults for older snapshots, validation checks both arrays, and `restoreState()` rebinds/ensures the timing state.

## Verification

Dedicated Step 28 coverage verifies:

1. Instant vs. sorcery default cast windows.
2. Priority requirements for casts and activations.
3. Flash-style timing permissions.
4. Instant/default and sorcery-speed activated abilities.
5. Foretell as a true special action during the player's turn.
6. Land-play timing and empty-stack requirement.
7. Combat-only, exact-step, before-step, and after-step predicates.
8. Once-per-turn usage.
9. Once-per-combat usage across an extra combat.
10. Not-used-since-step restrictions.
11. Custom script timing conditions.
12. Timing-filtered legal-action generation.
13. Canonical serialization/restoration of timing usage.
14. Compiler preservation and validator rejection of invalid timing declarations.

Commands:

```bash
npm run test:step28
node --test tests/step*.test.js
npm run check:architecture
npm run check-db
npm run check-support
npm run check-oracle-templates
```

## Acceptance status

- Sorceries cannot be cast at instant speed without a valid permission: **PASS**.
- Special actions operate under their own timing rules without being forced onto the stack: **PASS**.
- Once-per-turn/per-combat and related timing usage restrictions reset at correct scopes: **PASS**.
- UI/AI legal-action lists are timing-authoritative: **PASS**.

## Next workflow step

**Step 29 — AI Migration to Authoritative Legal Actions.**
