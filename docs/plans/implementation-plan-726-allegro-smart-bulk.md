> ⚠️ **PRE-REFINEMENT DRAFT — NOT AN AUTHORITATIVE PLAN**
>
> This document was produced **before** OpenLinker's [two-tier refinement workflow](../contributors/refinement-workflow.md) was introduced. It mixes product reasoning (what/who/why) and technical design (how) without proper Tier 1 (product) refinement.
>
> **Current role:** input for Phase B (Evidence) of `/refine-product 726`. The codebase audit and Allegro Smart! research below remain useful reference material. The product scope decisions (8-step wizard, 100-product batch size, AI description toggle, etc.) are **hypotheses to be validated, not commitments**.
>
> **Authoritative artifacts will be:**
> - Product spec at `docs/specs/product-spec-726-{slug}.md` (output of Tier 1, in progress)
> - Implementation plans at `docs/plans/implementation-plan-{child-issue-N}-*.md` (output of Tier 2 per implementation issue, after Tier 1 completes)
>
> Once those artifacts exist and the spec is locked, this file should be either archived to `docs/plans/archive/` with a pointer to the authoritative replacement, or deleted if it adds no remaining reference value.

---

# Implementation Plan — #726 Allegro Smart! support + Bulk listing creation (PRE-REFINEMENT DRAFT)

