# ADR-023: Cross-platform category placement and attribute projection for listing master products

- **Status**: Accepted
- **Date**: 2026-06-13
- **Authors**: @piotrswierzy

> Supersedes the design in the unmerged `adr-015-product-sync-mapping` branch (#1005 / PR #1007), which generalised the category-mapping *table* but (a) modelled attribute values as plain neutral strings that cannot produce a valid Allegro parameter payload, (b) keyed platform-pair defaults on store-local category ids, and (c) scoped mappings by a single ambiguous `connection_id`.
>
> **Pairs with [ADR-024](./024-destination-listing-capabilities.md)** (destination listing capabilities — marketplace `OfferManager` vs shop `ProductPublisher`). ADR-023 owns the *shared brain* (where a product is placed + how its attributes are projected); ADR-024 owns *how each destination shape consumes it*. The two were designed together.

## Context

A product/inventory **master** (today PrestaShop; WooCommerce also implements `ProductMaster`) is listed for sale on a **destination** channel. "Listed with correct categories" is a four-stage pipeline whose rules differ per destination:

1. **Placement** — put the product into the right destination category.
2. **Requirement discovery** — what does that category demand (required parameters, leaf-only)?
3. **Attribute projection** — turn the product's descriptive attributes into the destination's parameter shape.
4. **Publish gate** — publishable vs. needs-operator-input vs. infra-error.

### The asymmetry that drives the design: marketplace vs. shop

| | Marketplace (Allegro, ERLI) | Shop (WooCommerce, Shopify) |
|---|---|---|
| Taxonomy | Closed, global, rigid, **leaf required** | Open, seller-owned, free-form, **multi-category** |
| Action on it | **Resolve into** an existing category | **Provision** — mirror / create the category |
| Category drives parameters? | **Yes** — category-scoped, dictionary-constrained, required-gated, offer/product section | No — attributes free-form, optional |
| "Listing" capability | `OfferManager.createOffer` (offer ≠ product) — ADR-024 | `ProductPublisher.publishProduct` (owned record) — ADR-024 |
| Barcode→category lookup | Yes (GTIN → catalog → category) | None |

This ADR settles the **stages 1–4 brain** that both destination shapes share. The capability shapes themselves live in ADR-024.

### Taxonomy provenance — the third mode (ERLI-driven)

Research into the in-flight ERLI integration (spec PR #999, #984/#985) surfaced a mode the prior draft missed. A destination relates to "its" taxonomy in one of three ways:

- **Owns** it (Allegro): has its own category tree + per-category parameter schema (`CategoryParametersReader`). Resolve attribute values against *its* live dictionary.
- **Borrows** another connection's taxonomy (ERLI accepts Allegro category/parameter ids verbatim via `source:"allegro"`; it ships **no** `CategoryBrowser`/`CategoryParametersReader`). Pass the source-provenance ids through; do **not** attempt per-destination dictionary resolution.
- **Open** taxonomy (shop): no fixed tree, no required-parameter gate; placement is *provisioning* (mirror/create), realized by ADR-024's `CategoryProvisioner`.

Provenance is the axis that lets one neutral brain serve all three. It also yields a concrete win: because ERLI *borrows* Allegro's taxonomy, **an existing PrestaShop→Allegro category mapping is reusable for ERLI at zero extra mapping cost** — the mapping store must be keyed so an Allegro-provenance row resolves for any destination that consumes Allegro ids.

### What already ships (the seams we build on)

- **Placement orchestration**: `CategoryResolutionService` (`libs/core/src/listings/`) — a 3-step chain (barcode → configured mapping → manual), already platform-agnostic in shape; its types still leak Allegro names (`CategoryResolutionResult.allegroCategoryId`, `IMappingConfigService.resolveAllegroCategory`).
- **Storage**: `category_mappings` + `CategoryMapping` entity + `CategoryMappingRepositoryPort` (`libs/core/src/mappings/`). Columns hard-named `prestashop_category_id`/`allegro_category_id`; unique key `(connection_id, prestashop_category_id)` where `connection_id` is the **destination** connection and there is **no source-connection identity**.
- **Capabilities (the generic destination surface, sub-capabilities of `OfferManagerPort`)**: `CategoryBrowser.fetchCategories`, `CategoryBarcodeMatcher`/`EanCategoryMatcher`, `CategoryParametersReader.fetchCategoryParameters({categoryId}) → CategoryParameter[]` (each parameter carries `required`, `section: 'offer'|'product'`, `type`, a `dictionary` of `{id, value}`).
- **Source data**: `ProductVariant.attributes: Record<string,string> | null` (variant-level; `Product` carries none).
- **Failure plumbing**: a `null` category already becomes `business_failure` (`OfferBuilderService` → `OfferBuilderValidationException` → `OfferCreationExecutionService.recordToOutcome → 'business_failure'`, ADR-007).

### Two confirmed gaps

- **Attribute → parameter projection does not exist.**
- **Source categories are read at sync but thrown away** — `MasterProductSyncService` strips them; `ProductOrmEntity` has no category column. So per-source-category mapping has **no input today**. This is the load-bearing prerequisite (Phase 0 below).

### Industry validation

A competitor/market scan (BaseLinker, ChannelEngine, Linnworks, Sellbrite, M2E Pro, ChannelAdvisor, GoDataFeed) corroborates the core decisions: per-source-category mapping configured once and reused with a per-product override is the **near-universal** pattern; dictionary values are mapped by name and **resolved to native ids at publish-time** (no tool stores raw Allegro/eBay value ids); **pairwise** source→destination mapping dominates — **no** surveyed tool uses a canonical/pivot taxonomy; required-parameter **completeness worklists** (mapped/unmapped per category) are the scale UX; AI category/param suggestion is now standard but manual override stays authoritative.

## Decision

**Keep all platform specifics in the destination adapter behind existing capabilities; core stays neutral, capability-driven, and provenance-aware. Generalise the placement stack in place; add a neutral attribute-projection stack that resolves to native ids at publish-time from the live category schema — never by storing the destination's id space in core.**

### 0. Phase 0 — persist source categories (prerequisite, ships first)

Add a `categories` JSONB column to `Product` (source-provenance category ids/paths); stop stripping them in `MasterProductSyncService`. Nothing downstream works without this — `CategoryResolutionService` already accepts `sourceCategoryIds` but the product cannot supply them post-sync.

### 1. Placement = a capability-gated, provenance-aware resolution chain → a neutral destination category

`CategoryResolutionService` generalised (names neutralised — see §Contract surface). Resolution order, each step gated on a declared capability:

1. **Provision** (open provenance) — if the destination implements `CategoryProvisioner` (ADR-024), mirror the source path / create-if-missing.
2. **Barcode** — `CategoryBarcodeMatcher`/`EanCategoryMatcher` (GTIN → catalog → category). Auto, highest-leverage where the GTIN is in the destination/borrowed catalog.
3. **Per-source-category mapping** — a configured `(source category) → (destination category)` row (§2). The scalable manual lever: map once per source category.
4. **Manual pick** — operator chooses; resolution returns `null` until they do.

Output is a neutral `{ destinationCategoryId, provenance, method }`. The chain is identical for Allegro (owns), ERLI (borrows — barcode/mapping resolve to Allegro ids passed through), and a future shop (open — provision). Which steps are *available* is decided by capability presence, never `platformType` string-matching.

### 2. Scope mappings by **source connection + destination connection** (and provenance), not a single ambiguous id

Category ids are **store-local** — PrestaShop category `15` differs across stores. So:

- Key: `(source_connection_id, destination_connection_id, source_category_id) → (destination_category_id, …)`.
- Add `destination_taxonomy_provenance` (e.g. `'allegro'`) so a *borrowed-taxonomy* destination (ERLI) resolves against the owner's (Allegro's) mappings without re-authoring.
- **Drop platform-pair defaults for categories** — a pair-default keyed on a store-local id is unsound. (§4 explains why attributes are different.)

### 3. Attribute projection lives in **core**, provenance-aware, over the neutral `CategoryParameter` output

Once the category is resolved, core projects attributes generically — no new capability, no destination ids in core tables:

- **Owns provenance**: read `CategoryParametersReader.fetchCategoryParameters({categoryId})`; for each parameter, find the mapped source attribute + value; resolve `type:'dictionary'` to `{id, valuesIds:[entry.id]}` by matching the mapped value against `parameter.dictionary[].value` (exact, case-insensitive), free-text to `{id, values:[mapped]}`; take `section` from the parameter (never stored in the mapping).
- **Borrows provenance** (ERLI): emit the source-provenance parameter ids/values directly (the owner's schema already validated them); no per-destination dictionary lookup.
- **Open provenance** (shop): emit attributes as free-form destination attributes (no required gate); ADR-024 maps these to Woo global/custom attributes / Shopify category metafields.

The destination's own schema is the source of truth for ids/sections/dictionaries, fetched at publish-time — so core stores only neutral, human-meaningful intent and works unchanged for any destination.

### 4. Mapping units, and where a "default" is legitimate

- **Category mappings**: per `(source_connection, destination_connection, source_category)`. No connection-wide default (ids are store-local).
- **Attribute key mappings**: per `(source_connection, source_attribute_key)` with an **optional** destination-category scope. A category-NULL row is a legitimate connection-wide default *because attribute keys are stable across categories* (`color`/`size`/`brand`) — the asymmetry that makes pair-defaults wrong for categories but right for attributes. Category-scoped rows override.
- **Attribute value mappings**: child rows `source_value → destination_value` (human strings). Category-specific dictionary-id resolution happens at projection-time (§3), so stored values stay neutral and portable.

### 5. Publish gate — three outcomes, never one `catch`

- **Required category unmapped, or a `required` parameter has no resolvable value** → `business_failure` (ADR-007) with an actionable payload (unmapped source category / attribute keys). Never fabricate `uncategorized` or a placeholder value.
- **Optional attribute unmapped or value not in dictionary** → omit + warn (`unmappedSourceKeys`); the listing still publishes.
- **Infra error** → throw and let the job retry.

### 6. `CategoryParameter` extensions for marketplace-generality

The neutral shape represents Allegro + eBay cleanly; to avoid getting stuck on a 3rd marketplace, add now (harmless for Allegro/ERLI/shops):

- `multiValue` (eBay `itemToAspectCardinality: MULTI`; Allegro `restrictions.multipleChoices` or `allowedNumberOfValues > 1` — there is no single Allegro `variantsAllowed` field). Shipped in #1035 as **optional** (`multiValue?: boolean`, additive) — promote to required when a second producing adapter lands.
- `dictionary[].id` already exists and is **required** on `CategoryParameterDictionaryEntry` (Allegro uses value **ids**); eBay/Amazon use **labels**, so a labels-only adapter synthesises an id at its boundary rather than the field being made optional (avoids a breaking change for current consumers).
- **Documented limit**: Amazon's Product-Type JSON-Schema conditional/nested requirements don't fit a flat list — the abstraction captures Amazon's *flattened top-level* required attributes only.

## Flow

Placement (provenance-aware chain) → projection (over the live category schema) → publish gate. The same brain serves any destination shape; `business_failure` is raised at two points (unresolved required category, unresolved required parameter).

```mermaid
sequenceDiagram
    participant Builder as Listing builder (offer/product)
    participant Res as CategoryResolutionService
    participant Cap as Destination adapter (capabilities)
    participant Map as Mapping store
    participant Proj as AttributeProjectionService

    Builder->>Res: resolveCategory(source product, dest connection)
    Note over Res: provenance: owns | borrows | open
    alt open (shop)
        Res->>Cap: CategoryProvisioner.provisionCategory(source path)
        Cap-->>Res: destinationCategoryId (created / mirrored)
    else barcode available
        Res->>Cap: CategoryBarcodeMatcher.match(GTIN)
        Cap-->>Res: destinationCategoryId | null
    end
    opt still unresolved
        Res->>Map: findBySourceCategory(srcConn, destConn, srcCat)
        Map-->>Res: destinationCategoryId | null
    end
    Res-->>Builder: {destinationCategoryId, provenance, method} | null
    alt category null
        Builder-->>Builder: business_failure (needs operator mapping)
    end

    Builder->>Proj: project(attributes, destCategoryId, provenance)
    alt owns (Allegro)
        Proj->>Cap: CategoryParametersReader.fetch(destCategoryId)
        Cap-->>Proj: CategoryParameter[] (required, section, dictionary)
        Note over Proj: map source attr→param; resolve value→valueId at publish-time
    else borrows (ERLI)
        Note over Proj: pass source-provenance ids/values through verbatim
    else open (shop)
        Note over Proj: emit free-form destination attributes
    end
    Proj-->>Builder: ResolvedParameter[] + unmappedSourceKeys
    alt required parameter unresolved
        Builder-->>Builder: business_failure
    end
```

## Contract surface to neutralise (not just the table)

The Allegro naming is welded through the vertical; neutralisation must cover all of it:

- Entity `CategoryMapping`: `prestashopCategoryId`/`allegroCategory*` → `sourceCategoryId`/`destinationCategory*`; add `sourceConnectionId`, `destinationConnectionId`, `destinationTaxonomyProvenance`.
- `CategoryMappingRepositoryPort.findByPrestashopCategoryId` → `findBySourceCategory(...)`.
- `IMappingConfigService.resolveAllegroCategory` / `deleteCategoryMapping(…, prestashopCategoryId)` → neutral names; `CategoryMappingInput` fields.
- `CategoryResolutionResult.allegroCategoryId` → `destinationCategoryId` (+ `provenance`).
- API DTOs + the FE mapping editor and create-offer wizard.

> **Addendum (2026-06-15, #1039) — parameter carriage.** Projected parameters travel as the neutral domain type `OfferParameter` (`{id, values?, valuesIds?, section}`) on the first-class `CreateOfferCommand.parameters` field — *not* through the opaque `overrides.platformParams` bag (reserved for un-modeled platform knobs: delivery policy id, invoice type, …). The offer/product **section split** and wire-key naming live **only** in the destination adapter (Allegro: `body.parameters[]` vs `productSet[].product.parameters[]`). The publish gate enforces **offer-section** required params at the core builder; **product-section** required params are deferred to the adapter / marketplace because Allegro catalog smart-link (#431/#808) and bulk self-link (#824) inherit them from the catalog card. The application-layer `ResolvedParameter` is an alias of `OfferParameter`. The FE wizard's transitional Allegro-shaped `platformParams.parameters`/`productParameters` channel collapses onto `CreateOfferCommand.parameters` in #1071; the shop-side `PublishProductCommand` adopts the same neutral channel in #1072.

> **Addendum (2026-06-26, #1045) — borrowed-taxonomy reuse mechanism.** The §40/§83 promise ("an existing PrestaShop→Allegro mapping is reusable for ERLI at zero extra mapping cost") is realised by a **provenance-keyed fallback**, not a connection pointer. A `borrows` destination names the owner taxonomy it consumes via a new minimal sub-capability **`TaxonomyBorrower`** (`getBorrowedTaxonomy(): TaxonomyOwner`, guard `isTaxonomyBorrower`, under `listings/domain/ports/capabilities/`); ERLI returns `'allegro'`. `TaxonomyOwner` is a distinct `as const` union from `CategoryProvenance` (the relationship kind owns|borrows|open) — it identifies *which* owner taxonomy, mirroring the `destination_taxonomy_provenance` column value. Resolution threads the value capability-driven (never `platformType`): `OfferBuilderService` reads it once from the already-resolved destination adapter and passes it — plus the master `sourceConnectionId` — into `CategoryResolutionService` (→ `MappingConfigService.resolveDestinationCategory`) and `AttributeProjectionService.project`. Each tries a **destination-keyed** row first (an explicit ERLI override wins) then falls back to the oldest **provenance-matching** owner row (`CategoryMappingRepositoryPort.findBySourceCategoryByProvenance`, `AttributeMappingRepositoryPort.findByProvenance`), source-scoped to bound multi-owner-connection ambiguity (oldest-wins + warn backstop, consistent with `findBySourceCategory`). `attribute_mappings` gained a `destination_taxonomy_provenance` column (default `'allegro'`) to match `category_mappings`; the downstream emission (ERLI `source:"allegro"`) and the borrows attribute pass-through were already correct (#985/#1096) — #1045 only wired the resolution half.

## Storage

**Category — evolve + migrate (real production rows exist):**

- Rename `prestashop_category_id` → `source_category_id`; `allegro_category_id/name/path` → `destination_category_id/name/path`.
- Add `source_connection_id`, `destination_connection_id` (existing `connection_id` becomes `destination_connection_id`), `destination_taxonomy_provenance`.
- **Backfill**: `destination_connection_id` from existing `connection_id`; `destination_taxonomy_provenance='allegro'`; `source_connection_id` to the single PrestaShop `ProductMaster` connection **iff exactly one exists**, else `NULL` + flag in the editor as "needs source store" (we cannot invent which store a historical row came from).
- Unique index `(source_connection_id, destination_connection_id, source_category_id)`.

**Attribute — new tables:**

- `attribute_mappings` (`source_connection_id`, `destination_connection_id`, `source_attribute_key`, `destination_parameter_name`, **nullable** `destination_category_id`). **Two partial unique indexes** for Postgres NULL-distinct semantics (precedent: `product_content_field`, `prompt_templates`): `… WHERE destination_category_id IS NULL` (default) and `… WHERE destination_category_id IS NOT NULL` (override).
- `attribute_value_mappings` (`attribute_mapping_id` FK, `source_value`, `destination_value`), unique `(attribute_mapping_id, source_value)`.

No `destination_section` column (from `CategoryParameter.section`). No destination parameter/value **ids** stored (resolved at publish-time).

## Alternatives considered

- **Store destination-native ids in core (parameter id + value id), category-scoped.** Rejected: leaks the destination id space, forces a row per attribute per category, isn't portable. Publish-time resolution gives the same payload with neutral storage. (Industry scan: no tool stores native ids.)
- **A per-platform `AttributeProjector` capability adapter.** Rejected: projection is generic over the neutral `CategoryParameter` contract; adapters would hold no platform code.
- **One `connection_id`, no source scoping (status quo + prior draft).** Rejected: store-local ids collide across multi-store (§2).
- **Platform-pair defaults for categories.** Rejected (§2); kept for attributes only (§4).
- **Canonical/pivot taxonomy.** Rejected for now — no surveyed tool uses one; the marketplaces don't share a standard tree (Google/GPC only partially inter-map). The row schema (with `destination_taxonomy_provenance`) leaves room to add a pivot column if a 3rd distinct marketplace ever forces it.
- **Fuzzy / AI auto-categorisation.** Deferred by decision (scope = barcode + manual per-category). The chain has room for a suggest-and-approve step later (OL already ships an AI subsystem).

## Consequences

**Pros:** one neutral, provenance-aware, capability-driven mechanism for any destination; no platform strings/ids in core; reuses four shipped capabilities + the existing chain; multi-store-correct; ERLI reuses Allegro mappings for free; attribute defaults where sound and per-category where required; clean three-way failure; honest migration. Aligns with the dominant industry pattern.

**Cons / trade-offs:**
- **Publish-time schema fetch** per offer (mitigated by the adapter's existing 24h category-parameter cache).
- **Exact-string value/name matching** (no fuzzy, by decision) — a non-matching value counts unmapped (operator fixes it).
- **Parameter matched by name across categories** — Allegro names vary per category; the editor should let operators pick from discovered names.
- **Migration touches a populated table** and cannot reconstruct historical source-connection identity beyond one source store (flagged, not guessed).
- **Manual mapping maintenance** beyond barcode.

**Deferred (not designed here):** AI category/param suggestion; mapping-editor completeness-worklist UX (the competitor pattern); caching of projection results; soft-delete/audit on mapping rows; a pivot taxonomy.

## Related

- Supersedes the `adr-015-product-sync-mapping` draft (#1005 / PR #1007).
- **[ADR-024](./024-destination-listing-capabilities.md)** — the listing-capability shapes that consume this brain.
- [ADR-002](./002-capability-ports-with-sub-capabilities.md), [ADR-007](./007-syncjob-status-vs-outcome-split.md), [ADR-004](./004-identifier-mapping-service.md).
- Issues: #1005; #824 (variant offers / barcode self-link); ERLI (#978 family, spec PR #999).
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md) § Products, Listings.
