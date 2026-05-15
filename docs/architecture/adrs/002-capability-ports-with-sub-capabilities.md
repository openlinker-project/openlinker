# ADR-002: Capability ports with sub-capability composition

- **Status**: Accepted
- **Date**: 2026-01-15
- **Authors**: OpenLinker maintainers (retrospective documentation of decisions made across PRs #328, #337, #359)

## Context

The marketplace adapter contract started as a single `MarketplacePort` interface carrying every operation a marketplace adapter might support: list offers, create offers, update quantities, browse categories, read seller policies, etc. Real adapters had wildly different capability sets — Allegro implements 9 of 10 operations, a hypothetical CSV-export-only adapter would implement 1, and required-vs-optional methods were tracked in prose rather than in the type system.

This made adapter authoring fragile (optional methods became `throw new Error('not supported')` traps), call-site narrowing impossible (TypeScript saw the same interface regardless of what the adapter actually implemented), and unit tests had to mock all 10 methods even to exercise one.

## Decision

Split the legacy mega-port into:
1. A **base port** carrying only methods every adapter must implement (`OfferManagerPort.updateOfferQuantity`).
2. A set of **independent sub-capability interfaces** (`OfferLister`, `OfferCreator`, `OfferFieldUpdater`, `CategoryBrowser`, `OfferStatusReader`, …), each with its own `is{Capability}(adapter)` type-guard predicate.

Adapters declare what they support via `implements OfferManagerPort, OfferLister, OfferCreator, …`. Call sites narrow with the type guard before invoking the optional method — after the guard, TypeScript knows the method is present.

## Alternatives considered

- **Keep a single mega-port with optional methods** — Rejected: TypeScript doesn't let you declare a method "optional but with this signature when present"; you'd write `listOffers?: (...) => Promise<...>` and lose type-safety at the call site (`adapter.listOffers?.(...)` returns `undefined | Promise<...>`). Plus the existing trap of throwing-on-call would persist.
- **Multiple top-level ports per platform (`AllegroOfferLister`, `AllegroOfferCreator`, …)** — Rejected: explodes adapter registration (one factory per port × platform) and makes "all the marketplace adapters" queries via the integration registry require querying many ports.
- **Runtime capability discovery via a metadata object** — Rejected: works but pushes type-safety to the boundary; we'd lose IDE autocomplete and `tsc` checking of method shapes.

## Consequences

**Pros:**
- Type-safe narrowing: `if (isOfferCreator(adapter)) { adapter.createOffer(cmd); }` — TypeScript knows the method is present.
- Tests mock only the capabilities the call site uses.
- Adding a new optional capability is one new `*.capability.ts` file with co-located guard, no breaking change to existing adapters.
- Per-adapter feature surface is visible at `implements ...` and discoverable via static analysis.

**Cons / trade-offs:**
- More files: one `*.capability.ts` per sub-capability under `domain/ports/capabilities/`.
- Adapter `implements` lines get long for fully-featured platforms (Allegro lists 9 sub-capabilities).
- Capability discovery in code is by structural type, not a runtime registry — callers must know which guard to use.

## References

- Primary doc: [docs/architecture-overview.md](../../architecture-overview.md) § OfferManagerPort.
- File-naming standard: [docs/engineering-standards.md](../../engineering-standards.md) § Port sub-capabilities.
- Related ADRs: [ADR-001](./001-hexagonal-architecture-and-bounded-contexts.md) (the parent hexagonal model), [ADR-003](./003-plugin-sdk-trust-model.md) (how plugins declare capabilities).
- Related PRs: #328 (split out of legacy `MarketplacePort`), #337/#359 (sub-capability pattern).
