# ADR-010: Variant-keyed master inventory

- **Status**: Accepted
- **Date**: 2026-05-24
- **Authors**: @piotrswierzy

## Context

The bulk Allegro offer-creation wizard reported `NO MASTER STOCK` for every product even when stock existed (#822). Root cause: a read/write key mismatch in inventory. `MasterInventorySyncService` wrote `inventory_items` rows keyed to the **product** with `productVariantId = NULL` (the PrestaShop `InventoryMasterAdapter.getInventory(productId)` returns product-level `stock_availables` and never sets a `variantId`), while the availability read the wizard relies on — `getAvailabilityByVariantIds` → `findAvailabilityByVariantIds` — filters by `productVariantId`. The two keys never intersect, so every variant-keyed read missed and zero-filled.

This contradicts the architecture's own rule that the **variant** is the canonical offer-link / mapping target (EAN/GTIN live on `ProductVariant`; simple products get a deterministic synthetic variant). Inventory being keyed to the bare product was the anomaly.

## Decision

Make master inventory **variant-keyed**: `MasterInventorySyncService` resolves the product's canonical variant and persists the `inventory_items` row against it. Resolution precedence:

1. an adapter-supplied `Inventory.variantId` wins (future-proof; no adapter supplies one today);
2. else, if the product has **exactly one** variant (a simple product's synthetic variant), key to it;
3. else (multi-variant or zero-variant) keep product-level (`productVariantId = NULL`), logged.

A data-only migration (`BackfillInventoryVariantId1799000000003`) converts existing single-variant product-level rows in place. No schema change — the `productVariantId` column and both partial unique indexes (NULL and NOT-NULL) already exist. No read-path change — once rows are variant-keyed the existing query finds them.

## Alternatives considered

- **Variant-keyed write + backfill** (chosen): removes the anomaly at the source; reads need no heuristic. Costs a data migration and leaves multi-variant products deferred.
- **Read-side fallback** (the original Option 1): when no variant-keyed row exists, fall back to the product-level row for that variant's product. Rejected as the durable fix — it's a permanent heuristic on a shared endpoint that's only correct for single-variant products and would over-report stock for multi-variant siblings (an oversell vector in an offer-creation flow). It would have been the smaller tactical unblock, but the team chose the durable direction.
- **Per-combination stock now**: rejected as out of scope for the bug fix — it requires the PrestaShop adapter to enumerate per-combination `stock_availables` and a port-shape change. Deferred to #823.

## Consequences

**Pros:**
- The variant-keyed availability read finds stock; the bulk wizard reports correct master stock for simple products.
- Inventory now agrees with the rest of the system (offers/mappings are variant-keyed) — the anomaly is gone.
- No read-path complexity; no over-reporting heuristic.

**Cons / trade-offs:**
- **Multi-variant (combination) products stay product-level and read as 0 by variant** until per-combination stock lands. This is honest (not over-reported) but means they can't be bulk-listed yet. Tracked as two halves: **#823** (PrestaShop adapter enumerates per-combination stock → emits per-combination `Inventory.variantId`) and **#824** (Allegro lists one offer per variant, auto-grouped from the Product Catalog — note Allegro's explicit `/sale/offer-variants` API was removed 2026-04-14, so #824 must use auto-grouping, and Allegro stock is per-offer, which OL's 1-variant→1-offer model already matches).
- The backfill migration is **load-bearing**: without it, a re-sync of a single-variant product would look up its row by the resolved variant key, miss the legacy NULL-variant row, and insert a second variant-keyed row — an orphan duplicate (both partial indexes permit it). Converting in place prevents this. CI runs migrations before app start.
- The write-propagation dedupe key becomes variant-scoped for future stock changes (strictly more precise); the migration itself triggers no propagation (the no-change guard skips unchanged quantities).

**Migration path:**
- `BackfillInventoryVariantId1799000000003` (data-only) converts single-variant product-level rows to variant-keyed, in place, guarded against colliding with any pre-existing variant-keyed row. `down()` reverts the same rows to NULL (inherently lossy for a data migration — documented inline).

## References

- Related PRs: #822
- Related issues: #822, #823 (per-combination master stock), #824 (Allegro auto-grouped variant offers)
- Related ADRs: [ADR-004](./004-identifier-mapping-service.md) (variant identity)
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md) § Inventory
