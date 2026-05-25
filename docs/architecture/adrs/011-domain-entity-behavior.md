# ADR-011: Domain entity behavior — anemic-by-default with pure read-only derivations

- **Status**: Accepted
- **Date**: 2026-05-25
- **Authors**: @piotrswierzy

## Context

Every domain entity in `libs/core/src/**/domain/entities/` is effectively anemic: `readonly` fields set in a constructor, reconstructed from DB rows via a repository `toDomain()`, with state changed only through explicit repository calls (`updateStatus`, `incrementCounters`). There is no unit-of-work, identity map, dirty tracking, or optimistic-concurrency versioning. Domain invariants therefore live in application services — the bulk-batch terminal rule, for instance, is duplicated across two listings services.

The codebase committed to anemic implicitly (the gap surfaced while planning #734), yet has already drifted: 4 entities carry *pure read-only* behavior (`RefreshToken.isActive`, `PasswordResetToken.isUsable`, `ProductContentField.hasPendingDraft`, `AllegroQuantityCommand.create`), while the documented `domain-services/` and `value-objects/` conventions sit unused. One rich entity among anemic ones is worse than either extreme, so the choice is made codebase-wide.

## Decision

Adopt **anemic-by-default plus a bounded allowance for pure read-only behavior** ("Option C").

A domain entity MAY expose:

- instance getters/methods that are **pure synchronous functions of its own already-loaded fields** — no `async`/`Promise`, no parameters except scalars or `Date now`, no I/O, no repository/port/service access, no reach into sibling aggregates, no imports beyond the entity's own `*.types.ts`;
- **pure static factories** that only call the constructor.

A domain entity MUST NOT carry state-mutation methods, `async` behavior, cross-aggregate logic, or event emission — those stay in application services. Behavior that exceeds a field derivation but spans entities belongs in a domain service (the convention exists but is not yet instantiated).

Deferred: return-new-instance transformations, and always-valid validating constructors (OL keeps validate-at-boundary via DTOs). `Product`/`ProductVariant` stay structural `interface`s, so "default" is not "universal."

## Alternatives considered

- **A — uniform anemic.** Rejected: not the status quo — it must delete or grandfather the 4 existing members (the incoherent mix this issue set out to avoid), and leaves real cross-service duplication permanently in place, with no domain-service layer to absorb it.
- **B — rich aggregates (Vernon-style).** Rejected on feasibility, not taste: rich aggregates presuppose mutate-in-place + unit-of-work + identity map + optimistic concurrency, none of which OL has. B fights `readonly` immutability and publishes *behavior* across the cross-context/plugin contract. The literature reserves rich models for rule-heavy domains; an orchestration/sync platform is not one.

## Consequences

**Pros:**

- Lightest rung that fits an immutable + data-mapper, orchestration-shaped system; immutable models carry richness as pure functions, not setters.
- Removes concrete duplication; pure derivations are trivially unit-testable and safe to publish cross-context.
- Ratifies the 4 existing members instead of grandfathering incoherence.

**Cons / trade-offs:**

- Read-only query methods are a Tell-Don't-Ask *compromise* that can mask a model which should grow richer — mitigated by the mechanical bright line above (ideally a lint guard, fast-follow).
- Callers must be *rewired* to new derivations — a getter nobody calls is dead weight (cf. the unused `ProductContentField.hasPendingDraft`).

**Migration path:**

- Opportunistic, not a big-bang epic. Bless the 4 existing members. First worked example: move the bulk-batch completion (`isComplete`) and terminal-status (`terminalStatus`) rules onto `BulkOfferCreationBatch`, rewire both services, and update the entity's header comment (which hard-codes Option A). Remaining entities accrete derivations per-PR.

## References

- Related issues: #750, #734, #712
- Related ADRs: [ADR-001](./001-hexagonal-architecture-and-bounded-contexts.md)
- Primary doc sections: [docs/architecture-overview.md](../../architecture-overview.md) § Hexagonal Architecture Structure; [docs/engineering-standards.md](../../engineering-standards.md) § Domain Layer Independence
- Background: Martin Fowler, *AnemicDomainModel* (https://martinfowler.com/bliki/AnemicDomainModel.html)
