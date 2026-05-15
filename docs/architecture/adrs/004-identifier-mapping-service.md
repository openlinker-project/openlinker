# ADR-004: Identifier mapping as core service with single internal-ID seed

- **Status**: Accepted
- **Date**: 2024-11 (approx — predates current git history)
- **Authors**: OpenLinker maintainers (retrospective documentation)

## Context

Every entity in OpenLinker (Product, ProductVariant, Order, Offer, Customer, …) has at least two identities: the external platform's ID (PrestaShop's `id_product=42`, Allegro's `offerId=12345`) and an internal OpenLinker ID. Cross-platform synchronization needs to know "Allegro offer X corresponds to the same product as PrestaShop product Y" — without a canonical internal identity, every adapter pair would maintain its own mapping table and cross-platform queries would be N×M joins.

The system supports **multiple connections per platform type** (two PrestaShop stores, three Allegro accounts), so the mapping is per-connection, not per-platform.

## Decision

Introduce a single **`IdentifierMappingService`** in core (`libs/core/src/identifier-mapping/`) that owns the bidirectional mapping between `(entityType, externalId, connectionId)` and a single internal ID. Internal IDs are generated from one unified seed and follow the format `ol_{prefix}_{uuid}` (e.g. `ol_product_fce2df4d…`, `ol_order_xyz789`). Adapters call `getOrCreateInternalId(entityType, externalId, connectionId)` and replace external IDs with internal IDs before handing data to core services.

Core domain logic operates on internal IDs only. External IDs are looked up via `getExternalIds(internalId)` when adapters need to talk to the source platform.

## Alternatives considered

- **Per-platform mapping tables (no central service)** — Rejected: forces every adapter to implement mapping; duplicated code, inconsistent uniqueness guarantees, and no single source of truth for "is this entity already mapped?"
- **Use platform IDs directly + a composite key `(platformType, externalId)`** — Rejected: composite keys ripple through every domain entity and every API surface, and there's no clean answer for "Allegro offer ↔ PrestaShop product" cross-platform references. Internal IDs collapse the problem.
- **UUIDs without entity-type prefix** — Rejected: prefixes (`ol_product_`, `ol_order_`) are observable in logs and DB rows, making debugging and incident response materially faster. The trade-off is a few bytes per ID.

## Consequences

**Pros:**
- Domain logic is platform-agnostic; services never see external IDs.
- Cross-platform queries (Allegro offer → product → PrestaShop variants) are clean joins on internal IDs.
- Adding a new platform doesn't change identity shape; the adapter just calls into the service.
- Identifier-prefix readability (`ol_order_…`) speeds up log inspection.

**Cons / trade-offs:**
- Every adapter operation that crosses the platform boundary adds a mapping lookup (read or get-or-create). Hot paths use batch lookups (`batchGetOrCreateInternalIds`) to amortize.
- Identity-resolution bugs in the service (concurrent get-or-create) became race-condition-prone — see #97 for the unique-constraint fix that resolved this.
- Mapping table grows linearly with entities × connections; today it's well within Postgres comfort range, but a future tenant with millions of products × multiple connections would warrant a partitioning strategy.

## References

- Primary doc: [docs/architecture-overview.md](../../architecture-overview.md) § Identifier Mapping Service.
- Related ADRs: [ADR-001](./001-hexagonal-architecture-and-bounded-contexts.md) (the core service shape this fits).
- Related issues: #97 (concurrency fix), #322 (ProductVariant entity-type).
