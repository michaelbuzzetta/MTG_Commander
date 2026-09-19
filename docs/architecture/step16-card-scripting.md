# Step 16 — Card Scripting Language / Declarative Ability Model

Step 16 adds a validated scripting layer under `src/cards/scripts/` so ordinary card behavior can be authored as data and compiled into the authoritative rules primitives implemented in Steps 1–15. The scripting layer does not create a second game engine: compiled triggers, costs, targets, replacement effects, static effects, spell modes, and effect nodes are consumed by the existing engine systems.

## Ability IR

`AbilityIR.js` defines script version 1 and the supported ability kinds:

- `static`
- `activated`
- `triggered`
- `replacement`
- `spell`
- `characteristic`

Card definitions may provide a `script`/`cardScript` object. `CardScriptCompiler` validates that object before game objects are created, then lowers it into the same `abilities`, `spellEffects`, and `modes` structures already used by the stack, trigger, replacement, continuous-effect, targeting, and resolution systems.

## Effect primitive library

`EffectPrimitiveLibrary.js` provides stable declarative names for common effects, including draw/discard/mill, damage, gain/loss of life, destroy/exile/sacrifice, tap/untap, token creation, spell copy/counter, search/reveal/shuffle, zone movement, counters, characteristic modification, ability grant/removal, extra/skip turn structures, and control change.

Leaf primitives lower to existing `EffectEngine` operations whenever an authoritative primitive already exists. Step-16-only orchestration nodes delegate back into engine services for zone, knowledge, continuous-effect, and replacement behavior rather than directly mutating player zone arrays.

## Selector/filter DSL

`SelectorDSL.js` validates and normalizes reusable filters for:

- object kind and zone;
- controller/owner/player relation;
- type/subtype;
- color/colorless;
- mana value ranges;
- legendary status and card names/ids;
- attacking/blocking/tapped/counter state;
- `and`, `or`, and `not` boolean composition.

Target selectors compile into the Step 6 targeting model, so scripted cards receive the same protection, hexproof, ward, target revalidation, and multiplayer relation behavior as hand-authored cards.

## Control flow

The compiler/runtime supports:

- ordered sequences;
- `if` / `otherwise` conditions;
- `forEach` over a selector;
- bounded `repeat`;
- optional `may` choices through the existing generic boolean choice path;
- value expressions such as event fields, source power, selector counts, and script variables.

This is intentionally deterministic and data-oriented. Raw natural-language Oracle text is not executed at runtime; Step 18 is responsible for compiling recognized Oracle templates into this IR.

## Custom hooks

`CustomHookRegistry.js` is the escape hatch for the small class of effects that cannot yet be expressed declaratively. Hooks:

- require a stable id;
- require an explicit version;
- require a registered handler before the card script can compile;
- may carry test ids/metadata;
- fail closed on an unknown hook or version mismatch.

Hooks are not embedded in React/UI code.

## Load-time validation

`ScriptValidator.js` rejects malformed scripts before gameplay. Diagnostics include exact paths such as `script.abilities[0].effect`, and cover unknown ability kinds, primitives, selector fields/zones, impossible target bounds, missing trigger/replacement events, missing activated costs, malformed control-flow nodes, and unregistered custom hooks.

## Current boundary

Step 16 creates the scripting language and execution path; it does **not** claim that all 647 current Oracle identities have been migrated to scripts. That migration/support classification is Step 17. Deep copy rules, generalized library-search semantics, and other later workflow systems remain owned by their scheduled steps; Step 16 exposes stable primitive/script hooks that those later systems can extend without changing card authoring syntax.
