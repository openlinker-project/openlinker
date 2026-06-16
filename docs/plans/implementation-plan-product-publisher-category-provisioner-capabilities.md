# Implementation Plan — `ProductPublisher` + `CategoryProvisioner` capabilities (core)

**Issue:** #1041 · Part of #1005 (cross-platform listing) · ADR-024 §1, §2, §3
**Branch:** `1041-product-publisher-category-provisioner-capabilities`
**Layer:** CORE (listings + integrations + sync contract surface only)

---

## 1. Understand the task

Stand up the **contract surface** for shop-side product publishing — the keystone that
unblocks #1042 (execution service), #1043 (WooCommerce adapter), #1044 (API/FE). This is
the shop-listing sibling of the marketplace `OfferCreator` path (ADR-024).

Deliver:
- A base shop-listing **port** `ShopProductManagerPort` (`listings/domain/ports/`) — the
  structural sibling of `OfferManagerPort`, carrying the one mandatory shop verb
  `publishProduct(cmd)` — plus one **sub-capability** `CategoryProvisioner.provisionCategory(cmd)`
  + `isCategoryProvisioner` guard under `listings/domain/ports/capabilities/`.
- **Command/result + exception types**: `PublishProductCommand` / `PublishProductResult`
  (multi-category, draft/published status, owned-record fields, price/stock as fields,
  visibility); `ProvisionCategoryCommand` / `ProvisionCategoryResult`;
  `ProductPublishRejectedException`.
- Register `'ProductPublisher'` + `'CategoryProvisioner'` in `CoreCapabilityValues`.
- Register `'shop.product.publish'` in `JobTypeValues` + a `ShopProductPublishPayloadV1`
  payload type.
- Barrel exports (`listings/index.ts`, `sync/index.ts`).

