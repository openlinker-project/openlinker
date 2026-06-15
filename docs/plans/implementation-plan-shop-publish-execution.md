# Implementation Plan — Shop publish execution service + neutral param channel (#1042 + #1072)

**Issues:** #1042 (execution service + worker handler + persistence) · #1072 (unify shop command onto neutral `OfferParameter` channel) · Part of #1005 · ADR-024
**Branch:** `1042-1072-shop-publish-execution`
**Layer:** CORE (listings application/domain/infrastructure) + sync contract + worker interface + a migration.

---

## 1. Understand the task

Build the **execution half** of the shop-publish vertical the #1041 capabilities (now on `main`) unblocked: a `shop.product.publish` job that publishes a master product onto a shop destination (WooCommerce, …) via `ShopProductManagerPort.publishProduct`. Bundled with #1072 — carry projected attributes on the command via the **typed neutral `OfferParameter` channel** (merged in #1039) instead of the `platformParams` interim I used in #1070.

**Deliver (the ADR-024 §Flow shop path):**
- Persistence: `listing_creation_records` table + `ListingCreationRecord` entity + repo port/impl + migration (a **sibling** of `offer_creation_records`, not a rename — keeps the hot offer path untouched).
- `ProductPublishBuilderService` — builds `PublishProductCommand` from (variant, connection, stock, status, price?, content?): resolve category (incl. open-provenance **provisioning**) + project attributes → `parameters: OfferParameter[]`, with a `business_failure` publish gate (mirrors `OfferBuilderService`).
- Fill the `CategoryResolutionService.tryProvision()` no-op seam: resolve `ShopProductManagerPort`, guard `isCategoryProvisioner`, `provisionCategory(sourcePath)`.
- `ProductPublishExecutionService` — load/create record → build command → resolve adapter (`getCapabilityAdapter<ShopProductManagerPort>(id,'ProductPublisher')`) → create-vs-upsert via `IdentifierMapping` → `publishProduct` → persist outcome (`ok | business_failure`), catching `ProductPublishRejectedException`.
- `ShopProductPublishHandler` worker handler + registration.
- **#1072**: add `parameters?: OfferParameter[]` to `PublishProductCommand` + `ShopProductPublishPayloadV1`; soften the `platformParams` JSDoc; the builder/execution produce the typed field from projection.

