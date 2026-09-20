# Phases 13–15 — Choices, Targeting, and Trigger Expansion

Oracle parser version: **2.7.0**

## Phase 13 — Modal choices
- Oracle AST now preserves card-level `modes` into Card Script IR.
- Added exact compilation for simple `Choose one —` spells with 2–4 supported modes.
- Added exact `Choose one or both —` support for untargeted supported branches by exposing the two single choices plus the combined mode.
- Mode selection continues through the existing spell-mode/stack pipeline, so the selected mode is locked when the spell is cast.
- Complex modal text, targeted `one or both`, and unsupported branches remain review-required.

## Phase 14 — Advanced targeting
- Added exact `up to one target` compilation for supported destroy/exile spell families.
- Target bounds are preserved as 0–1 through Ability IR and the existing TargetingEngine.
- Expanded reusable target parsing for player/opponent relations and `creature you don't control`.
- Existing generic choice/target infrastructure continues to enforce legality and revalidation.

## Phase 15 — Advanced trigger families
- Added generic opponent-cast trigger conditions.
- Added `another creature enters under your control` trigger compilation using controller/type/not-self predicates.
- Trigger matching now understands `eventController: opponent` through multiplayer opponent relations.
- These abilities continue through TriggerRegistry/TriggerMatcher/PendingTriggerQueue and the normal stack.

## Safety policy
Unsupported or ambiguous Oracle constructs still fail closed to `review_required`; no partial text is executed.