**Non-goals (explicitly deferred to downstream issues):**
- No `ProductPublishExecutionService`, worker handler, or persistence (#1042).
- No WooCommerce adapter / manifest capability declaration (#1043).
- No API controllers / DTOs / FE wizard (#1044).
- No new DI **tokens** — capabilities are resolved through
  `IntegrationsService.getCapabilityAdapter<T>` + guards, not injected. Tokens land with
  the services in #1042. (The issue's "+ tokens" mention is satisfied at the service layer.)

**Acceptance (from #1041):** capabilities resolve via `getCapabilityAdapter` + guards; the
job type validates; barrels export cleanly; `pnpm type-check` green.

---

## 2. Research — patterns reused (verified in-repo)

| Concern | Precedent file |
|---|---|
| Capability interface + `is*` guard | `listings/domain/ports/capabilities/offer-creator.capability.ts`; shipping `dispatch-protocol-reader.capability.ts` |
| Command/result neutral types | `listings/domain/types/offer-create.types.ts` (`CreateOfferCommand/Result`) |
| Rejection exception | `listings/domain/exceptions/offer-create-rejected.exception.ts` |
| Capability-name registry | `integrations/domain/types/adapter.types.ts` (`CoreCapabilityValues`) |
| Job type + payload | `sync/domain/types/sync-job.types.ts` (`JobTypeValues`) + `marketplace-job-payloads.types.ts` |
| Resolve-then-guard usage | `offer-creation-execution.service.ts:106-110` — `getCapabilityAdapter<OfferManagerPort>(…, 'OfferManager')` then `isOfferCreator(adapter)` |

**Safety checks done:** no `Record<JobType>` / `Record<CoreCapability>` exhaustive maps and
no `assertNever` over job type / capability exist — both value additions are purely additive.
`CoreCapabilityValues` feeds connection DTOs (`@IsIn`) — adding values only widens what is
accepted (intended). The lone `assertNever` (`inbound-routing-policy.service.ts:157`) is over
`event.domain`, unaffected.

---

## 3. Design

### 3.1 Guard base-type decision — `ShopProductManagerPort` umbrella

**Decided (tech-review ruling + product owner):** introduce a base shop-listing port
`ShopProductManagerPort` as the structural **sibling of `OfferManagerPort`**, and make
`CategoryProvisioner` a sub-capability guarded against it — mirroring
`OfferManagerPort` + `isOfferCreator` exactly.

Rejected alternative (Option A, original plan): two independent capabilities with
`object`-param `is*` guards. Every one of the 20 capability guards in `libs/core` (16 in
`listings`, 4 in `shipping`) narrows from a concrete base port; an `object`-param guard would
be the first to break that invariant, and under by-name `getCapabilityAdapter<T>` resolution
it rarely even fires. The umbrella keeps the guard pattern uniform and scales as the shop side
grows more verbs (unpublish, `setVisibility`, status-read — ADR-024 §3 already foreshadows
visibility as a first-class axis).

**Shape (mirrors `OfferManagerPort`'s "one mandatory method + guarded sub-capabilities"):**
- `ShopProductManagerPort` carries the **one mandatory** shop-listing verb
  `publishProduct(cmd)` — the irreducible shop operation, exactly as `OfferManagerPort` carries
  the mandatory `updateOfferQuantity`. A truly empty umbrella base is rejected by
  `@typescript-eslint`'s no-empty-interface rule and would be a weaker model anyway.
- `CategoryProvisioner` is the sub-capability:
  `isCategoryProvisioner(adapter: ShopProductManagerPort): adapter is ShopProductManagerPort & CategoryProvisioner`.
- #1042's execution service resolves `getCapabilityAdapter<ShopProductManagerPort>(id, 'ProductPublisher')`
  and calls `isCategoryProvisioner(adapter)` to optionally provision — the exact resolve-then-guard
  shape used by `offer-creation-execution.service.ts:106-110`. The ADR-023 brain may resolve
  `getCapabilityAdapter<CategoryProvisioner>(id, 'CategoryProvisioner')` by name independently.

**Capability names (`CoreCapabilityValues`):** add `'ProductPublisher'` and `'CategoryProvisioner'`
per #1041. `'ProductPublisher'` is the operator/registry name that resolves a
`ShopProductManagerPort` (it is what a shop adapter declares and what #1044's FE CTA gates on).

**Documented consequence:** because `publishProduct` lives on the base port (mirroring
`updateOfferQuantity` on `OfferManagerPort`), there is **no `product-publisher.capability.ts`**
file, and the capability name `'ProductPublisher'` maps to interface `ShopProductManagerPort`
(the one name↔interface skew in the contract — every other core capability is name-aligned).
The skew is the cost of the umbrella and is documented in the `ShopProductManagerPort` header.

### 3.2 `PublishProductCommand` shape (ADR-024 §1, §3)

Expresses what `createOffer` cannot — multi-category, draft/published status, owned-record
content fields, price/stock as product fields, visibility — and omits offer-only concepts
(catalog-card link, required-param gate). Platform-specific fields ride in
`platformParams: Record<string, unknown>` (same escape hatch as `CreateOfferOverrides`).

```
PublishProductStatusValues = ['draft', 'published'] as const   // §3 visibility axis
PublishProductCommand {
  internalVariantId: string
  connectionId: string
  destinationCategoryIds: string[]          // multi-category (§ADR-024 Woo)
  price: { amount: number; currency: string }
  stock: number                              // price/stock as product fields
  status: PublishProductStatus               // draft | published (visibility decoupled from create)
  content?: PublishProductContent            // owned-record fields (named type, not inline)
  externalProductId?: string | null          // set → upsert; absent → create
  idempotencyKey?: string
  platformParams?: Record<string, unknown>   // projected attrs ride here (see note)
}
PublishProductContent {                      // extracted so the job payload can reference it
  title?: string                             // without indexed-access coupling
  description?: string | null
  imageUrls?: string[] | null
  seo?: { title?: string; description?: string | null; slug?: string }
}
PublishProductResult {
  externalProductId: string
  status: PublishProductStatus               // observed publication state after the call
  warnings?: string[]                         // non-fatal (optional-attr omissions etc.)
}
```

**Projected attributes are deliberately NOT a field on the command.** `ResolvedParameter`
lives in `listings/application/types/` — referencing it from a `domain/types/` command would
create a domain→application edge (hexagonal violation). The offer-side precedent confirms the
shape: `CreateOfferCommand` (domain) carries no `ResolvedParameter`; the builder applies
projected parameters (via `platformParams` / adapter-specific serialization). #1042's
`ProductPublishBuilderService` does the same for the shop path, so the keystone command stays
domain-pure and free of a premature near-duplicate.

### 3.3 `ProvisionCategoryCommand` shape (ADR-024 §2)

Mirror a source category path on the destination, create-if-missing (hierarchical), return
the destination id.

```
ProvisionCategoryCommand {
  connectionId: string
  path: { sourceCategoryId: string; name: string }[]   // root→leaf, mirrored/created in order
}
ProvisionCategoryResult {
  destinationCategoryId: string                          // resolved leaf id
  createdPath?: string[]                                  // ids of nodes created this call (observability)
}
```

> Naming note: ADR-024 §2's signature writes `CategoryProvisionResult`; the verb-first
> `ProvisionCategoryCommand`/`ProvisionCategoryResult` pair (matching `CreateOfferCommand/Result`)
> is used here — the ADR wording is the outlier and the file header records the alias.

### 3.4 `ProductPublishRejectedException`

Mirror `OfferCreateRejectedException` (adapterKey, statusCode, neutral message). Thrown by a
shop adapter when the platform rejects a publish and no record was created. Reuses
`CreateOfferValidationError` for the `errors[]` shape (no near-duplicate error type).

### 3.5 `ShopProductPublishPayloadV1` (sync)

New file `sync/domain/types/shop-job-payloads.types.ts` (shop ≠ marketplace taxonomy). Lean
wire shape carrying what #1042's execution service needs to rebuild a `PublishProductCommand`;
`connectionId` comes from `job.connectionId`, not the payload (matches
`MarketplaceOfferCreatePayloadV1`).

```
ShopProductPublishPayloadV1 {
  schemaVersion: 1
  internalVariantId: string
  status: PublishProductStatus
  stock: number
  price?: { amount: number; currency: string }
  destinationCategoryIds?: string[]
  content?: PublishProductContent
  idempotencyKey?: string
  listingCreationRecordId?: string            // optional; generalised record lands in #1042
}
```

### Layer compliance
Pure domain/contract types + interfaces; no framework imports, no I/O, no services. Cross-file
imports stay within `@openlinker/core/listings` (top-level barrel) and same-context relative
paths (`../../types/…`). `sync` payload value-imports `PublishProductStatus` from
`@openlinker/core/listings` (sync already cross-imports listings for `CreateOfferOverrides`).

---

## 4. Step-by-step implementation

| # | File | Action | Acceptance |
|---|---|---|---|
| 1 | `listings/domain/types/product-publish.types.ts` | **new** — `PublishProductStatusValues`/`PublishProductStatus`, `PublishProductContent`, `PublishProductCommand`, `PublishProductResult` | compiles; domain-pure (no application-layer imports) |
| 2 | `listings/domain/types/category-provision.types.ts` | **new** — `ProvisionCategoryCommand`, `ProvisionCategoryResult` | compiles |
| 3 | `listings/domain/ports/shop-product-manager.port.ts` | **new** — `ShopProductManagerPort` base port (mandatory `publishProduct`) | mirrors `offer-manager.port.ts`; header documents name↔interface skew |
| 4 | `listings/domain/ports/capabilities/category-provisioner.capability.ts` | **new** — `CategoryProvisioner` iface + `isCategoryProvisioner` | guard narrows `ShopProductManagerPort → … & CategoryProvisioner` |
| 5 | `listings/domain/exceptions/product-publish-rejected.exception.ts` | **new** — `ProductPublishRejectedException` | mirrors offer-create-rejected |
| 6 | `listings/index.ts` | **edit** — export port + capability/guard + 3 type groups + exception | barrel-purity spec stays green |
| 7 | `integrations/domain/types/adapter.types.ts` | **edit** — add `'ProductPublisher'`, `'CategoryProvisioner'` to `CoreCapabilityValues` | type-check green |
| 8 | `sync/domain/types/shop-job-payloads.types.ts` | **new** — `ShopProductPublishPayloadV1` | compiles |
| 9 | `sync/domain/types/sync-job.types.ts` | **edit** — add `'shop.product.publish'` to `JobTypeValues` (new `// Shop (cross-platform listing)` group) | type-check green |
| 10 | `sync/index.ts` | **edit** — export `ShopProductPublishPayloadV1` | barrel exports cleanly |

### Tests
- `listings/domain/ports/capabilities/__tests__/category-provisioner.capability.spec.ts` —
  guard true/false on a `ShopProductManagerPort` stub with/without `provisionCategory`
  (mirrors existing capability specs in `__tests__/`).
- `listings/domain/exceptions/__tests__/product-publish-rejected.exception.spec.ts` —
  locks the neutral message format (singular/plural error count), the structured fields, and
  the no-body-leak guarantee (added per the deep `/tech-review` coverage-parity suggestion).
- `integrations/domain/types/__tests__/adapter.types.spec.ts` — extend to assert the two new
  values are present in `CoreCapabilityValues` (file already exists).
- `sync/domain/types/*` — add a small spec asserting `'shop.product.publish'` ∈ `JobTypeValues`
  if a sibling spec convention exists; otherwise covered by type-check.

### Quality gate
`pnpm lint` · `pnpm type-check` · `pnpm test`. No migration (no ORM entity changed). No
integration tests (no adapter/handler in scope).

---

## 5. Validation

- **Architecture:** contract-only additions in the domain layer; honours CORE↔integration
  boundary (no adapter, no platform string). Capability-presence model preserved.
- **Naming:** `*.capability.ts` + `is{Capability}`, `*.types.ts`, `*.exception.ts` per
  engineering-standards.
- **`as const` unions:** `PublishProductStatusValues`, capability/job-type values all follow the
  runtime-array + derived-union rule.
- **Security:** no secrets; exception message carries no payload body (mirrors the
  offer-create-rejected precedent).
- **Risk:** very low — additive contract surface, no behavioural code path wired yet. A
  half-built capability is inert until #1042/#1043 bind an adapter + handler.
