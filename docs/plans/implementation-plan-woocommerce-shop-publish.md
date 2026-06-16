# Implementation Plan — WooCommerce ProductPublisher + shop-publish API/FE (#1043 + #1044)

Part of epic #1005 · ADR-024. Makes the inert shop-publish keystone (#1042, merged in #1075) **live** by
shipping the first `ShopProductManagerPort` adapter (WooCommerce) and the operator-facing API + FE surfaces.

## 1. Goal & layer classification

- **#1043 (Integration)** — `WooCommerceProductPublisherAdapter implements ShopProductManagerPort, CategoryProvisioner`,
  registered at `woocommerce.restapi.v3` with `'ProductPublisher'` + `'CategoryProvisioner'` capabilities.
- **#1044 (Interface — API + Frontend)** — a `ProductPublishEnqueueService` + single/bulk publish controllers + a
  status read, and a FE "Publish to shop" wizard plugin contribution gated on `ProductPublisher`.

**Decision: bulk = Option B (full aggregate reuse).** Bulk publish reuses the existing child-type-agnostic
`BulkListingBatch` + `BulkListingProgressService` + `bulk_batch_advancements` (see §6b for the coupling analysis).

**Non-goals (deferred, documented):**
- WooCommerce **variations subresource** / variable-product grouping. Each OL variant publishes as its own *simple*
  WC product (the #1042 model is variant-keyed: `internalVariantId` → one shop product). Variant grouping is a later
  enhancement (mirrors the Allegro auto-group / Erli `externalVariantGroup` story).
- **Global-attribute-on-variation** REST writes — the issue says prefer per-product **custom attributes** initially.
- **Batch-level retry of failed publishes** (the offer side's `BulkListingRetryService`). It rebuilds each child from a
  persisted *request snapshot*; `ListingCreationRecord` (#1042) carries no such snapshot. Adding one is its own slice —
  deferred with a tracking note. Single-job worker retry (transient errors) still works; only operator-triggered
  batch *re-publish* of failed children is out of scope here.

## 2. Research summary (grounded in the tree)

- **Contracts to satisfy** (`libs/core/src/listings/`): `ShopProductManagerPort.publishProduct(cmd)`; `PublishProductCommand`
  (`internalVariantId, connectionId, destinationCategoryIds, price{amount,currency}, stock, status, content?, parameters?, externalProductId?, idempotencyKey?, platformParams?`);
  `PublishProductResult{externalProductId, status, warnings?}`; `PublishProductContent{title?, description?, imageUrls?, seo?}`;
  `CategoryProvisioner.provisionCategory(cmd)` with `ProvisionCategoryCommand{connectionId, path:{sourceCategoryId,name}[]}` →
  `ProvisionCategoryResult{destinationCategoryId, createdPath?}`; `OfferParameter{id, values?, valuesIds?, rangeValue?, section}`;
  `ProductPublishRejectedException(adapterKey, statusCode, errors: CreateOfferValidationError[])`; status union `'draft'|'published'`.
- **WooCommerce plugin** (`libs/integrations/woocommerce/src/`): manifest + dispatch in `woocommerce-plugin.ts` (manifest L43-50,
  `createCapabilityAdapter` dispatch L81-134, `register(host)` L59-78). HTTP client `IWooCommerceHttpClient` (`get/post/put/delete`,
  Basic auth, caller supplies `/wp-json/wc/v3/...`, throws `WooCommerceHttpResponseException{statusCode, errorCode}` on 4xx,
  `WooCommerceUnauthorizedException` on 401/403). Write-adapter template: `WooCommerceProductMasterAdapter.createProduct` (L317-341).
- **API enqueue** to mirror: `OfferCreationEnqueueService.enqueueCreation` (pre-create record → build payload → `jobEnqueue.enqueueJob({jobType, connectionId, idempotencyKey, payload})` → return `{jobId, record}`); controller `listings.controller.ts:313` (`202 + {jobId, offerCreationRecordId}`). Job type `'shop.product.publish'` + `ShopProductPublishPayloadV1` already exist (#1042); **no enqueue service exists yet** — we add one.
- **FE**: plugin contribution shape (`plugins/woocommerce/index.ts`), wizard-resolver pattern (`plugins/resolve-offer-creation-wizard.ts` + `app/plugin-bindings/use-offer-creation-wizard.ts`), launcher (`OfferCreationLauncher.tsx`, capability filter L60-65), mutation hook (`use-create-offer-mutation.ts`), status poll (`use-offer-creation-status-query.ts` + `OfferCreationTracker`), CTA on `listings-list-page.tsx:192`. Capability read: `Connection.enabledCapabilities: string[]`.

## 3. Design

### A. WooCommerce adapter (#1043) — `libs/integrations/woocommerce/src/infrastructure/adapters/product-publisher/`

`WooCommerceProductPublisherAdapter implements ShopProductManagerPort, CategoryProvisioner`
(one class, both interfaces — `CategoryProvisioner` is a sub-capability of the port, the guard narrows the *same* instance).
Constructor: `(httpClient: IWooCommerceHttpClient, connection: Connection)`. No identifier-mapping dep — the core execution
service (#1042) owns the `ShopProduct` mapping; the adapter is pure transport.

- `publishProduct(cmd)`:
  - `path = cmd.externalProductId ? PUT /wp-json/wc/v3/products/{externalProductId} : POST /wp-json/wc/v3/products` (upsert vs create).
  - Body (`WooCommerceProductPublishRequest`): `name` (← `content.title`), `type: 'simple'`,
    `status` (`'published'→'publish'`, `'draft'→'draft'`), `regular_price: String(cmd.price.amount)`,
    `manage_stock: true`, `stock_quantity: cmd.stock`, `description` (← `content.description`),
    `categories: cmd.destinationCategoryIds.map(id => ({ id: Number(id) }))`,
    `images: content.imageUrls?.map(src => ({ src }))`,
    `attributes: cmd.parameters?.map(p => ({ name: p.id, options: p.values ?? [], visible: true }))` (per-product custom attributes),
    plus a permissive spread of `cmd.platformParams` for un-modeled knobs (tax_class, shipping_class).
  - 4xx (`WooCommerceHttpResponseException`, status 400-499) → `ProductPublishRejectedException('woocommerce.restapi.v3', statusCode, [{ code: errorCode ?? 'woocommerce_rejected', message }])`. Auth (401/403) propagates as-is (transient/`needs_reauth` path). 5xx/network propagate (worker retry).
  - Return `{ externalProductId: String(raw.id), status: mapWcStatus(raw.status) }` (`'publish'→'published'`, else `'draft'`).
- `provisionCategory(cmd)`: walk `cmd.path` root→leaf, threading `parentId` (start `0`/root). For each node:
  `GET /products/categories?search={name}&parent={parentId}` → match by exact name+parent; else `POST /products/categories {name, parent}`.
  Track created ids; return `{ destinationCategoryId: leafId, createdPath }`. Name search is best-effort; exact-name match guards against `search` fuzzy hits.
- New types in `product-publisher/woocommerce-product-publish.types.ts`; reuse existing WC exceptions.
- Manifest: add `'ProductPublisher'`, `'CategoryProvisioner'` to `supportedCapabilities`. Dispatch table: both capability
  keys construct the **same** `new WooCommerceProductPublisherAdapter(httpClient, connection)` (declare-only-what-the-factory-delivers
  invariant — both must have a dispatch entry since both are in the manifest).

### B. Core enqueue service (#1044) — `libs/core/src/listings/application/services/product-publish-enqueue.service.ts`

`ProductPublishEnqueueService implements IProductPublishEnqueueService` (interface + `*.types.ts` + token
`PRODUCT_PUBLISH_ENQUEUE_SERVICE_TOKEN` in `listings.tokens.ts`). Mirrors `OfferCreationEnqueueService`:
1. Resolve `getCapabilityAdapter<ShopProductManagerPort>(connectionId, 'ProductPublisher')` → 422 if unsupported (also surfaces 404/409 for connection state).
2. Pre-create `ListingCreationRecord` (status `pending`) via the #1042 repo.
3. Build `ShopProductPublishPayloadV1{ schemaVersion:1, internalVariantId, status, stock, price?, content?, idempotencyKey?, listingCreationRecordId }`. (Categories + parameters are resolved by the builder at execution time — the API does not supply them.)
4. `jobEnqueue.enqueueJob({ jobType:'shop.product.publish', connectionId, idempotencyKey: input.idempotencyKey ?? `shop-publish:{record.id}`, payload })`.
5. Return `{ jobId, listingCreationRecord }`.

Plus a thin read for status polling: `IListingCreationQueryService.getById(recordId)` (or expose the repo's `findById` through a tiny query service) → controller maps to a response DTO.

### C. Bulk submit service (#1044, Option B) — `libs/core/src/listings/application/services/bulk-shop-publish-submit.service.ts`

`BulkShopPublishSubmitService implements IBulkShopPublishSubmitService` — the publish sibling of `BulkListingSubmitService`,
reusing the **same** `BulkListingBatchRepositoryPort` aggregate + `BulkBatchAdvancementRepositoryPort`. Flow:
1. Resolve + validate `'ProductPublisher'` capability once up front (422 if unsupported).
2. Persist the parent `BulkListingBatch` (`totalCount = variantIds.length`, `sharedConfig = { status, stock?, ... }` — the operator's shared publish knobs).
3. Fan N enqueues through the **single-publish primitive** `IProductPublishEnqueueService.enqueueCreation`, passing `bulkBatchId` + the per-child `listingCreationRecordId`. First enqueue failure marks the batch failed (mirrors `BulkListingSubmitService` semantics).
4. Return `{ batchId, items: {internalVariantId, jobId, listingCreationRecordId}[] }`.

Reuse note: `BulkListingProgressService.advanceBatchStatus(batchId, childRecordId, outcome)` and `bulk_batch_advancements`
are reused **unchanged** — they key on a generic `(batchId, childRecordId)`. (Optional cosmetic: the param is named
`offerCreationRecordId`; leaving it avoids touching offer call sites — note the misnomer rather than rename.)

### D. Migration + payload V2 (#1044, Option B)

- **Migration `1807000000000`-`add-bulk-batch-id-to-listing-creation-records` (newest on main = `1806000000000`)**: add nullable
  `bulkBatchId` **uuid** column + index `IDX_listing_creation_records_bulkBatchId` on `listing_creation_records`. Mirrors
  `offer_creation_records.bulkBatchId` (`@Column({type:'uuid', nullable:true})` + index). The #1042 repo's `create` input gains
  optional `bulkBatchId`; the `ListingCreationRecord` entity ctor appends `bulkBatchId` **last** (keeps #1042 spec/repo edits mechanical).
- **`ShopProductPublishPayloadV2`** in `shop-job-payloads.types.ts`: `…V1 + { schemaVersion: 2, bulkBatchId }`. The worker
  handler accepts V1 and V2 (schema-version switch, mirroring the offer V1/V2 handler).

### E. Worker advance (#1044, Option B) — `apps/worker/src/sync/handlers/shop-product-publish.handler.ts`

After `executePublish` returns, if the payload carries `bulkBatchId`, call `BulkListingProgressService.advanceBatchStatus(bulkBatchId, listingCreationRecordId, outcome)` (inject `BULK_LISTING_PROGRESS_SERVICE_TOKEN`). Mirrors the offer-create handler's batch-advance. At-most-once is enforced by the advancement repo, so a worker retry can't double-count.

### F. API controllers (#1044) — `apps/api/src/listings/http/shop-publish.controller.ts` (+ DTOs)

- `POST /listings/connections/:connectionId/shop-publish` → `202` `{ jobId, listingCreationRecordId }` (single; calls `ProductPublishEnqueueService`).
  DTO `PublishProductRequestDto{ internalVariantId (IsString NotEmpty), status ('draft'|'published'), stock (IsInt Min 0), price?{amount,currency}, content?{title?,description?,imageUrls?} }`. Header `x-idempotency-key` optional.
- `POST /listings/connections/:connectionId/shop-publish/bulk` → `202` `{ batchId, items: {internalVariantId, jobId, listingCreationRecordId}[] }` (calls `BulkShopPublishSubmitService`).
  DTO `BulkPublishProductRequestDto{ internalVariantIds: string[] (ArrayNotEmpty), status, stock?, price?, content? }`.
- `GET /listings/connections/:connectionId/shop-publish/:recordId` → `ListingCreationRecord` response DTO (status, externalProductId, errors, bulkBatchId). For FE per-record polling.
- `GET /listings/bulk-shop-publish/:batchId` → the `BulkListingBatch` (counters + status) for the batch tracker. (Mirror the existing bulk-offer batch read if one exists; else add a thin batch query.)
- Wire `ProductPublishEnqueueService` + `BulkShopPublishSubmitService` + the status/batch query into `ListingsModule` (`@openlinker/core/listings/services`); bind in the API listings module; `@UseGuards(JwtAuthGuard)`.

### G. Frontend (#1044) — `apps/web/src/`

- **Plugin contribution**: add `shopProductPublishWizard: { platformType:'woocommerce', component: WoocommercePublishWizard }` to `plugins/woocommerce/index.ts` `build`. Extend `OpenLinkerPlugin.build` type (`shared/plugins/plugin.types.ts`) with the new optional contribution.
- **Resolver + app-binding**: `plugins/resolve-shop-publish-wizard.ts` (pure, mirrors `resolve-offer-creation-wizard.ts`) + `app/plugin-bindings/use-shop-publish-wizard.ts`.
- **Launcher + wizard**: `features/listings/components/ShopPublishLauncher.tsx` (Dialog + connection picker filtered by `status==='active' && enabledCapabilities.includes('ProductPublisher')`) + `features/listings/components/WoocommercePublishWizard.tsx` (content-only RHF+Zod form: variant id(s) (prefilled or picker — single or multi-select for bulk), `status` (draft/published toggle), `stock`, optional `price` override; idempotency key via `crypto.randomUUID()`). Far lighter than the offer wizard — categories/params are server-resolved.
- **API + hooks**: `features/listings/api/listings.api.ts` `shopPublish(...)` + `shopPublishBulk(...)` + `getShopPublishStatus(connectionId, recordId)` + `getBulkShopPublishBatch(batchId)`; types in `listings.types.ts`; `hooks/use-shop-publish-mutation.ts`, `use-bulk-shop-publish-mutation.ts`, `use-shop-publish-status-query.ts`, `use-bulk-shop-publish-batch-query.ts` (+ query keys). A `ShopPublishTracker` (single → per-record; bulk → `BulkListingBatch` counters, mirroring the bulk-offer tracker).
- **CTA**: a "Publish to shop" action on `pages/listings/listings-list-page.tsx` next to "Create offer", rendered only when ≥1 connection has `ProductPublisher` enabled; opens `ShopPublishLauncher`.

## 4. Step-by-step (each step = files + acceptance)

1. **WC publisher adapter + types** (`product-publisher/woocommerce-product-publish.adapter.ts`, `.types.ts`) — AC: `publishProduct` create+upsert build correct WC body; 4xx→`ProductPublishRejectedException`; `provisionCategory` find-or-creates root→leaf. Unit spec (http client mocked): create, upsert (PUT path), reject mapping, auth propagation, category find vs create.
2. **Manifest + dispatch wiring** (`woocommerce-plugin.ts`) — AC: manifest lists both caps; dispatch returns the adapter for both; `register` unchanged. Update `woocommerce-plugin.spec.ts`.
3. **Migration + `bulkBatchId` on the record** (`apps/api/src/migrations/*-add-bulk-batch-id-to-listing-creation-records.ts`; `listing-creation-record.{entity,orm-entity,types}.ts`; repo `create` input) — AC: nullable column + index; `migration:show` clean; record round-trips `bulkBatchId`. Repo spec.
4. **Payload V2** (`shop-job-payloads.types.ts`) — `ShopProductPublishPayloadV2` = V1 + `{schemaVersion:2, bulkBatchId}`.
5. **Core single-publish enqueue + status query service** (`product-publish-enqueue.service.ts` + interface + types + token; a thin `IListingCreationQueryService.getById`; module + barrels + barrel-purity spec) — AC: validates `'ProductPublisher'`, pre-creates record (optional `bulkBatchId`), enqueues V1/V2, returns ids. Unit specs.
6. **Core bulk submit service** (`bulk-shop-publish-submit.service.ts` + interface + types + token) — reuses `BulkListingBatchRepositoryPort`; persists batch, fans out through the single-publish enqueue primitive with `bulkBatchId`. AC: batch persisted with `totalCount`; N children enqueued; first-enqueue-failure marks batch failed. Unit spec.
7. **Worker advance** (`shop-product-publish.handler.ts`) — inject `BulkListingProgressService`; after `executePublish`, if payload has `bulkBatchId` call `advanceBatchStatus`. AC: single (no batch) unchanged; bulk child advances the counter once (at-most-once). Update handler spec.
8. **API controllers + DTOs** (`shop-publish.controller.ts`, `dto/*`, API listings module binding) — AC: 202 single + bulk; record GET; batch GET; capability 422 / connection 404; JwtAuthGuard. Controller spec.
9. **FE plugin contribution + resolver + binding** — AC: `usePlugins()` resolves the woocommerce publish wizard; pure resolver unit-tested.
10. **FE launcher + wizard + API/hooks + trackers + CTA** — AC: CTA hidden without a `ProductPublisher` connection; single + bulk submit → 202 → tracker(s) poll to terminal. Component tests (loading/error/submit/capability-gate/bulk).
11. **Quality gate + int-spec** — drive the real `WooCommerceProductPublisherAdapter` through enqueue→execute against a mocked WC HTTP layer (single + bulk-with-batch-advance); full `pnpm lint && type-check && test`; `migration:show`; **full** `pnpm test:integration` (capability-manifest ripple — run the whole suite, not just the new spec).

## 5. Validation / risks

- **Architecture**: adapter is pure transport (no core leak); enqueue service depends on ports + the existing job-enqueue port; controller validates at the boundary; FE respects `app→pages→features→shared` + plugin DI via `app/plugin-bindings/`.
- **Capability-manifest ripple** (memory: run the FULL int suite) — adding two manifest capabilities can ripple into capability-enumeration / routing int-specs; run `pnpm test:integration` in full, not just the new spec.
- **Migrations**: none — reuses the #1042 `listing_creation_records` table.
- **`platformParams` spread** is permissive; we whitelist nothing in MVP but never let it override the explicit fields (spread *before* the explicit keys).
- **Category provisioning** name-search exactness: WC `search` is fuzzy → exact name+parent match before reuse, else create (avoids mis-binding to a similarly-named category).

## 6b. Deep architecture analysis — bulk publish (the real fork)

**Question:** can a bulk shop-publish flow reuse the existing bulk-offer-creation ("bulk-listing") aggregate, or does it need a parallel stack? Mapped structurally:

| Component | Coupling to offers | Reusable for a 2nd child type? |
|---|---|---|
| `BulkListingBatch` entity/ORM/types | **None structural** — columns are `connectionId, initiatedBy, totalCount, succeededCount, failedCount, sharedConfig, status`. Offer link is only the `bulkBatchId` FK *on `offer_creation_records`*, not on the batch. Doc framing says "offer-creation attempts". | **Yes** — child-type-agnostic aggregate. |
| `BulkListingProgressService` | **None** — deps are `BulkListingBatchRepositoryPort` + `BulkBatchAdvancementRepositoryPort` only. `advanceBatchStatus(batchId, childRecordId, outcome)` works for any child; the `offerCreationRecordId` param is just a string id (cosmetic misnomer). | **Yes, as-is.** |
| `bulk_batch_advancements` (at-most-once gate) | **None** — keyed `(batchId, childRecordId)`. | **Yes, as-is.** |
| `BulkListingSubmitService` | **High** — injects `OfferCreationRecordRepositoryPort` + `IOfferCreationEnqueueService`; offer fan-out (multi-variant master-stock, V2 payload). | **No** — needs a sibling `BulkShopPublishSubmitService`. |
| `OfferCreationRecord` vs `ListingCreationRecord` | `OfferCreationRecord` has `bulkBatchId`; `ListingCreationRecord` (#1042) does **not**. | Needs a `bulkBatchId` column (migration) to attach publish children. |
| Worker progress advance | Fires after `marketplace.offer.create`; calls `advanceBatchStatus`. | Shop handler must call `advanceBatchStatus` when payload carries `bulkBatchId`. |

**Verdict.** The batch + progress + advancement layer is genuinely **child-type-agnostic by mechanism** — the offer coupling lives *only* in the submit service and in the child record carrying `bulkBatchId`. A clean "Option B" generalization therefore exists: one shared batch aggregate, a second submit service, a `bulkBatchId` column on `listing_creation_records` (migration), payload `V2`, and a worker advance call. ~70% of the bulk infra (batch, progress, advancement, retry-shape) reused unchanged.

**The three options, weighed:**
- **A — Thin loop.** Bulk endpoint calls the single-publish *enqueue primitive* N times → N records, no batch row; progress via per-record polling. Zero migration, zero new persistence. Meets the literal AC ("publish bulk … job progress visible" — visible per record). Loses the `23/50, 3 failed` rollup, batch retry, and `partially-failed` status. Fine for the modest N a fledgling WooCommerce publish path sees.
- **B — Reuse the aggregate.** Real aggregate progress + proven at-most-once advancement + consistent UX with bulk offers. Costs a migration (`bulkBatchId` + index on `listing_creation_records`), a `BulkShopPublishSubmitService`, `ShopProductPublishPayloadV2`, worker wiring, and an FE batch tracker — roughly **doubles** an already-large vertical (adapter + API + FE).
- **C — Defer bulk.** Smallest PR, but doesn't close #1044's AC.

**Recommendation: ship A, *designed for* B.** Make the single-publish `ProductPublishEnqueueService` the one per-child primitive (exactly as `OfferCreationEnqueueService` is the primitive both single and bulk-offer fan out through) and have the thin-loop bulk endpoint call it N times. This is **not throwaway**: when aggregate progress is wanted, B slots in by adding the `bulkBatchId` column + a `BulkShopPublishSubmitService` (fanning out through the *same* enqueue primitive) + the worker advance — the enqueue primitive and the adapter are unchanged. The structural commitment that keeps B cheap: **don't bake any bulk/batch assumption into the enqueue service**. The single migration B would later add is documented now so it isn't a surprise.

## Open questions (for the ⏸️ scope check)

1. **Bulk publish depth** — see §6b. Recommend **A (thin loop), designed so B (aggregate reuse) is a clean drop-in** — no throwaway work, no migration now.
2. **One PR vs split** — the user chose #1043+#1044 together → one PR. It's large but cohesive; flagging size.
3. **CTA placement** — listings-list-page actions (next to "Create offer"), gated on a `ProductPublisher` connection existing. Alternative: a per-product row action (heavier; needs a products surface).
