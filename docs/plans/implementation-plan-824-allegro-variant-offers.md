# Implementation Plan — #824 List multi-variant products as auto-grouped Allegro variant offers

**Issue:** #824 — `feat(listings,allegro): list multi-variant products as auto-grouped Allegro variant offers`
**Depends on:** #822 (variant-keyed master inventory, merged), #823 (per-combination master stock, merged)
**Builds on:** #808 (`productCardId` thread), #792/#798/#801 (per-variant price + batch availability)
**Layer:** CORE (listings application service) — *no Allegro adapter change required for the MVP*

---

## 1. Goal

When the bulk-offer flow creates Allegro offers for a **multi-variant** product, list **one offer per variant** (today: one offer per product, using only the row's primary variant), each carrying its **own master stock**, so Allegro auto-groups them into a single variant listing.

## 2. Key finding — grouping is automatic, no new payload needed

Verified against developer.allegro.pl + help.allegro.com (2026-05-25):

- The explicit variant API (`/sale/offer-variants`, `options.variantsAllowed/variantsEqual/variantsByColorPatternAllowed`) was **removed 14 Apr 2026**. **Do not build toward it.**
- Replacement: *"Warianty produktowe tworzymy automatycznie na podstawie Katalogu produktów."* Allegro **auto-groups** offers that reference catalog products in the same family, keyed by **GTIN + up to 2 category distinguishing parameters** (size/color/…). There is **no grouping API call and no "is-variant" flag**.
- OpenLinker already models **1 OL variant → 1 standalone Allegro offer**, linked to a catalog product by the variant's own EAN/GTIN (the #808 `productCardId` thread / adapter barcode fallback), with stock written per-offer to `body.stock.available`.

**Therefore the destination half is an *expansion* problem, not a new stock model or payload.** Each OL variant already has its own barcode → its own Allegro catalog product → Allegro groups them automatically. The work is to stop listing only the primary variant and instead fan a multi-variant product out into one per-variant offer.

## 3. Scope

### In scope (this issue)
1. **Expand** a multi-variant product in the bulk submit into **one offer-creation job per variant** (dedup-safe), before the batch is persisted.
2. Source each variant's `stock.available` from **master stock** (#823) via `IInventoryQueryService.getAvailabilityByVariantIds` (one batch lookup).
3. Set the batch `totalCount` to the **expanded** count so progress counters (#737) stay correct.
4. Each expanded sibling self-links to its own catalog product by its own barcode (adapter's existing barcode fallback when `productCardId` is null) — this is what makes Allegro group them.
5. Single-variant products are unaffected (expansion yields exactly the one variant → identical to today).
6. Unit coverage for expansion: dedup, single-variant passthrough, no-barcode handling, per-variant stock sourcing, `totalCount`.

### Proposed deferral → follow-up (see §8)
- **Explicit `variant.attributes → Allegro distinguishing-parameter` emission.** Grouping already works off each variant's catalog product (GTIN), so emitting attributes as parameters is a robustness add, not a grouping prerequisite. It needs (a) sandbox verification that it's required at all, and (b) a reliable `attributes`-key → Allegro category-parameter-id mapping source that OL does not currently have. Recommend splitting into a sandbox-gated follow-up rather than guessing the mapping.

### Out of scope
- Allegro adapter request-body changes (the per-offer `stock.available` + `productSet` catalog link already exist).
- FE pre-submit count display (cosmetic; backend `totalCount` already drives progress correctly).
- Non-Allegro marketplaces.

## 4. Design

### Insertion point
`libs/core/src/listings/application/services/bulk-offer-creation-submit.service.ts` — `submit()`, before batch persistence + the enqueue loop. The enqueue loop, `OfferCreationEnqueueService`, `OfferBuilderService`, and the Allegro adapter are **unchanged** — they already operate per `internalVariantId`.

### Expansion algorithm (marketplace-neutral, in the submit service)
Incoming `BulkOfferCreationSubmitInput.productIds` are **variant ids** (FE sends one primary variant per product row).

1. Resolve each incoming id → `ProductVariant` (`IProductsService.getVariant`) to get its `productId`.
2. Group by `productId`; for each distinct product fetch all variants (`IProductsService.getVariantsByProductId`, added in #822).
3. Build the **expanded, de-duplicated** ordered list of variant ids (union across distinct products; a product selected twice expands once).
4. Partition variants with a barcode (`ean ?? gtin`) from those without — only barcoded variants can link+group. **Policy:** keep the existing single-offer behaviour (create by barcode; the adapter already handles the no-card fallback), but **log a structured warning** per skipped/unlinkable variant and exclude no-barcode siblings from auto-expansion so we never emit an ungroupable orphan offer the user didn't pick. (Originally-selected ids are always kept, matching today.)
5. Batch-fetch master stock: `getAvailabilityByVariantIds(expandedIds)` → `Map<variantId, totalAvailable>`.
6. `totalCount = expandedIds.length`.
7. Enqueue one job per expanded variant via the existing `buildEnqueueInput` path, with:
   - `internalVariantId` = expanded variant id
   - `stock` = master availability for that variant (fallback to shared-config stock only if master is unknown/zero-filled — document the precedence)
   - `price` = `variant.price` (#798) ?? shared/override price
   - `productCardId` = pre-resolved card **only for the originally-selected variant**; siblings pass `null` and self-resolve by their own barcode in the adapter
   - product-level overrides (the `PerProductOverride` keyed by the selected variant id) apply to **all** expanded siblings of that product

### Backward compatibility
- Single-variant product → expansion returns the one variant → behaviour identical to today.
- Multi-variant product → behaviour changes from "primary only" to "all variants" — this *is* the bug fix.

## 5. Files to change

| File | Change | AC |
|---|---|---|
| `libs/core/src/listings/application/services/bulk-offer-creation-submit.service.ts` | Add expansion step before batch persist + enqueue loop; inject `IProductsService` + `IInventoryQueryService` (already cross-context-allowed service interfaces). | Multi-variant product enqueues N jobs; `totalCount` = N; single-variant unchanged. |
| `libs/core/src/listings/application/types/bulk-offer-creation-submit.types.ts` | If a new `expandVariants` opt-in flag is chosen (see §7 Q1), add it to `BulkSharedConfig`; otherwise no change. | — |
| `libs/core/src/listings/application/services/__tests__/bulk-offer-creation-submit.service.spec.ts` | New cases: multi-variant expansion (N jobs, totalCount), dedup of same-product ids, single-variant passthrough, no-barcode sibling excluded + warning, per-variant master stock wins over shared. | Unit coverage for expansion. |
| `docs/architecture-overview.md` | Update the Listings bulk-flow note to record per-variant expansion + that Allegro grouping is automatic from the catalog (no variant API). | Docs current. |

**No migration** (no schema change). **No Allegro adapter change** for the MVP.

## 6. Testing strategy
- **Unit (`*.spec.ts`)** on the submit service — mock `IProductsService`, `IInventoryQueryService`, `IOfferCreationEnqueueService`, repository port. Assert enqueue call count, per-job `stock`/`internalVariantId`, `totalCount`, dedup, single-variant passthrough, no-barcode exclusion + warning.
- **Sandbox (manual, recorded in the PR)** — list a real multi-variant product and confirm Allegro groups the offers into one listing. This is the AC that cannot be unit-asserted; it also informs the §8 follow-up.
- Quality gate: `pnpm lint && pnpm type-check && pnpm test`.

## 7. Open questions (resolve at the Phase-3 pause)
- **Q1 — Expansion trigger:** always expand any multi-variant product (recommended — listing only the primary variant is the reported bug), or gate behind an opt-in `BulkSharedConfig.expandVariants` flag?
- **Q2 — Scope of distinguishing-parameter emission:** ship expansion-only now and defer attribute→parameter emission to a sandbox-gated follow-up (recommended, see §2/§8), or implement attribute→parameter emission in this issue per the literal AC?
- **Q3 — No-barcode variant policy:** exclude + warn (recommended), vs. create an unlinked (ungroupable) offer.

## 8. Proposed follow-up issue
`feat(allegro): emit OL variant attributes as Allegro distinguishing parameters for variant grouping` — blocked on sandbox confirmation of whether per-offer parameter emission is needed when each variant already links to its own catalog product, plus an `attributes`-key → category-parameter-id mapping source. Builds on this issue.

## 9. Architecture compliance
- Expansion is **marketplace-neutral** fan-out policy → belongs in the CORE listings application service, not the Allegro adapter (matches the exploration's recommendation and the bulk-flow lifecycle in `architecture-overview.md`).
- Only cross-context **service interfaces** (`IProductsService`, `IInventoryQueryService`) are imported — within the documented cross-context contract surface.
- No `any`; per-variant stock typed via `VariantAvailability`. Structured logging via the shared `Logger`.