**Issue:** [#726](https://github.com/SilkSoftwareHouse/openlinker/issues/726) — Discovery & refinement (converting to Product Design)
**Layer:** Integration (`libs/integrations/allegro`) + Application (`libs/core/src/listings`) + Frontend (`apps/web`)
**Branch (this discovery doc):** `726-allegro-smart-bulk-refinement`
**Status:** ⚠️ Pre-refinement draft — supersedes by `docs/specs/product-spec-726-{slug}.md` once Tier 1 refinement completes.

---

## 1. Goal

Two related but distinct capabilities that this plan treats as **separate features sharing a single bulk wizard**:

### Feature A — Bulk offer creation

Allow operators to select N products from the connected shop catalog (PrestaShop today) and create Allegro offers for all of them in one workflow, with shared category/parameters/policies and per-product overrides.

### Feature B — Allegro Smart! eligibility

Make offers created by OpenLinker eligible for the **Allegro Smart!** program (free shipping for buyers subscribed to Smart!). Smart! eligibility is **not a separate API call** — it follows from the offer's delivery method configuration. The feature is therefore "make Smart-eligible delivery methods first-class in the wizard, validate eligibility before submit".

### In scope (v1)

**Bulk:**
- Multi-select from PrestaShop catalog (10–100 products per batch)
- Shared category + shared parameters per batch, with per-product preview/override
- Shared price strategy (copy from shop / fixed markup % / fixed value)
- Per-product AI-generated description (reuse `ContentSuggestionService` infrastructure, channel `allegro`)
- Job-based async submission via existing `marketplace.offer.create` handler
- Bulk progress view: per-product status (pending / running / success / failed) with retry per-failure
- Idempotency: same product+connection in same batch is deduped

**Smart!:**
- Wizard surface for selecting a Smart-eligible **delivery profile** (existing Allegro seller policy)
- Pre-submit validation that the selected delivery profile is Smart-eligible
- Display Smart eligibility status per offer in the bulk progress view (post-create)

### Non-goals (v1)

- CSV import — use shop catalog only
- Promoted offers ("wyróżnione")
- Bulk price/stock updates of **existing** offers (separate feature — see [`OfferQuantityBatchUpdater`](../engineering-standards.md#sub-capabilities) for related primitive)
- Bulk de-listing / archiving
- Variation explosion — v1 collapses one shop product into one Allegro offer (using Allegro's variant matrix); separate-offer-per-variant is v2
- Seller-account-level Smart! enrollment management (Allegro handles this; OL doesn't manage seller subscriptions)
- Cross-marketplace bulk listing (only Allegro in v1; future: Amazon, eBay)
- Custom invoice numbering / fiscal handling in bulk flow — covered by #728 (Subiekt integration), orthogonal

---

## 2. What is Allegro Smart!? (research findings)

This section is the **discovery output** — it codifies what we now believe about the Smart! program so future work doesn't re-research it.

### Buyer-side

- Allegro Smart! is a paid subscription for buyers (~59 zł/year as of 2026; pricing per Allegro's product page).
- Subscribers get free shipping on eligible orders above a threshold (typically 45 zł).
- Smart! works across pick-up methods: paczkomat (InPost), Allegro ONE Box, courier, ORLEN Paczka, partner pickup points.

### Seller-side eligibility

- Sellers do **not** pay extra to be in Smart!.
- Eligibility per offer is determined automatically by Allegro based on the offer's **delivery method configuration**:
  - The offer must offer at least one Smart!-eligible delivery method
  - The buyer-facing shipping cost on that method (for Smart subscribers) must be 0 zł
  - The offer must be on allegro.pl (not allegro.cz / allegro.sk / etc.)
- Smart!-eligible delivery methods are configured by the seller in their **delivery configurations** ("Cenniki dostawy") in Allegro seller panel. Each delivery configuration is a named bundle (e.g. "Standard PL", "Premium PL Smart") that maps methods to prices.
- A delivery configuration is Smart!-eligible if it satisfies Allegro's rules — typically by including InPost paczkomaty at 0 zł above 45 zł (or similar).
- Offers reference a delivery configuration by ID; that ID's Smart! eligibility flows through automatically.

### Allegro API surface

- `GET /sale/delivery-methods` — list of delivery methods supported by the seller's account
- `GET /sale/shipping-rates` — seller's named shipping-rate tables (delivery configurations)
- `POST /sale/product-offers` — the offer body's `delivery.shippingRates.id` references one
- Smart! eligibility is **not directly settable** on the offer; it's a derived property of the delivery configuration.

### What this means for OpenLinker

- We don't need a "make this offer Smart!" toggle. We need a **delivery configuration picker** in the wizard.
- For Smart! support we need:
  1. List the seller's shipping rates via the existing `SellerPoliciesReader` capability (`fetchSellerPolicies()` already exists on the Allegro adapter).
  2. Surface the picker in the bulk wizard with a "Smart!-eligible" badge per option.
  3. (Future) Compute Smart! eligibility client-side from the rate's contents — but for v1, trust Allegro's classification at create time and read it back post-create.

### Open question to validate in discovery interview

- How do sellers identify which of their delivery configurations is "Smart!-eligible" today? Does Allegro return a flag, or do sellers know by naming convention? **Action: probe Allegro API response shape from `fetchSellerPolicies()` first; if no flag, defer Smart! badging to v2 and rely on seller knowing their own config names.**

---

## 3. Current state (what already exists)

This section codifies the audit done as part of this refinement so implementation work doesn't need to re-discover.

### Single-offer creation pipeline — fully exists

- **`OfferBuilderService`** (`libs/core/src/listings/application/services/offer-builder.service.ts:51`) — composes `CreateOfferCommand` from variant → product → category → price → images
- **`OfferCreationExecutionService`** (`libs/core/src/listings/application/services/offer-creation-execution.service.ts:79`) — orchestrates: load-or-create `OfferCreationRecord`, build command, call `OfferCreator.createOffer`, persist mapping, schedule status poll, map outcome to `'ok' | 'business_failure'`
- **`OfferCreator` capability** (`libs/core/src/listings/domain/ports/capabilities/offer-creator.capability.ts:17`): `createOffer(cmd: CreateOfferCommand): Promise<CreateOfferResult>`
- **`OfferCreationRecord`** (`libs/core/src/listings/domain/entities/offer-creation-record.entity.ts:17`) — status (`pending|active|draft|validating|failed`), errors[], request snapshot

### Job execution — fully exists

- **`marketplace.offer.create` handler** (`apps/worker/src/sync/handlers/marketplace-offer-create.handler.ts:42`) — accepts `MarketplaceOfferCreatePayloadV1`, calls `OfferCreationExecutionService.executeCreation`, maps outcome to `SyncJobHandlerResult`
- **`SyncJob` outcome field** (`libs/core/src/sync/infrastructure/persistence/entities/sync-job.orm-entity.ts:42`) — `'ok' | 'business_failure' | null`

### Fan-out pattern — exists as blueprint

- **`MasterProductSyncAllHandler`** (`apps/worker/src/sync/handlers/master-product-sync-all.handler.ts:52`) — paginates external IDs, fans out per-product sub-jobs via `Promise.allSettled`, tolerates partial failure, dedupes via idempotency key `master:{connectionId}:product:sync:{externalId}:{job.id}`
- This is the **template for bulk offer creation**.

### AI description generation — exists for product content, not yet for offer creation

- **`ContentSuggestionService.suggestDescription(cmd)`** (`libs/core/src/content/application/services/content-suggestion.service.ts:52`) — renders template `offer.description.suggest` channel-scoped, calls `AiCompletionPort.complete`
- **Templates seeded** for channels `prestashop` and `allegro` (#451 / #452)
- **Multi-provider router** through `AiCompletionPort` (Anthropic / OpenAI), prompt caching supported
- **Not yet wired** into single-offer wizard or bulk wizard

### EAN smart-linking — exists, **unrelated to "Allegro Smart!"**

- **`resolveAllegroProductCardByEan`** (`libs/integrations/allegro/src/infrastructure/util/resolve-allegro-product-card-by-ean.ts`, #431) — EAN-based lookup of existing Allegro product cards
- This is purely a cost-optimization (avoid re-creating product cards). **It is NOT the Allegro Smart! program** despite the name overlap.

### PrestaShop catalog reading — exists

- **`PrestashopProductMasterAdapter.getProducts(filters)`** (`libs/integrations/prestashop/src/infrastructure/adapters/prestashop-product-master.adapter.ts:93`) — supports `limit`, `offset`
- No FE bulk-picker endpoint exposed at the API layer yet

### CreateOfferWizard FE — single-product only

- **`useCreateOfferMutation`** (`apps/web/src/features/listings/hooks/use-create-offer-mutation.ts:21`) — accepts single `CreateOfferRequest`
- **Form schema** at `apps/web/src/features/listings/components/create-offer-fields.schema.ts`
- No multi-product flow exists

### Verdict

- **All atomic primitives needed for bulk creation exist.** Bulk is a composition feature — fan-out handler + FE wizard + new shared-overrides envelope. No new ports needed.
- **Smart! support is a thin layer on top of existing `SellerPoliciesReader` capability** — surface seller's shipping rates in the wizard, validate selection before submit.

---

## 4. Design

### 4.1 Architectural shape — bulk creation

**The bulk feature lives at the application layer**, not as a new adapter capability. The Allegro adapter remains a per-offer worker. The composition happens above it.

```
┌─────────────────────────────────────────────────────────────────┐
│ FE: BulkCreateOfferWizard (apps/web)                            │
│ ├─ Step 1: Pick connection (Allegro)                            │
│ ├─ Step 2: Pick source shop + multi-select products             │
│ ├─ Step 3: Shared category + parameters                         │
│ ├─ Step 4: Shared delivery config + Smart! validation           │
│ ├─ Step 5: Shared price strategy + per-product preview          │
│ ├─ Step 6: AI description toggle + bulk preview                 │
│ └─ Step 7: Submit → POST /listings/bulk-create                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ API: POST /listings/bulk-create                                 │
│ ├─ Validate body (connection capability, products exist, etc.)  │
│ ├─ Create BulkOfferCreationBatch record                         │
│ ├─ For each selected product:                                   │
│ │   └─ Enqueue marketplace.offer.create job with               │
│ │      MarketplaceOfferCreatePayloadV1 + batchId reference     │
│ └─ Return batchId + per-product jobIds                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Worker: marketplace.offer.create handler (UNCHANGED)            │
│ └─ OfferCreationExecutionService.executeCreation                │
│     └─ Allegro adapter.createOffer                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ FE: BulkProgressView (polls GET /listings/bulk-create/:batchId) │
│ └─ Per-product status, retry per-failure                        │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 New domain entity — `BulkOfferCreationBatch`

Lives in `libs/core/src/listings/domain/entities/bulk-offer-creation-batch.entity.ts`.

```typescript
export class BulkOfferCreationBatch {
  constructor(
    public readonly id: string,                   // ol_batch_*
    public readonly connectionId: string,
    public readonly initiatedBy: string,          // userId
    public readonly status: BulkBatchStatus,      // pending | running | completed | partially-failed
    public readonly totalCount: number,
    public readonly succeededCount: number,
    public readonly failedCount: number,
    public readonly sharedConfig: BulkSharedConfigSnapshot,  // category, params, delivery, pricing
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}
}
```

The batch is **denormalized rollup view** of per-offer `OfferCreationRecord`s. Linkage: each `OfferCreationRecord` gets a new optional `bulkBatchId` foreign-key column.

**Why a batch entity (not just query-time aggregation):**
- Stores the shared-config snapshot (operator chose category X at time of submit; that's the source of truth even if shop category later changes)
- Enables "retry whole batch" or "retry only failed" without re-collecting shared config
- Simpler progress UX for FE (one entity to poll vs N records to aggregate)

### 4.3 No new capability port

Bulk operates at the **application layer** by enqueueing N standard `marketplace.offer.create` jobs. The Allegro adapter never knows about "bulk". This means:
- Future marketplace adapters (Shopify, Amazon) get bulk for free once they implement `OfferCreator`
- No new sub-capability needed
- No changes to plugin SDK

**Decision recorded in [ADR-XXX: Bulk creation as application-layer fan-out, not adapter capability]**.

### 4.4 Allegro Smart! — surface via existing `SellerPoliciesReader`

- `AllegroOfferManagerAdapter` already implements `SellerPoliciesReader.fetchSellerPolicies()`
- We extend the response (or add a sibling call) to include the seller's **shipping rates** (`GET /sale/shipping-rates`), exposing each rate's id, name, and (if Allegro returns it) a `smartEligible: boolean` flag
- FE wizard renders the picker; on submit, FE includes `deliveryShippingRatesId` in `CreateOfferRequest.overrides`
- The existing `OfferBuilderService` passes this through `platformParams` opaque field to the adapter; the Allegro adapter applies it to the offer body's `delivery.shippingRates.id`

**Decision recorded in [ADR-XXX: Allegro Smart! surfaced through delivery configuration, not as a separate offer field]**.

### 4.5 AI description generation — wire `ContentSuggestionService` into bulk submit

For each selected product, the bulk submit path optionally generates a description via the existing service before calling the offer creation flow. Two implementation options — picked at design phase below:

- **Option A — Generate in API before enqueuing**: API call → for each product, call `ContentSuggestionService` → write generated description into `MarketplaceOfferCreatePayloadV1.overrides.description` → enqueue jobs. Pro: simple, description present in job payload at enqueue time. Con: API request hangs for 100 × ~3s AI calls = 5 min (unacceptable).
- **Option B — Generate inside the worker job**: API enqueues jobs without description. Each worker job, if "generate description" flag set, calls `ContentSuggestionService.suggestDescription` before `executeCreation`. Pro: parallelized across worker instances, no API timeout. Con: requires `ContentSuggestionService` reachable from worker module (currently lives in API).
- **Option C — Separate pre-generation jobs**: API enqueues `content.description.generate` jobs that write to product content table, then enqueues `marketplace.offer.create` jobs that read from there. Pro: clean separation. Con: extra job type, extra latency, content table churn.

**Recommendation: Option B.** Move `ContentSuggestionService` registration to a shared module consumed by both API and worker (it has no DI dependencies that conflict). Worker handler reads `generateDescription: boolean` from new field on `MarketplaceOfferCreatePayloadV2`, calls the service if set, falls through to the existing `OfferBuilderService` flow.

**Decision recorded in [ADR-XXX: AI description generation runs in worker, not API, to avoid API timeouts on large batches]**.

### 4.6 Variation handling — collapse to Allegro variant matrix (v1)

A PrestaShop product with N variants today creates one Allegro offer when listed via the single-offer flow. The Allegro adapter already accepts a "variant matrix" structure that maps shop variants to Allegro variant parameters.

In bulk v1, we keep this behavior: **1 shop product = 1 Allegro offer with internal variants**. This means a 100-product batch creates exactly 100 jobs, not 100 × avg-variant-count.

**Open question for discovery: does any agency need to split variants into separate Allegro offers?** Flag for v2 — separate sub-capability `OfferCreator.createOfferPerVariant` could be added later.

### 4.7 Idempotency

Bulk batch identity:
- Batch ID: `ol_batch_*` generated on submit
- Per-job idempotency key: `bulk:{batchId}:variant:{internalVariantId}` (deterministic — re-submitting the same batch is a no-op via Redis dedup + Postgres `sync_jobs.idempotency_key` unique constraint)

Re-submit / retry semantics:
- **Retry single failed offer**: re-enqueue with same idempotency key — gated by existing dedup; allowed only if previous outcome was `business_failure` or `dead`
- **Retry whole batch**: re-enqueues only failed children; reuses batch entity; uses existing `SyncJobBulkRetryService` infrastructure

### 4.8 Progress reporting

- FE polls `GET /listings/bulk-create/:batchId` every 5s
- Endpoint returns batch entity + array of per-job summaries (status, error message, externalOfferId if succeeded)
- No streaming/SSE in v1 (FE polling is sufficient for batches up to ~200 products)
- For batches > 200: API returns paged results; FE shows aggregate counts only

### 4.9 Shared config envelope

```typescript
// libs/core/src/listings/application/dto/bulk-offer-creation.dto.ts
export interface BulkOfferCreateRequest {
  connectionId: string;
  productIds: string[];                           // internal product IDs, 1..100
  sharedConfig: {
    categoryId: string;                           // Allegro category
    parameters: AllegroParameterValue[];          // shared params (brand, etc.)
    deliveryShippingRatesId: string;              // selected delivery config
    pricingStrategy: PricingStrategy;             // copy | markup-pct | fixed
    pricingValue: number;                         // % or PLN depending on strategy
    publishImmediately: boolean;
    generateDescription: boolean;                 // toggle for AI
    descriptionTone?: string;                     // optional, passed to ContentSuggestion
  };
  perProductOverrides?: Record<string, Partial<CreateOfferOverrides>>;  // by productId
}
```

API validates: products belong to a shop connection of the operator, all variants are in master catalog (auto-match if not — separate issue), Allegro connection has `OfferCreator` capability.

---

## 5. UX flow

(Wireframes to be produced separately — see [Open question §7.3].)

### 5.1 Bulk wizard steps

1. **Entry point**: "Create offers in bulk" button on Listings page
2. **Step 1 — Source**: pick PrestaShop connection (if multiple)
3. **Step 2 — Products**: paginated multi-select of shop products (with search, category filter, image preview); selection limit 100 per batch in v1; counter shows "X / 100"
4. **Step 3 — Allegro target**: pick Allegro connection (if multiple)
5. **Step 4 — Category & parameters**: pick Allegro category (reuse existing `CategoryBrowser` UI from single-offer wizard); fill shared parameters (brand, etc.); per-product params can be edited in preview step
6. **Step 5 — Delivery & Smart!**: pick delivery shipping rate; show Smart!-eligible badge if API returns flag; warn if non-Smart-eligible rate selected
7. **Step 6 — Pricing**: pick strategy (copy from shop / markup % / fixed); preview per-product final price
8. **Step 7 — Description**: toggle "Generate descriptions with AI"; optional tone hint
9. **Step 8 — Review & submit**: per-product summary table with edit-this-row affordance; submit → API call → redirect to batch progress view

### 5.2 Progress view

- Header: batch status (running / completed / partially-failed), counters
- Per-product table: product name, status badge, externalOfferId (if success), error message (if failed), action menu (retry / view in Allegro)
- "Retry all failed" button if any failed
- Auto-refresh every 5s while batch is `running`

---

## 6. Implementation increments

Each increment is independently shippable and reviewable. Increment numbering aligns to issues created in §9.

### Increment 1 — Domain entities + repository (Week 1)

**Files:**
- `libs/core/src/listings/domain/entities/bulk-offer-creation-batch.entity.ts` (NEW)
- `libs/core/src/listings/domain/types/bulk-offer-creation.types.ts` (NEW — `BulkBatchStatus`, `BulkSharedConfigSnapshot`)
- `libs/core/src/listings/domain/ports/bulk-offer-creation-batch-repository.port.ts` (NEW)
- `libs/core/src/listings/infrastructure/persistence/entities/bulk-offer-creation-batch.orm-entity.ts` (NEW)
- `libs/core/src/listings/infrastructure/persistence/repositories/bulk-offer-creation-batch.repository.ts` (NEW)
- `libs/core/src/listings/listings.tokens.ts` (UPDATE — add `BULK_OFFER_CREATION_BATCH_REPOSITORY_TOKEN`)
- `apps/api/src/migrations/{timestamp}-add-bulk-offer-creation-batch.ts` (NEW migration)
- Adds optional `bulkBatchId` column to existing `offer_creation_records` table

**Acceptance:**
- Migration up + down round-trips cleanly
- Repository unit-spec tested
- Token exported via `@openlinker/core/listings`

**Effort:** S (3-5 days)

### Increment 2 — Bulk submission service + API (Week 2)

**Files:**
- `libs/core/src/listings/application/services/bulk-offer-creation-submit.service.ts` (NEW)
- `libs/core/src/listings/application/services/bulk-offer-creation-submit.service.interface.ts` (NEW)
- `libs/core/src/listings/application/dto/bulk-offer-creation.dto.ts` (NEW — request DTO)
- `apps/api/src/listings/http/bulk-offer-creation.controller.ts` (NEW)
  - `POST /listings/bulk-create` → returns `{ batchId, jobIds }`
  - `GET /listings/bulk-create/:batchId` → returns batch + per-record summaries
- `apps/api/src/listings/http/dto/bulk-create-offer-request.dto.ts` (NEW)

**Behavior:**
- Validates: connection has `OfferCreator` capability, product IDs belong to a shop connection owned by operator, batch size ≤ 100
- Creates `BulkOfferCreationBatch` record (status=pending)
- For each productId, resolves variants via `ProductRepository.findVariantsByProductId`, enqueues one `marketplace.offer.create` job per variant with `bulkBatchId` in payload metadata
- Returns 202 Accepted with batchId

**Acceptance:**
- Unit specs for service (validation, enqueue ordering, batch-record creation)
- Integration spec end-to-end via Testcontainers (real Postgres + Redis Streams)
- `@Roles('admin')` enforced on both endpoints

**Effort:** M (5-7 days)

### Increment 3 — Worker handler extension for bulk-batch awareness + AI description (Week 3)

**Files:**
- `apps/worker/src/sync/handlers/marketplace-offer-create.handler.ts` (UPDATE)
  - Accept `MarketplaceOfferCreatePayloadV2` (adds `bulkBatchId?`, `generateDescription?`, `descriptionTone?`)
  - On completion, update batch rollup counters via new service `BulkOfferCreationProgressService`
  - If `generateDescription === true`: call `ContentSuggestionService.suggestDescription` before `OfferCreationExecutionService.executeCreation`; thread result into overrides
- `libs/core/src/listings/application/services/bulk-offer-creation-progress.service.ts` (NEW)
  - Atomically updates batch counters using Postgres `UPDATE ... SET counter = counter + 1 WHERE ...`
  - Computes final status when `succeeded + failed === total`
- `libs/core/src/listings/listings.module.ts` (UPDATE) — wire new services
- `apps/worker/src/sync/sync.module.ts` (UPDATE) — register `ContentSuggestionService` (if not already)

**Acceptance:**
- Unit specs cover: bulk-batch-aware handler, progress counter updates, AI description path
- Worker integration spec via Testcontainers: enqueue 5-job batch, all succeed, batch rolls up to `completed`
- Spec for partial failure: 3 succeed, 2 fail → batch ends as `partially-failed`

**Effort:** M (5-7 days)

### Increment 4 — Allegro shipping rates exposure (Week 3, parallel) {#increment-4}

**Files:**
- `libs/integrations/allegro/src/infrastructure/adapters/allegro-offer-manager.adapter.ts` (UPDATE)
  - Extend `SellerPolicies` response to include `shippingRates: AllegroShippingRate[]` from `GET /sale/shipping-rates`
- `libs/core/src/listings/domain/types/seller-policies.types.ts` (UPDATE) — add `shippingRates` array
- Update `apps/api` response DTOs accordingly

**Acceptance:**
- Adapter test against mocked Allegro API
- New field surfaces in existing `GET /seller-policies/:connectionId` response

**Effort:** S (2-3 days)

### Increment 5 — FE bulk wizard (Weeks 4-5)

**Files (new feature folder):**
- `apps/web/src/features/listings/bulk-create/` (NEW)
  - `bulk-create-offer-wizard.tsx`
  - `steps/{products,category,delivery,pricing,description,review}.step.tsx`
  - `hooks/use-shop-products-paginated.ts`
  - `hooks/use-bulk-create-offer-mutation.ts`
  - `hooks/use-bulk-batch-progress.ts` (polling)
- `apps/web/src/pages/listings/bulk-create-offer-page.tsx` (NEW route)
- `apps/web/src/pages/listings/bulk-batch-progress-page.tsx` (NEW route)
- `apps/web/src/app/router/listings-routes.tsx` (UPDATE — register new routes)
- `apps/web/src/features/listings/listings.locales.ts` (UPDATE — PL + EN strings)

**State ownership:**
- Wizard step state: URL search params (so refresh / share-link works)
- Selected product list: React Hook Form with Zod schema
- Server state: TanStack Query (`useShopProductsPaginated`, `useSellerPolicies`, `useCategories`)

**Acceptance:**
- Component tests for each wizard step
- Mock API client used for happy path + error path
- Mobile-responsive (cardView fallback for product table per `frontend-architecture.md`)

**Effort:** L (7-10 days)

### Increment 6 — Bulk retry + polish (Week 5)

**Files:**
- `apps/api/src/listings/http/bulk-offer-creation.controller.ts` (UPDATE) — add `POST /listings/bulk-create/:batchId/retry-failed`
- `libs/core/src/listings/application/services/bulk-offer-creation-retry.service.ts` (NEW) — re-enqueues only failed records in batch
- Documentation: update `docs/plugin-author-guide.md` to mention "bulk creation works on top of single-offer `OfferCreator` — no plugin changes required"
- Integration test: simulated full happy-path E2E with real Allegro mock

**Acceptance:**
- Retry-failed endpoint covered by integration test
- All quality gates pass

**Effort:** S (3-5 days)

### Smart! eligibility surfacing — folded into Increments 4 + 5

Per §4.4 the Smart! UI is the delivery configuration picker built in Increment 4 (backend) + Increment 5 (frontend). No separate increment needed; Smart! is "Allegro returns the list, we render it with a badge".

### Total effort

- Backend (Increments 1-4 + 6): ~3-4 weeks for 1 dev
- Frontend (Increment 5): ~1.5-2 weeks for 1 FE dev (parallel)
- Together (2 devs, parallel after Increment 2): **~5-6 weeks wall-clock**

---

## 7. Open questions to resolve before implementation starts

These should be resolved via discovery interview + Allegro API probing before Increment 1.

### 7.1 Variation handling

Does any target agency need each PrestaShop variant as a **separate Allegro offer** (vs collapsed into one offer with variant matrix)? If yes, defer to v2 with a separate sub-capability. If no, our v1 design holds.

**Action:** ask 3-5 agencies. Default: collapse to single offer with variants.

### 7.2 Smart! eligibility detection

Does Allegro's `GET /sale/shipping-rates` response include an explicit Smart! eligibility flag, or do we need to compute it client-side from the rate's contents?

**Action:** probe the API endpoint with a real seller account. If no flag: v1 ships without badge, just lists rate names; v2 adds eligibility computation.

### 7.3 Bulk wizard UX

The 8-step wizard described in §5.1 may be too long. Should we collapse some steps (e.g., delivery + pricing into one step)?

**Action:** wireframe in Figma, validate with 2-3 agencies before Increment 5.

### 7.4 Maximum batch size

100 products per batch is a guess. What's the realistic upper bound that agencies want to use? Cap of 100 protects worker queue depth; cap of 1000 would require chunked job enqueuing.

**Action:** ask agencies "what's the biggest batch you'd want in one go". Confirm 100 covers 95% of use cases.

### 7.5 Bulk-update existing offers

Issue #726 explicitly scopes to **creation** of new offers. Several agencies will ask about bulk **update** (price, stock, parameters) of existing offers. Confirm this is out-of-scope for v1, file as separate future feature.

**Action:** clarify in the discovery interview; if strong demand, file as #726-companion issue (still out of #726 scope).

### 7.6 Cross-connection bulk

Can one batch span multiple Allegro connections (e.g., two seller accounts)? Default: no — one batch = one connection. Simplification holds unless agencies push back.

### 7.7 Auto-match variants before bulk submit

If selected products have unmapped variants (not in master catalog), should the bulk submit auto-match them first (via the existing `auto-match-variants` handler) or fail with "please run auto-match first"?

**Action:** default to "fail with clear error message"; auto-match-before-submit is v2.

---

## 8. ADRs to write as part of this work

Each gets a small dedicated PR after #725 (ADR practice introduction) lands:

1. **ADR-XXX: Bulk creation as application-layer fan-out, not adapter capability** — codifies §4.3 decision. Captures alternatives considered (new `OfferBatchCreator` capability) and why rejected (every future marketplace adapter would need to re-implement).
2. **ADR-XXX: Allegro Smart! surfaced through delivery configuration, not as a separate offer field** — codifies §4.4 / §2 findings. Captures the alternative (toggle on each offer) and why rejected (not how Allegro API works).
3. **ADR-XXX: AI description generation runs in worker, not API, to avoid API timeouts on large batches** — codifies §4.5 decision. Captures Options A/B/C and why B chosen.
4. **ADR-XXX: `BulkOfferCreationBatch` as denormalized rollup entity** — codifies §4.2 decision. Captures alternative (query-time aggregation) and why rejected (snapshot of shared config; retry semantics).

---

## 9. Implementation issues to create (post-refinement)

After this design doc merges, the following GitHub issues should be created, each linked to #726:

- **#726.1** — feat(listings): `BulkOfferCreationBatch` domain entity + repository + migration (Increment 1)
- **#726.2** — feat(listings): bulk submission service + HTTP endpoints (Increment 2)
- **#726.3** — feat(worker): bulk-aware `marketplace.offer.create` handler + AI description integration (Increment 3)
- **#726.4** — feat(allegro): expose shipping rates via `SellerPoliciesReader` (Increment 4)
- **#726.5** — feat(web): bulk create offer wizard (Increment 5)
- **#726.6** — feat(listings): bulk retry-failed endpoint + polish (Increment 6)
- **#726.7** — feat(content): make `ContentSuggestionService` consumable from worker module (prereq for #726.3)

Issues created from §8 ADR list:
- **#726-ADR-1** to **#726-ADR-4** as listed above

After all six implementation increments ship, #726 itself is closed via PR with `Closes #726`.

---

## 10. Validation against architecture rules

This design has been checked against `docs/architecture-overview.md` and `docs/engineering-standards.md`:

- ✅ **CORE vs Integration boundary**: bulk lives in core (`libs/core/src/listings/application/`), Allegro adapter unchanged
- ✅ **Port-first**: no new ports introduced; existing `OfferCreator` carries the load
- ✅ **Sub-capability pattern**: no abuse — we explicitly chose application-layer composition over new sub-capability (§4.3)
- ✅ **Repository ports pattern**: new `BulkOfferCreationBatchRepositoryPort` in domain layer, ORM repo in infrastructure
- ✅ **Symbol DI tokens**: new token `BULK_OFFER_CREATION_BATCH_REPOSITORY_TOKEN` added to `listings.tokens.ts`
- ✅ **Domain layer independence**: new entities are framework-free
- ✅ **Naming conventions**: services follow `*.service.ts` + `*.service.interface.ts`, entities follow `*.entity.ts`, ORM `*.orm-entity.ts`
- ✅ **Type definitions in separate files**: `bulk-offer-creation.types.ts`
- ✅ **`as const` for status enums**: `BulkBatchStatus` follows pattern from `JobStatus`
- ✅ **Hexagonal dependency direction**: FE → API controller → application service → repository port + job enqueue port

### Test strategy (per `docs/testing-guide.md`)

- **Unit tests** (`*.spec.ts`): each new service mocks ports; bulk progress service tested for race-safety on counter updates
- **Integration tests** (`*.int-spec.ts`): end-to-end submit → workers process → batch rolls up → progress endpoint reflects state. Real Postgres + Redis via Testcontainers.
- **Coverage target**: 80%+ on application services per engineering standards.

### Security review

- All new endpoints `@UseGuards(JwtAuthGuard) @Roles('admin')`
- Input validation via class-validator DTOs (`@IsArray`, `@ArrayMaxSize(100)`, `@IsUUID('all', { each: true })`)
- No raw SQL — all repository operations use TypeORM
- Per-product overrides validated through existing `CreateOfferRequest` DTO validation
- Batch IDs are `ol_batch_*` (deterministic prefix + UUID); not guessable

---

## 11. Risks

| Risk | Mitigation |
|------|------------|
| AI description generation rate-limited by provider (Anthropic/OpenAI) on large batches | Worker handler concurrency cap per connection (existing `RedisSyncLockService` pattern); fall back to no-description on rate-limit error and continue offer creation |
| Allegro API rate-limit hit on 100-product batch (Allegro typically allows ~9000 req/min, but bursting may trigger 429) | Existing `AllegroHttpClient` retry-classifier handles 429 with `Retry-After`; bulk doesn't change pacing — each child job is independent |
| Bulk batch entity drift from per-job records (counters wrong) | Use atomic SQL `UPDATE ... SET counter = counter + 1` rather than read-modify-write; cover with concurrency-stress integration test (16 parallel completing jobs) |
| Wizard UX too complex; abandonment mid-flow | Step-by-step URL state lets operator resume; auto-save draft (v2) |
| Smart! eligibility classification wrong (we say "Smart!" but Allegro rejects) | v1: don't claim Smart! pre-submit; let Allegro classify; surface eligibility post-create from offer response |

---

## 12. References

- Issue: [#726](https://github.com/SilkSoftwareHouse/openlinker/issues/726)
- Related: [#431 — EAN-based smart-link product card resolution](https://github.com/SilkSoftwareHouse/openlinker/issues/431) (unrelated to Allegro Smart! despite naming)
- Related: [#451 / #452 — AI provider switching + prompt template seeding](https://github.com/SilkSoftwareHouse/openlinker/issues/451)
- Architecture: `docs/architecture-overview.md` — Listings bounded context, OfferCreator capability
- Engineering standards: `docs/engineering-standards.md` — hexagonal rules, Symbol DI tokens, naming
- Existing code:
  - `libs/integrations/allegro/src/infrastructure/adapters/allegro-offer-manager.adapter.ts` — single-offer creation + `SellerPoliciesReader`
  - `libs/core/src/listings/application/services/offer-creation-execution.service.ts` — orchestration
  - `apps/worker/src/sync/handlers/marketplace-offer-create.handler.ts` — single-offer handler
  - `apps/worker/src/sync/handlers/master-product-sync-all.handler.ts` — fan-out blueprint
  - `libs/core/src/content/application/services/content-suggestion.service.ts` — AI description
  - `apps/web/src/features/listings/hooks/use-create-offer-mutation.ts` — single-offer FE mutation
- Allegro API docs (to verify in discovery phase):
  - `GET /sale/shipping-rates` — seller's named shipping rate configurations
  - `GET /sale/delivery-methods` — available delivery methods
  - `POST /sale/product-offers` — create offer
