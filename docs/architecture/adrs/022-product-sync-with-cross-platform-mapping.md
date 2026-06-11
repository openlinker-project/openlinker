# ADR-022: Product synchronization with cross-platform category and attribute mapping

- **Status**: Proposed
- **Date**: 2026-06-09
- **Authors**: @norbert-kulus-blockydevs

## Context

OpenLinker already maps **categories** between platforms, but the mechanism is platform-specific and there is no attribute mapping at all:

- **Category mapping ships today** as a connection-scoped, DB-backed path: the `category_mappings` table (`connection_id`, `prestashop_category_id` → `allegro_category_id` / name / path), the `CategoryMapping` entity + `CategoryMappingRepositoryPort` in `libs/core/src/mappings/`, and `CategoryResolutionService` (`libs/core/src/listings/`), which resolves an offer's category via a 3-step chain: barcode auto-detect (`CategoryBarcodeMatcher`/`EanCategoryMatcher` sub-capability) → configured mapping → manual pick. The columns and entity are hard-named for PrestaShop→Allegro.
- **Attribute mapping** (color, size, material, brand, …) does **not exist**. Variants are linked by barcode (#822/#823/#824); descriptive attributes are never transformed into a destination's parameter shape (e.g. Allegro `offer` vs `product` parameters).
- **WooCommerce** (in progress) needs both without re-deriving PrestaShop/Allegro logic.

The gap is that the category mechanism is *named* for one platform pair rather than generalized. We want one integration-neutral mechanism covering categories **and** descriptive attributes for any platform pair.

## Decision

**Generalize the existing category stack in place** and add a parallel attribute stack — no new top-level capability, no parallel mapping subsystem.

1. **Neutralize, don't replace.** `CategoryResolutionService` remains the platform-agnostic orchestration seam (it already is one). The `category_mappings` columns and `CategoryMapping` entity are renamed to platform-neutral shapes; the resolution chain is unchanged.
2. **Core service + repository port — not a capability adapter.** Mapping is a DB lookup keyed by platform pair; there is no platform-specific transformation for a per-platform adapter to hold. The hexagonal port here is the **repository port**. The one genuinely platform-specific step — discovering a destination category from a barcode — **reuses the existing `CategoryBarcodeMatcher`/`EanCategoryMatcher` sub-capability** on `OfferManagerPort`.
3. **Scoping: platform-pair default + per-connection override.** `connection_id` becomes nullable. Resolution tries the connection-specific row first, then falls back to the platform-pair default row. This keeps the per-connection granularity that ships today while adding "configure once per pair."
4. **Attribute mapping is greenfield** — new `attribute_mappings` + `attribute_value_mappings` tables, platform-neutral from day one, fronted by an `AttributeMappingService` + repository port mirroring the category shape.
5. **Mapping applies to the outbound offer payload only** — never written back to the master product via `ProductMasterPort`.

### Unmapped behavior (splits by kind)

- **Category unresolved** → return `null` ("needs operator mapping"); the offer-creation orchestrator records a terminal `business_failure` outcome (ADR-007). We do **not** fabricate an `'uncategorized'` id — destination marketplaces (Allegro) require a valid leaf category, so a fake default just becomes an opaque API rejection downstream.
- **Attribute unmapped** → omit + warn via `unmappedSourceKeys` (descriptive, not required to publish).
- **Infrastructure errors** still throw. Three distinct outcomes, never collapsed into one `catch`.

## Storage

**Category — evolve + migrate (real production rows exist):**

- Rename `prestashop_category_id` → `source_category_id`; `allegro_category_id`/`allegro_category_name`/`allegro_category_path` → `destination_category_id`/`destination_category_name`/`destination_category_path`.
- Add `source_platform_type`, `destination_platform_type`.
- Backfill every existing row: `source_platform_type='prestashop'`, `destination_platform_type='allegro'`, `connection_id` preserved.
- Replace unique index `(connection_id, prestashop_category_id)` with `(source_platform_type, destination_platform_type, source_category_id, connection_id)`; `connection_id` nullable for platform-pair default rows.

**Attribute — new tables:**

- `attribute_mappings` (`source_platform_type`, `destination_platform_type`, `source_attribute_key`, `destination_attribute_key`, `destination_section 'offer'|'product'`, nullable `connection_id`).
- `attribute_value_mappings` (`attribute_mapping_id` FK, `source_value`, `destination_value`).

(DDL is Postgres — indexes are separate `CREATE INDEX` statements, not inline `INDEX(...)`.)

## Alternatives considered

- **New `CategoryMapping`/`AttributeMapping` capabilities + per-platform adapters** (resolved via `getCapabilityAdapter`): Rejected — the lookup is generic, so the adapters would carry no platform-specific code. Duplicates the barcode step that's already a sub-capability and adds two registry entries for a core DB lookup.
- **Replace the existing stack** (deprecate `CategoryResolutionService` + connection-scoped table): Rejected — the resolution service already solves the fallback chain; replacement throws away working code and forces a harder migration.
- **Platform-pair scoping only** (defer per-connection overrides, as initially drafted): Rejected — that *removes* per-connection granularity that ships today. Pair-default + override is the same column count with no regression.
- **Fabricate `'uncategorized'` / fail-fast on unmapped**: Rejected — see Unmapped behavior.

## Consequences

**Pros:** one neutral mechanism for all pairs; reuses the shipped resolution seam and barcode sub-capability; no new capability; no per-connection regression; clean separation of unmapped-domain-outcome vs infra-error.

**Cons / trade-offs:** category migration touches a populated production table (backfill must be exact); manual mapping maintenance (no auto-discovery); attribute value mapping is manual (no fuzzy match) — covers the common enum/English case, long-tail needs operator input.

**Future work (explicitly deferred, not designed here):** caching / N+1 avoidance for large-catalog offer runs; soft-delete / status column on mapping tables; `created_by` / audit-trail semantics; admin UI for mapping management; auto-categorization.

## References

- Related issues: #1005
- Related ADRs: [ADR-007](./007-syncjob-status-vs-outcome-split.md) (business_failure outcome), [ADR-004](./004-identifier-mapping-service.md) (cross-platform identifier resolution), [ADR-002](./002-capability-ports-with-sub-capabilities.md) (sub-capabilities; reused barcode matcher)
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md) § Products, Listings
