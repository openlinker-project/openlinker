# Implementation Plan - Shop-Publish Operational Parity (#1845 / S18)

Bring the WooCommerce shop-publish pipeline to parity with the mature offer pipeline. CORE-focused. Mirror existing offer-path patterns; do not invent new ones.

## Item 1 - Stranded-batch fix (`bulk-shop-publish-submit.service.ts`)
Mirror `bulk-listing-submit.service.ts:220-289`. On a mid-fan-out enqueue failure:
- track enqueued record ids; delete orphaned pre-created records (`deleteById`),
- reconcile `totalCount` down to what was enqueued (`updateTotalCount`), then level-triggered terminal derivation (`succeeded+failed===totalCount`) -> `running` or terminal,
- if nothing enqueued, flip terminal `failed`. Re-throw the underlying error.
New repo method: `ListingCreationRecordRepositoryPort.deleteById`.

## Item 4 - Duplicate handling (`product-publish-execution.service.ts`)
- Concurrency-safe first-publish: when `createMapping` throws `DuplicateIdentifierMappingError`, re-read the `ShopProduct` mapping for this variant and verify it points to the SAME `externalProductId`. Only swallow when it matches; a divergent mapping is a real conflict -> rethrow.

## Item 3 - Shop retry (`bulk-shop-publish-retry.service.ts`, new)
Mirror `bulk-listing-retry.service.ts`. Re-run only failed children:
- add a `request` snapshot (jsonb) to `listing_creation_records` (entity + create-input + ORM column + migration), populated at enqueue time,
- add `resetForRetry` + `findByBulkBatchId` (exists) to the record repo,
- per failed child: advancement `deleteForRecord` -> `resetForRetry` -> `incrementCounters({failed:-1})` -> re-enqueue `shop.product.publish` V2 with a wave-distinct idempotency key rebuilt from the snapshot,
- single terminal->running flip after the loop.
New service + `IBulkShopPublishRetryService` + token + module/barrel wiring.

## Item 2 - Shop status reconcile (steady-state sync)
Mirror `offer-status-sync.service.ts` + `offer_status_snapshots`:
- new capability `ShopProductStatusReader` (`getShopProductStatus(externalProductId)`) + `is*` guard,
- neutral `ShopPublicationStatus` union (`published|draft|unpublished|removed`),
- `shop_product_status_snapshots` table (ORM + domain entity + repo port/impl + types + migration),
- `ShopStatusSyncService` enumerating published/draft listing records for a connection (new paginated `findPublishedByConnection`),
- WooCommerce adapter `getShopProductStatus` (GET product; map status/404->removed),
- job type `shop.product.statusSync` + worker handler + WC plugin scheduler task,
- barrel + module wiring.

## Gate
`pnpm --filter @openlinker/core build`, `pnpm type-check`, scoped core/api unit tests, `pnpm check:invariants`, lint, `migration:show`.
