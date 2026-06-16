# Pre-implement Analysis — WooCommerce shop-publish (#1043 + #1044)

**Verdict: READY** (one expected Warning: a migration; no Critical contract breaks).

Gated against the live tree at `1043-1044-woocommerce-shop-publish` (origin/main incl. merged #1075/#1074).

## Reuse findings

| Plan artifact | Verdict | Evidence |
|---|---|---|
| `WooCommerceProductPublisherAdapter` (+ CategoryProvisioner) | **NEW** | No `product-publisher/` dir under `libs/integrations/woocommerce/src/infrastructure/adapters/`. |
| `ProductPublishEnqueueService` + token | **NEW** | No `ProductPublishEnqueue` / `PRODUCT_PUBLISH_ENQUEUE` anywhere. |
| `BulkShopPublishSubmitService` + token | **NEW** | No `BulkShopPublish` anywhere. Mirrors `IBulkListingSubmitService` incl. its `getBatch(batchId)` read (`bulk-listing.controller.ts:133-145`). |
| `BulkListingBatch` aggregate + repo | **REUSE as-is** | Child-type-agnostic (no offer column); §6b of the plan. |
| `BulkListingProgressService` + `BULK_LISTING_PROGRESS_SERVICE_TOKEN` + `IBulkListingProgressService` | **REUSE as-is** | Already injected in the worker offer handler (`marketplace-offer-create.handler.ts:36,72-73,105`) via the `@openlinker/core/listings` barrel — proves worker-injectability. `advanceBatchStatus(batchId, recordId, outcome)`. |
| `bulk_batch_advancements` gate | **REUSE as-is** | Keyed `(batchId, childRecordId)` — generic. |
| `ListingCreationRecord` + repo + `shop.product.publish` job + `ShopProductPublishPayloadV1` + `listing_creation_records` table | **EXTEND (#1042)** | Add `bulkBatchId`; add payload `V2`. |
| status read (`IListingCreationQueryService.getById`) | **NEW** (thin) | No existing read service for the record. |

## Backward-compat / contract surfaces

| Surface | Change | Severity |
|---|---|---|
| `listing_creation_records` schema | + nullable `bulkBatchId` **uuid** + index — **migration `1807000000000`** (newest on main = `1806000000000`). Mirror `offer_creation_records.bulkBatchId` (`@Column({type:'uuid', nullable:true})` + index, orm-entity L75-77). | **Warning** (planned migration) |
| `ListingCreationRecord` entity constructor + `CreateListingCreationRecordInput` | + `bulkBatchId` field. Entity is constructed only in its repo `toDomain` + the #1042 execution/builder specs — **not** a cross-package barrel break. Add as a **trailing** positional param to minimize edits; update repo + specs. | Warning (internal) |
| WooCommerce manifest `supportedCapabilities` | + `'ProductPublisher'`, `'CategoryProvisioner'` (with matching dispatch entries — declare-only-what-the-factory-delivers). | Additive (safe) |
| `ShopProductPublishPayloadV1` → add `V2` | Additive union; worker switches on `schemaVersion`. | Additive (safe) |
| FE `BuildContribution` (`plugin.types.ts:174`) | + optional `shopProductPublishWizard?`. | Additive (safe) |
| `@openlinker/core/listings` barrels | + new service interfaces/types/tokens. | Additive (safe) |

## Notes carried into implementation

1. **Migration prefix `1807000000000`**; `bulkBatchId` is **uuid** (not text) to match `BulkListingBatch.id`.
2. **Capability-manifest ripple** — adding two manifest capabilities can perturb capability-enumeration / routing int-specs; run the **full** `pnpm test:integration`, not just the new spec (known lesson).
3. **Entity ctor**: append `bulkBatchId` last so the #1042 spec/repo edits stay mechanical.
4. **No batch retry** this PR (publish record carries no request snapshot) — deferred with a tracking note; single-job worker retry unaffected.

No Critical items → **READY** to implement.