**Non-goals (explicit):**
- **WooCommerce adapter** (#1043) — no real `ShopProductManagerPort` implementation; this slice is verified against a **fake** shop adapter. Adapter-side param *shaping* (the remaining #1072 scope bullet) lands in #1043.
- **API controllers + FE wizard** (#1044).
- **Bulk** shop publish (reuse the neutral `BulkListing*` orchestration later).
- **Separate `VisibilitySetter` capability** — visibility is carried on the command's `status` (`draft|published`); `publishProduct` honours it. A decoupled set-visibility capability is deferred.
- **Multi-category beyond the primary** — resolve one destination category into the `destinationCategoryIds` array (single element); true multi-category is a follow-up.

---

## 2. Research — templates (verified in-repo, with file:line)

| Concern | Template |
|---|---|
| Execution service shape (deps, resolve+guard, record lifecycle, `business_failure` derivation, idempotent mapping) | `offer-creation-execution.service.ts` (constructor `:70-81`; resolve+guard `:106-114`; create `:118`; rejection catch `:120-129`; mapping `:132-144`; status update `:147-152`; outcome `:221-251`) |
| Builder + projection + publish gate | `offer-builder.service.ts` (projection call `:215-220`; Gate-2 required-param `:222-239`; command assembly `:149-172`) |
| Record entity/types/ORM/port/impl | `offer-creation-record.*` (entity, `offer-creation-record.types.ts`, `*.orm-entity.ts` `@Entity('offer_creation_records')`, port, repository `toDomain`/`buildOrmEntity` `:149-177`) |
| Migration | `1784000000000-add-offer-creation-records-table.ts`; **newest on main = `1805000000000` → use `1806000000000`** |
| Worker handler + registration | `marketplace-offer-create.handler.ts` (`execute` `:76-130`); `handler-registration.service.ts` (`:55-117`); `sync-worker.module.ts` providers `:54-76` |
| Category provisioning seam | `category-resolution.service.ts` (`tryProvision()` no-op `:124-136`, call site `:64`; already injects `IIntegrationsService` `:48`) |
| Neutral param channel | `offer-parameter.types.ts` (`OfferParameter`); `attribute-projection.types.ts:36` (`ResolvedParameter = OfferParameter`, alias); `project()` returns `parameters: ResolvedParameter[]` |
| Shop contract (#1041, on main) | `shop-product-manager.port.ts`, `product-publish.types.ts` (`PublishProductCommand` — no `parameters` field yet), `category-provisioner.capability.ts` (`isCategoryProvisioner`) |
| Identifier mapping | `identifier-mapping.service.ts` (`getExternalIds` `:85-93`, `createMapping` `:107-144`, `DuplicateIdentifierMappingError` idempotent path); `CORE_ENTITY_TYPE` (`:54-62` — **no shop-product type; add `ShopProduct`**) |
| Registry test (auto-covers new job type via `JobTypeValues` loop) | `sync-job-handler.registry.spec.ts:112-118` — no edit |
| jest-integration mapper guard | core-only handler → **no mapper edit** (`@openlinker/core/*` already mapped) |

---

## 3. Design

### 3.1 Persistence — sibling `listing_creation_records`
`ListingCreationRecord` mirrors `OfferCreationRecord` minus offer-only fields (no `classificationReport`, no `bulkBatchId` for MVP):
```
ListingCreationStatusValues = ['pending', 'draft', 'published', 'failed']   // shop lifecycle (no validating/active)
ListingCreationRecord { id, internalVariantId, connectionId, externalProductId|null,
                        status, errors|null, createdAt, updatedAt }
```
Errors reuse the neutral `OfferCreationError` shape (`{field?,code,message}`) — re-exported as `ListingCreationError` alias to avoid an offer-named import on the shop path. Repo port = the subset actually used: `create`, `findById`, `findLatestByVariantAndConnection`, `updateStatus`, `updateExternalIdAndStatus`, `findByExternalProductIdAndConnectionId`. ORM `@Entity('listing_creation_records')` with indexes `(internalVariantId, connectionId)`, `(connectionId)`, `(status)`, partial `(externalProductId, connectionId) WHERE externalProductId IS NOT NULL`. Migration `1806000000000`.

### 3.2 Create-vs-upsert mapping
Add `ShopProduct: 'ShopProduct'` to `CORE_ENTITY_TYPE` (additive). The execution service:
- `getExternalIds(ShopProduct, internalVariantId)` filtered to `connectionId` → if found, set `command.externalProductId` (upsert); else create.
- After `publishProduct`, `createMapping(ShopProduct, result.externalProductId, connectionId, internalVariantId)`, treating `DuplicateIdentifierMappingError` as an idempotent prior success (exact offer-path idiom).

### 3.3 `ProductPublishBuilderService`
Mirror `OfferBuilderService`:
- Fetch variant + master product (via `IProductsService` / `ProductMasterPort`), source categories (`getProductCategories`).
- **Resolve destination category — provisioning-only for MVP, in this builder (tech-review IMPORTANT):** resolve the destination `getCapabilityAdapter<ShopProductManagerPort>(connectionId, 'ProductPublisher')`; `if (isCategoryProvisioner(adapter) && sourceCategoryPath.length) destinationCategoryIds = [await adapter.provisionCategory({ connectionId, path })]`, where `path` (root→leaf `{sourceCategoryId,name}`) is built from the master product's `getProductCategories()`. No provisioner / no source categories → `destinationCategoryIds = []` (WooCommerce publishes uncategorised; not a gate failure). **Shop category-MAPPING fallback is deferred** to a follow-up — this PR does not touch the shared, marketplace-shaped `CategoryResolutionService`.
- Project attributes via `IAttributeProjectionService.project(...)` → `parameters: OfferParameter[]`; Gate on `unresolvedRequired` (shop has no offer/product section gate split — treat all `unresolvedRequired` as blocking unless operator-supplied). Validation failures throw a neutral `ProductPublishBuilderValidationException` (do **not** reuse the offer-named `OfferBuilderValidationException`).
- Assemble `PublishProductCommand` incl. `parameters`, `destinationCategoryIds`, price/stock/content/status. **No `platformParams` for attributes.**

> **Dropped from the original plan (tech-review):** filling `CategoryResolutionService.tryProvision()` + extending `CategoryResolutionInput.sourceCategoryPath`. That service resolves `'OfferManager'` and runs on every marketplace offer creation (the hot #824 path); wiring shop provisioning there would throw+catch a wrong-capability resolution per offer and introduce a capability-name branch. Provisioning lives in the shop builder instead; the shared service is left untouched.

### 3.4 `ProductPublishExecutionService`
Deps: `ProductPublishBuilder`, `ListingCreationRecordRepo`, `IIdentifierMappingService`, `IIntegrationsService`. Flow (mirrors offer execution, minus poll/classification):
load/create record (`pending`) → **resolve create-vs-upsert**: `getExternalIds(ShopProduct, internalVariantId)` **filtered by `connectionId`** → set `command.externalProductId` when found (the reverse lookup is `(entityType, internalId)`-keyed, NOT connection-scoped, so the filter is mandatory) → build command (catch `ProductPublishBuilderValidationException` → `failed`/`business_failure`) → resolve `getCapabilityAdapter<ShopProductManagerPort>(connectionId, 'ProductPublisher')` (no extra guard — `ProductPublisher` *is* the base port) → `publishProduct` (catch `ProductPublishRejectedException` → `failed`/`business_failure`) → **on first publish only** `createMapping(ShopProduct, externalProductId, connectionId, internalVariantId)` catching `DuplicateIdentifierMappingError` as the idempotent-retry path (skip `createMapping` on upsert — mapping exists) → `updateExternalIdAndStatus(record, externalProductId, status)` → outcome (`published|draft → ok`; `failed → business_failure`).

> **Concurrency note (document in the service header):** two concurrent *first* publishes of the same variant create two distinct shop products (shop create is not platform-idempotent; the mapping records one). Bounded by the job-level `idempotencyKey` dedup (#726 at-most-once) — the enqueue gate is the guard, not a DB constraint.

### 3.6 #1072 contract edits
- `product-publish.types.ts`: add `parameters?: OfferParameter[]` to `PublishProductCommand`; reword the `platformParams` JSDoc to "un-modeled shop knobs only (NOT category parameters — those travel on `parameters`)".
- `shop-job-payloads.types.ts`: add `parameters?: OfferParameter[]` to `ShopProductPublishPayloadV1`.

### Layer compliance
All new domain types/ports framework-free; services in `application/services`, each backed by an `I*Service` interface (per `check-service-interfaces`); ORM only in `infrastructure/persistence`; `OfferParameter` is domain (no domain→application edge); cross-context imports via top-level barrels; tokens in `listings.tokens.ts` (`export *`).

---

## 4. Step-by-step implementation

| # | File | Action |
|---|---|---|
| 1 | `identifier-mapping/domain/types/identifier-mapping.types.ts` | **edit** — add `ShopProduct: 'ShopProduct'` to `CORE_ENTITY_TYPE` |
| 2 | `listings/domain/types/listing-creation-record.types.ts` | **new** — `ListingCreationStatusValues`/`Status`/`LISTING_CREATION_STATUS`, `ListingCreationError` (alias of `OfferCreationError`), `CreateListingCreationRecordInput` |
| 3 | `listings/domain/entities/listing-creation-record.entity.ts` | **new** — immutable record entity |
| 4 | `listings/domain/ports/listing-creation-record-repository.port.ts` | **new** — 6-method port |
| 5 | `listings/infrastructure/persistence/entities/listing-creation-record.orm-entity.ts` | **new** — `@Entity('listing_creation_records')` |
| 6 | `listings/infrastructure/persistence/repositories/listing-creation-record.repository.ts` | **new** — impl + `toDomain`/`buildOrmEntity` |
| 7 | `listings/domain/types/product-publish.types.ts` | **edit (#1072)** — add `parameters?: OfferParameter[]`; reword `platformParams` JSDoc |
| 8 | `listings/application/types/product-publish-builder.types.ts` | **new** — `BuildPublishProductCommandInput` |
| 9 | `listings/application/interfaces/product-publish-builder.service.interface.ts` | **new** — `IProductPublishBuilderService` |
| 10 | `listings/application/services/product-publish-builder.service.ts` | **new** — builder |
| 11 | `listings/application/types/product-publish-execution.types.ts` | **new** — `ExecutePublishInput`/`Result` |
| 12 | `listings/application/interfaces/product-publish-execution.service.interface.ts` | **new** — `IProductPublishExecutionService` |
| 13 | `listings/domain/exceptions/product-publish-builder-validation.exception.ts` | **new** — neutral `ProductPublishBuilderValidationException` (+ `ProductPublishBuilderValidationIssue`) |
| 14 | `listings/application/services/product-publish-execution.service.ts` | **new** — execution service (incl. connection-scoped create-vs-upsert lookup) |
| 15 | `listings/listings.tokens.ts` | **edit** — `LISTING_CREATION_RECORD_REPOSITORY_TOKEN`, `PRODUCT_PUBLISH_BUILDER_SERVICE_TOKEN`, `PRODUCT_PUBLISH_EXECUTION_SERVICE_TOKEN` |
| 16 | `listings/listings.module.ts` | **edit** — ORM `forFeature`, 3 providers + token bindings + exports |
| 17 | `listings/index.ts` | **edit** — export entity, types, repo port, builder/execution interfaces + IO types + the new exception |
| 18 | `sync/domain/types/shop-job-payloads.types.ts` | **edit (#1072)** — add `parameters?: OfferParameter[]` |
| 19 | `apps/api/src/migrations/1806000000000-add-listing-creation-records-table.ts` | **new** — table + indexes (`up`/`down`) |
| 20 | `apps/worker/src/sync/handlers/shop-product-publish.handler.ts` | **new** — `SyncJobHandler`, validate `ShopProductPublishPayloadV1`, call execution service |
| 21 | `apps/worker/src/sync/handlers/handler-registration.service.ts` | **edit** — register `'shop.product.publish'` |
| 22 | `apps/worker/src/sync/sync-worker.module.ts` | **edit** — add handler provider |
| 23 | `listings/__tests__/barrel-purity.spec.ts` | **edit** — add the 2 new service classes to the FORBIDDEN list |

### Tests
- `product-publish-execution.service.spec.ts` — happy publish (create + upsert), `ProductPublishRejectedException` → `business_failure`, builder-validation → `business_failure`, idempotent mapping. **Fake `ShopProductManagerPort` adapter** (satisfies #1042's "fake shop adapter" AC at unit-vertical level).
- `product-publish-builder.service.spec.ts` — projection→`parameters`, category-unresolved gate, content/price fallback.
- `category-resolution.service.spec.ts` — extend: provision path (provisioner present → id+`open`; absent → fall through).
- `shop-product-publish.handler.spec.ts` — payload validation + delegation + outcome passthrough.
- **Integration test (real, per #1042 AC)** — `apps/api/test/integration/listings/shop-product-publish.int-spec.ts`: boot the Nest app (real Postgres via the shared harness), register a **fake `ShopProductManagerPort`** through the public `AdapterRegistryService` + `AdapterFactoryResolverService` seams (the `allegro-prestashop-carrier-mapping.int-spec.ts` pattern), invoke `ProductPublishExecutionService.executePublish(...)` from the container, and assert: a `listing_creation_records` row persisted with `status='published'` + the correct `externalProductId`; the `ShopProduct` identifier mapping created; re-running upserts (no duplicate row/mapping); a rejecting fake adapter yields `outcome='business_failure'` + a `failed` record. Covers persistence + execution + fake adapter end-to-end.

### Quality gate
`pnpm lint` (+ invariants: migration-timestamp ordering, service-interfaces, cross-context) · `pnpm type-check` · `pnpm test`. Migration: `pnpm --filter @openlinker/api migration:show`.

---

## 5. Validation & risks

- **Architecture:** core-only; honours CORE↔integration boundary (no platform string anywhere); resolve-then-guard; `OfferParameter` keeps the command domain-pure.
- **Migration:** sibling table (no touch to `offer_creation_records`); synthetic prefix `1806000000000` > main tail `1805…` (ordering invariant).
- **#1072 closure (tech-review ruling):** ship as **`Closes #1042`, `Part of #1072`**. #1072's scope explicitly names the WooCommerce adapter (#1043) as "the sole shaper" and lists #1043 as a dependency, so the channel-establishing + execution-production half lands here but #1072 stays open until #1043 ships the adapter shaping.
- **Risks / size:** large but de-risked by the tech-review — the only edit to a shared hot path (the `category-resolution.service` `tryProvision` fill) was **dropped**; provisioning now lives in the new shop builder, so no existing marketplace code path changes behaviour. Remaining watch-item: the `CORE_ENTITY_TYPE.ShopProduct` addition (additive — keep the `CoreEntityTypeValues` array and the `satisfies Record<CoreEntityType,…>` guard in lockstep). The #1042 Testcontainers **integration test** is **in scope** (see Tests) — exercises the execution service + real `listing_creation_records` persistence against a fake shop adapter via the app harness.
