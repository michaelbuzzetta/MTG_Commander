# Phase 11 — Conditional Logic and Intervening-If

Oracle parser version: 2.3.0

This phase adds reusable condition predicates for controller/opponent battlefield control checks, declarative conditional spell effects, and explicit intervening-if preservation through Oracle AST -> Ability IR -> trigger runtime.

Implemented exact families include simple Instant/Sorcery clauses of the form `If you control a/an <type or subtype>, draw N cards / gain N life`, corresponding opponent-control gates, ETB intervening-if triggers, upkeep intervening-if triggers, and self-attack intervening-if triggers. Type and subtype conditions are represented as generic predicates rather than card-specific handlers.

Intervening-if conditions are stored separately from ordinary trigger matching conditions so TriggerEngine can check them both when the ability would trigger and again when it resolves. CardScriptRuntime can evaluate the same controller/opponent control predicates for resolving conditional effects.

Fail-closed policy remains in force. Complex `if you do`, `unless`, conditional payment, and unsupported compound clauses are not guessed by this phase and remain review-required until their choice/payment continuation semantics are implemented.

Validation: Oracle/compiler + scripting + trigger focused suites pass 61/61 tests. Current curated compiler artifact: 647 cards, 17 exact high-confidence, 630 review-required.
