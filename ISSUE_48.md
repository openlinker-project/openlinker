# Persist EAN/GTIN on Product Variants to Enable Allegro Offer Linking

## Context

`marketplace.offers.sync` (Allegro) attempts to link marketplace offers to internal catalog variants via **EAN/GTIN**, but OpenLinker currently does **not** persist EAN/GTIN in canonical storage:

* `products` table contains only `sku` (and product-level data is not a stable offer-link target).
* `product_variants` exists, but EAN/GTIN are not stored as columns.
* Current master adapters (notably PrestaShop) do **not** populate EAN/GTIN into variant `attributes`.
* `OfferMappingSyncService` queries `product_variants.attributes ->> 'ean'/'gtin'`, so lookups are always empty in real data.

**Important invariant:** Offer linking must target **variants**, not products. Even if a product has no combinations, we still must have a deterministic variant representation.

---

## Problem Statement

Offer mapping by barcode cannot work because:

1. EAN/GTIN are not persisted in canonical storage, and
2. adapter payloads do not map product/combination barcodes into variant data, and
3. repository lookup uses JSON attributes that are unpopulated.

As a result, `marketplace.offers.sync` cannot resolve internal variants for Allegro offers when offers contain EAN/GTIN.

---

## Goals

1. Persist **EAN/GTIN** at **variant-level** in canonical storage (`product_variants`).
2. Ensure master adapters populate these fields (starting with PrestaShop).
3. Make variant lookup by barcode fast and reliable (indexed column lookup).
4. Ensure products without combinations still produce **one deterministic synthetic variant** so offers always have a variant target.
5. Prevent incorrect linking: **only link when barcode match is unique**; skip ambiguous matches.

---

## Non-Goals

* Do **not** add EAN/GTIN to `products` (variant is the canonical link target).
* Do **not** support multiple barcodes per variant (store a single deterministic value per field).
* No API/UI work required.
* No multi-tenancy concerns at this stage.

---

## Canonical Barcode Semantics (must be deterministic)

To avoid adapter inconsistencies, enforce a single rule:

* `ean`: store **EAN-13** (13 digits) when available/valid
* `gtin`: store **UPC-A (12 digits)** or other “GTIN-like” value when available/valid

### Normalization & Validation (required)

Before persisting or matching barcodes:

* trim whitespace
* remove all non-digits
* keep leading zeros (store as string)
* accept only typical GTIN lengths (12/13/14; optionally 8 if needed later)
* treat empty/invalid values as `null`

---

## Tasks

### 1) Canonical storage for EAN/GTIN (variant-level)

* [ ] Add `ean?: string`, `gtin?: string` to `ProductVariant` domain model.
* [ ] Add nullable columns `ean`, `gtin` to `product_variants` ORM entity.
* [ ] Migration:

  * [ ] Add nullable columns `ean`, `gtin` to `product_variants`.
  * [ ] Add indexes for query performance (connection-scoped):

    * [ ] `INDEX (connection_id, ean)`
    * [ ] `INDEX (connection_id, gtin)`
* [ ] Add barcode normalization/validation helper (core, shared place used by adapters + sync):

  * [ ] `normalizeBarcode(input: string | undefined | null): string | null`
  * [ ] Enforce normalization on write (domain/application layer), not only in adapters.
* [ ] Backfill (migration script or one-off job):

  * [ ] For each variant, if `ean` is null and `attributes->>'ean'` exists, normalize + validate then write to `ean`.
  * [ ] If `gtin` is null and `attributes->>'gtin'` exists, normalize + validate then write to `gtin`.
  * [ ] Must be idempotent and skip invalid/empty values.

### 2) Ports & contracts (core)

* [ ] Extend `ProductVariant` port type to include `ean?: string`, `gtin?: string`.
* [ ] Extend `ProductVariantCreate` to allow `ean` / `gtin`.
* [ ] Ensure `MasterProductSyncService` passes these fields through to domain entities and persists them (normalized).

### 3) Repository lookup behavior (columns-first, safe linking)

* [ ] Update `ProductVariantRepository.findByEanOrGtinIn(...)`:

  * [ ] Prefer column lookup (`ean`, `gtin`) scoped by `connectionId`.
  * [ ] Fallback to JSON attributes (`attributes->>'ean'/'gtin'`) for backward compatibility only.
  * [ ] Normalize input codes before querying.
  * [ ] Detect ambiguity: if multiple variants match the same barcode, mark that barcode as ambiguous.
* [ ] Update return shape (or provide a companion method) so callers can safely decide:

  * **Resolved**: barcode → variant (only when unique)
  * **Ambiguous**: barcode → multiple matches (must not link)
  * **Missing**: barcode with no match

> Linking rule: **only link when exactly 1 variant matches**.

### 4) Offer mapping sync behavior (skip ambiguity)

