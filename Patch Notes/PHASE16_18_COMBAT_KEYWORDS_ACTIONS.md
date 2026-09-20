# Steps 16–18 — Combat, Keywords, and Keyword Actions

Oracle compiler version: 3.0.0

This batch extends the generalized rules path rather than adding card-specific handlers.

## Step 16 — Combat interactions
- Added a reusable `fight` effect primitive.
- Fight resolves as simultaneous noncombat damage through the authoritative DamageService.
- Creature power is derived at resolution, so continuous effects feed the damage calculation.
- Added exact Oracle compilation for “Two target creatures fight each other.” with exactly two creature targets.
- Existing combat engine continues to provide flying/reach, menace, vigilance, first/double strike, trample, deathtouch lethal assignment, landwalk, fear, intimidate, horsemanship, shadow, attack requirements, blocker requirements, and multiplayer defending entities.

## Step 17 — Evergreen keyword behavior
- Preserved the existing mechanic-registry architecture as the authoritative keyword semantics layer.
- New effects reuse DamageService, targeting, continuous characteristics, and state-based actions instead of duplicating keyword rules.
- Fight therefore correctly participates in damage properties such as deathtouch, lifelink, infect/wither and prevention through the shared damage pipeline where those mechanics apply to noncombat damage.

## Step 18 — Keyword actions
- Added reusable `scry` and `surveil` effect primitives.
- Added exact high-confidence Oracle templates for `Scry 1.` and `Surveil 1.`.
- Surveil uses the hidden-information LibraryOperationService and now has legal-action, validation, resolution, ChoiceService, and UI choice support.
- Scry continues through its existing authoritative choice path.
- Multi-card surveil remains fail-closed until ordered multi-card hidden-information choices are generalized; it is not approximated.

## Validation
- Regenerated Oracle compiler artifacts for all 647 curated cards.
- Current census: 17 exact high-confidence, 630 review-required, 186 high-priority template queue.
- Focused Oracle compiler + card scripting suite: 52/52 passed.
- Production Vite build could not run in this extracted checkpoint because `node_modules` is intentionally absent from packaged checkpoints (`vite: not found`). The prebuild catalog refresh also correctly fell back to the local seed because network access was unavailable.
