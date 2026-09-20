# MongoDB Ability System — Phase 9

Oracle parser version: 2.1.0

This phase expands the generalized Oracle/card-script system for zone-change interactions. Added exact compiler families and runtime primitives for reanimation from any graveyard, graveyard-to-hand recursion, dies/self-return triggers, blink/flicker, and linked temporary exile ("until this permanent leaves the battlefield"). Triggered Ability IR now preserves explicit nonbattlefield `sourceZones`, allowing dies triggers to resolve from LKI/zone-change state rather than relying on battlefield presence.

Runtime changes remain routed through the authoritative zone/event engine. Blink performs exile followed by battlefield return as distinct zone changes. Linked temporary exile stores the exact exiled object identity on the source and returns only that linked object when the source leaves. Symbolic move destinations (`owner` / `controller`) are resolved at runtime.

Validation: focused compiler/card-script/zone/LKI/trigger suites passed 70/70. A full `npm test` run was started but exceeded the execution environment's 120-second command limit, so this package does not claim a complete all-suite pass.
