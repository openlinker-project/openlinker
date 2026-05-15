# ADR-001: Hexagonal architecture and bounded contexts

- **Status**: Accepted
- **Date**: 2024-10-01
- **Authors**: OpenLinker maintainers (retrospective documentation)

## Context

OpenLinker orchestrates commerce data across many third-party platforms (PrestaShop, Allegro, future Shopify / WooCommerce / etc.). Each platform has its own API shape, authentication model, rate-limit behavior, and domain quirks. Early prototypes coupled business logic directly to PrestaShop client code; this made the system simultaneously hard to test (real HTTP everywhere) and hard to extend (adding Allegro meant duplicating the orchestration layer).

We needed an architectural shape that lets the core orchestration logic ignore platform specifics, while keeping a clear seam for platform-specific code to plug in.

## Decision

Adopt **Hexagonal Architecture** (Ports and Adapters) organized by **bounded context**. The core domain (`libs/core/src/`) defines capability ports (`ProductMasterPort`, `InventoryMasterPort`, `OrderProcessorManagerPort`, etc.). Integration packages (`libs/integrations/<platform>/`) implement those ports per platform. The boundary is strict: core never imports from integrations, integrations never define domain logic.

Within `libs/core/src/`, each bounded context (products, inventory, orders, listings, customers, …) is a separate hexagonal cell with `domain/` / `application/` / `infrastructure/` / `interfaces/` layers.

## Alternatives considered

- **Layered MVC (Controller → Service → Repository)** — Rejected: doesn't give us the platform-agnostic seam we need. Adding a new marketplace would mean parallel service hierarchies, not a single port + new adapter.
- **Vertical slices (feature folders, no shared kernel)** — Rejected: works well for single-platform CRUD apps but doesn't scale to the multi-platform orchestration problem. We'd duplicate identifier mapping, retry logic, and sync orchestration per platform.
- **Event-driven-only (events between platforms, no shared abstractions)** — Rejected: events are the right shape for inter-context communication but the wrong shape for "fetch this product from platform X." Synchronous port calls cleanly express the dependency; events would force pseudo-RPC patterns over an event bus.

## Consequences

**Pros:**
- Core domain logic is platform-agnostic and unit-testable without HTTP mocks.
- Adding a new platform is implementing existing port interfaces, not modifying core.
- Strict CORE ↔ Integration boundary enforced by package structure and ESLint (see `docs/engineering-standards.md § Import Aliases`).

**Cons / trade-offs:**
- Higher up-front structural cost: even a one-method platform feature needs a port + adapter + module wiring.
- Bounded-context split has overhead — cross-context calls go through service interfaces (cleanup tracked in #722).
- New contributors face a steep learning curve before their first PR. Mitigated by the plugin author guide.

## References

- Primary doc: [docs/architecture-overview.md](../../architecture-overview.md) § High-Level Architecture and § Hexagonal Architecture Structure.
- Plugin author guide: [docs/plugin-author-guide.md](../../plugin-author-guide.md).
- Related ADRs: [ADR-002](./002-capability-ports-with-sub-capabilities.md) (how capability ports compose), [ADR-004](./004-identifier-mapping-service.md) (the cross-context identity seam).