* [ ] Update `OfferMappingSyncService` to:

  * [ ] Normalize EAN/GTIN extracted from offers before lookup.
  * [ ] Link offer → variant only when barcode match is unique.
  * [ ] Skip ambiguous matches and log structured reason (`ambiguous_barcode_match`).
  * [ ] Skip missing/invalid barcodes and log reason (`no_barcode_match` / `invalid_barcode`).
  * [ ] (Optional but recommended) Emit metrics counters for matched / missing / ambiguous.

### 5) PrestaShop adapter: extract and persist EAN/GTIN

* [ ] Update DTO interfaces:

  * [ ] `PrestashopProduct` includes `ean13?: string`, `upc?: string` (where available).
  * [ ] `PrestashopCombination` includes `ean13?: string`, `upc?: string` (where available).
* [ ] Mapping rules (deterministic precedence):

  * [ ] For combination variants:

    * prefer combination `ean13/upc`
    * fallback to product `ean13/upc` if combination fields missing
  * [ ] Normalize + validate before assigning.
  * [ ] Map `ean13` → `variant.ean` (if 13 digits after normalization)
  * [ ] Map `upc` → `variant.gtin` (if 12 digits after normalization)
* [ ] Products with **no combinations**:

  * [ ] Synthesize exactly **one** deterministic variant in `PrestashopProductMasterAdapter.getProductVariants`:

    * `externalId = "product:<prestashopProductId>"` (stable, not derived from SKU/reference)
    * `sku = product.reference ?? "product-<prestashopProductId>"`
    * `ean/gtin` copied from product-level fields (normalized)
  * [ ] This synthetic variant is the canonical target for offers/orders referencing a “simple product”.
* [ ] Transition handling (simple → combinations):

  * [ ] Ensure the sync reconciliation removes/archives stale synthetic variant when combinations appear, so barcode lookups don’t become ambiguous.
  * [ ] If the current sync pipeline does not delete stale variants, add the minimal reconciliation step required.

### 6) Tests

**Core**

* [ ] Unit tests for normalization/validation:

  * [ ] trims + removes non-digits
  * [ ] preserves leading zeros
  * [ ] invalid lengths return null
* [ ] Repository tests for `findByEanOrGtinIn`:

  * [ ] column lookup preferred
  * [ ] attributes fallback works
  * [ ] scoped by `connectionId`
  * [ ] ambiguous barcode returns ambiguous set (no single resolved variant)

**PrestaShop**

* [ ] Mapper tests:

  * [ ] `ean13` → `variant.ean`
  * [ ] `upc` → `variant.gtin`
  * [ ] combination missing barcode falls back to product barcode
* [ ] Adapter test:

  * [ ] product without combinations returns exactly one synthetic variant containing barcode fields

**Offer mapping**

* [ ] Unit test: OfferMappingSyncService links only when unique match; skips ambiguous

### 7) Docs

* [ ] Update docs (`docs/architecture-overview.md` or `docs/implementation-plan-issue-47-offer-mapping-sync.md`):

  * [ ] Barcodes are stored on **variants**
  * [ ] Products without combinations produce a **synthetic variant**
  * [ ] Offer mapping uses **unique-match-only** linking rules
  * [ ] Attributes fallback is transitional

---

## Acceptance Criteria

* [ ] `product_variants` has nullable `ean`, `gtin` columns + connection-scoped indexes.
* [ ] Barcodes are normalized (digits-only) and validated before persistence; invalid values are stored as `null`.
* [ ] Backfill copies `attributes.ean/gtin` into columns when present and valid.
* [ ] `findByEanOrGtinIn` resolves variants via columns first (attributes fallback OK) and detects ambiguity.
* [ ] PrestaShop sync populates EAN/GTIN for variants (combinations and simple products).
* [ ] Products without combinations create **one deterministic synthetic variant** (stable externalId) with EAN/GTIN when present.
* [ ] If a product later gains combinations, stale synthetic variant does not cause ambiguous barcode matches (reconciled/removed/ignored).
* [ ] `marketplace.offers.sync` links Allegro offers by EAN/GTIN when match is unique; skips ambiguous/missing.
* [ ] Tests pass.

---

## Notes / Guardrails

* Do not store multiple EANs per variant.
* Do not “pick first” on duplicates—ambiguity must skip linking to avoid wrong mappings.
* Keep changes ORM/migration-driven (we prefer ORM-level implementations with migrations).
* Keep everything connection-scoped (do not match barcodes across connections).

---

## Observability (recommended)

* Log counters per run:

  * `offers_processed`
  * `barcode_matched_unique`
  * `barcode_missing_or_invalid`
  * `barcode_ambiguous`
* Ensure logs are structured so we can diagnose catalog/data issues quickly.

---

## Affected Components

* Core: `libs/core/src/products` (domain + ports + repository)
* Adapter: `libs/integrations/prestashop` (DTOs + mapper + adapter)
* DB: `product_variants` schema + migration(s)
* Worker/API: no direct changes expected (unless reconciliation hooks are missing)

---
