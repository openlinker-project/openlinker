# Implementation Plan — #736 (Bulk offer submission service + HTTP API + progress endpoint)

**Status**: Draft
**Issue**: [#736](https://github.com/openlinker-project/openlinker/issues/736)
**Parent epic**: #726 (Allegro Smart! + Bulk offer creation)
**Branch**: `736-listings-bulk-offer-submission`
**Blocker**: #734 — MERGED (PR #774, 2026-05-17)

---

## 1. Goal

Compose the just-shipped `BulkOfferCreationBatch` domain entity (#734) into a service + HTTP API that lets an operator submit N products for batch offer creation against a single connection, get back a `batchId`, and poll progress.

**Layer classification**: CORE (one new application service + interface) + Interface (one new controller) + a one-line extension to the sync payload-types module.

**Non-goals**:
- Worker handler changes that consume the new payload — separate issue **#737**. This PR defines `MarketplaceOfferCreatePayloadV2` and stops there; the handler change lives downstream.
- Retry-failed endpoint — separate issue **#742**.
- FE work (multi-select, wizard, review table, progress page) — issues #739/#740/#741.
- AI description generation — handled by #737; this PR only forwards `generateDescription` / `descriptionTone` flags through the job payload.

## 2. Verified Surface (from research)

What #734 shipped that we'll reuse:

| Element | Location |
|---|---|
| `BulkOfferCreationBatch` entity | `libs/core/src/listings/domain/entities/bulk-offer-creation-batch.entity.ts` |
| `BulkBatchStatus` union (`pending \| running \| completed \| partially-failed \| failed`) | `libs/core/src/listings/domain/types/bulk-offer-creation-batch.types.ts` |
| `BulkOfferCreationBatchRepositoryPort` (`create` / `findById` / `incrementCounters` / `updateStatus`) | `libs/core/src/listings/domain/ports/bulk-offer-creation-batch-repository.port.ts` |
| `BULK_OFFER_CREATION_BATCH_REPOSITORY_TOKEN` | `libs/core/src/listings/listings.tokens.ts` |
| `offer_creation_records.bulkBatchId` column + index | `apps/api/src/migrations/1797000000000-add-bulk-offer-creation-batches.ts` |

Closest service analog (template for our new service): **`OfferCreationEnqueueService`** at `libs/core/src/listings/application/services/offer-creation-enqueue.service.ts`.

Closest controller analog: the single-offer endpoint at `apps/api/src/listings/http/listings.controller.ts:308–349` (`POST /listings/connections/:connectionId/offers` + `GET .../offers/creation/:offerCreationRecordId`).

**`MarketplaceOfferCreatePayloadV2` does not exist yet** — V1 is at `libs/core/src/sync/domain/types/marketplace-job-payloads.types.ts:67–95`. This PR defines V2 (V1 + `bulkBatchId? + generateDescription? + descriptionTone?`).

**Spec deviation**: The issue body references the repo method as `updateCounters`, but #734 actually shipped `incrementCounters` + `updateStatus`. We use the shipped names.

## 3. Files to Change

### New (CORE — `libs/core/src/listings/`)

| File | Purpose |
|---|---|
| `application/interfaces/bulk-offer-creation-submit.service.interface.ts` | `IBulkOfferCreationSubmitService` — `submit(input)` + `getBatch(id)` |
| `application/services/bulk-offer-creation-submit.service.ts` | Implements `IBulkOfferCreationSubmitService` — creates batch row, enqueues N `marketplace.offer.create` jobs, exposes a terminal-status advance helper for the future worker handler (#737) |
| `application/types/bulk-offer-creation-submit.types.ts` | `BulkOfferCreationSubmitInput`, `BulkOfferCreationSubmitResult`, `PerProductOverride`, `BulkSharedConfig` types — `as const` per standards |
| `application/services/__tests__/bulk-offer-creation-submit.service.spec.ts` | Unit spec mocking integrations + batch repo + offer-creation enqueue + job-enqueue |

### Modified (CORE)

| File | Change |
|---|---|
| `listings.tokens.ts` | Add `BULK_OFFER_CREATION_SUBMIT_SERVICE_TOKEN = Symbol('IBulkOfferCreationSubmitService')` |
| `listings/services/listings.module.ts` (the `@openlinker/core/listings/services` sub-barrel) | Register the new service + token binding |
| `libs/core/src/sync/domain/types/marketplace-job-payloads.types.ts` | Add `MarketplaceOfferCreatePayloadV2` (V1 fields + `schemaVersion: 2`, optional `bulkBatchId: string`, `generateDescription: boolean`, `descriptionTone?: 'concise' \| 'detailed'`). Add to the discriminated union. |
| `libs/core/src/sync/domain/types/marketplace-job-payloads.types.spec.ts` (if it exists) | Add V2 round-trip tests |

### New (API — `apps/api/src/listings/http/`)

| File | Purpose |
|---|---|
| `bulk-offer-creation.controller.ts` | `POST /listings/bulk-create` (202) + `GET /listings/bulk-create/:batchId` (200) |
| `dto/bulk-offer-create.dto.ts` | `BulkOfferCreateRequestDto` with `class-validator` decorators (`@IsUUID`, `@IsArray`, `@ArrayMaxSize(100)`, `@ValidateNested`) |
| `dto/bulk-offer-create-response.dto.ts` | `BulkOfferCreateResponseDto` (`batchId`, `jobIds`) + `BulkBatchSummaryDto` for the GET endpoint |
| `bulk-offer-creation.controller.spec.ts` | Unit spec mocking the service token |

### Modified (API)

| File | Change |
|---|---|
| `apps/api/src/listings/listings.module.ts` | Register the new controller |

### New (integration test)

| File | Purpose |
|---|---|
| `apps/api/test/integration/listings/bulk-offer-creation.int-spec.ts` | End-to-end: seed connection w/ `OfferCreator` capability, `POST /listings/bulk-create` with 3 products → assert batch persisted + 3 jobs enqueued in Redis stream + `GET .../:batchId` returns aggregate summary |

## 4. Step-by-step

1. **DTOs** (`bulk-offer-create.dto.ts` + response DTO) — class-validator decorations exactly as spec: `connectionId: @IsUUID`, `productIds: @IsArray @ArrayMaxSize(100) @IsUUID('all', { each: true })`, `sharedConfig` shape + `perProductOverrides` map. ✅ DTO compiles + class-validator integration test passes a happy-path payload.
2. **Service input/output types** (`bulk-offer-creation-submit.types.ts`) — pure types; map from DTO at the controller boundary, NOT in the service. ✅ Types compile.
3. **Service interface** (`*.interface.ts`) — two methods: `submit(input): Promise<BulkOfferCreationSubmitResult>` and `getBatch(id): Promise<BulkBatchSummary | null>`. ✅ Compiles, no implementation yet.
4. **Service implementation** — constructor injects `IIntegrationsService` + `BulkOfferCreationBatchRepositoryPort` + `OfferCreationRecordRepositoryPort` + `JobEnqueuePort`. `submit()` flow:
   - Resolve adapter via `integrationsService.resolveAdapterMetadata` → assert capability `OfferCreator`. Throw `CapabilityNotSupportedException` if missing.
   - Throw `ProductIdsRequiredException` if `productIds` is empty (DTO already validates `ArrayMaxSize` but not min-size; the service is the second line of defense).
   - Create batch row via `batchRepo.create({ id, connectionId, initiatedBy, status: 'pending', totalCount: productIds.length, sharedConfig })`. UUID generated by the service.
   - For each product: build a `MarketplaceOfferCreatePayloadV2` (`schemaVersion: 2`, `bulkBatchId: batch.id`, `generateDescription`, `descriptionTone`), pre-create the `offer_creation_record` row via `offerCreationEnqueue` (the existing service already does this — we reuse it so the per-record idempotency-key shape stays consistent), enqueue the job via `jobEnqueue` with idempotency key `bulk:${batchId}:variant:${internalVariantId}`.
   - Collect `jobIds`, advance batch to `'running'` via `batchRepo.updateStatus`, return `{ batchId, jobIds }`.
   - Failure mode: if enqueue fails partway, mark batch as `'failed'` (best-effort, no transaction across Redis + Postgres).
   - ✅ Unit spec covers happy-path, capability-missing, empty-products, partial-enqueue-failure → batch ends as `'failed'`.
5. **`getBatch(id)`** — returns batch + per-product summary built by querying `offer_creation_records` filtered by `bulkBatchId = id`. New repository method NOT needed — `offerCreationRecords.findByBulkBatchId(batchId)` already exists (per #734's migration shipping the column + index; verify by reading `OfferCreationRecordRepositoryPort`). If absent, add it; treat it as an in-scope fix for #736.
6. **`MarketplaceOfferCreatePayloadV2`** — append a new interface to the discriminated union in `marketplace-job-payloads.types.ts`. ✅ Type-check across `libs/core` + `apps/worker` passes (worker handlers narrow on `schemaVersion === 1` today; the new V2 branch is unconsumed until #737).
7. **Token + module binding** — add `BULK_OFFER_CREATION_SUBMIT_SERVICE_TOKEN` to `listings.tokens.ts`; register provider + `useExisting` binding in `libs/core/src/listings/services/listings.module.ts`.
8. **Controller** — `@Roles('admin')` class-level, two endpoints. `POST` returns `202` with the response DTO; `GET` returns `200` with the summary DTO. Map domain errors to HTTP: `ConnectionNotFoundException → 404`, `ConnectionDisabledException → 409`, `CapabilityNotSupportedException → 422`, `BatchNotFoundException → 404`. Mirror the existing single-offer endpoint's exception-handling shape.
9. **Controller unit spec** — mock the service via its token, assert routing + status codes + error mapping.
10. **Integration spec** — full HTTP → DB → Redis-stream flow: seed connection, POST with 3 products, assert (a) HTTP 202 + body shape, (b) `bulk_offer_creation_batches` row, (c) 3 `offer_creation_records` rows with matching `bulkBatchId`, (d) 3 entries on the Redis sync stream with `schemaVersion: 2`, (e) GET endpoint returns the expected summary.
11. **Quality gate** — `pnpm lint && pnpm type-check && pnpm test && pnpm --filter @openlinker/api test:integration --testPathPattern=bulk-offer-creation`. All green.

## 5. Risk / Open Questions

- **Reusing `OfferCreationEnqueueService`** — the existing service pre-creates an `OfferCreationRecord` AND enqueues a single V1 job. For bulk, we want the same per-record persistence but with V2 payload. Two options: (a) extend `OfferCreationEnqueueService` to accept an optional `bulkBatchId` + AI flags and emit V2 when set, (b) duplicate the orchestration in the new service. **Decision: option (a)** — keeps the persistence + idempotency-key generation in one place, single source of truth for the offer-creation record shape, no orchestration drift. Cost: one shared service touched by both single-and-bulk flows; tested via the existing single-offer specs + the new bulk specs.
- **Terminal-status state machine ownership** — #734's research summary says the service owns it. This PR exposes a `advanceBatchStatus(batchId)` private method that the future worker handler (#737) will call after each per-record completion. We intentionally don't expose it on the public interface yet — when #737 lands, it can promote the method to public + add the call. Documented in the service header for the next author.
- **Job idempotency key** — uses `bulk:${batchId}:variant:${internalVariantId}` per the spec. Note: this differs from the single-offer key shape (which uses just `internalVariantId`). Conscious choice — bulk batches need to dedupe per-batch, not globally per-variant, so a single product re-included in a later bulk wave isn't silently dropped.
- **No DB schema impact** — #734 already shipped the schema + `bulkBatchId` column + index. Confirmed via `pnpm --filter @openlinker/api migration:show` (will run during validation).

## 6. Implementation deviations

The implementation diverges from §4 in three places, all surfaced and accepted during the in-progress review:

- **Capability pre-check moved into the bulk service.** §4 step 4 originally relied on `OfferCreationEnqueueService.enqueueCreation` to surface the capability mismatch on the first loop iteration. That left an orphan `'failed'` batch row with 0 children when the connection didn't support `OfferCreator` — a state `BulkBatchStatus` doesn't model. The service now calls `IntegrationsService.getCapabilityAdapter` + `isOfferCreator` once at the top of `submit`, before persisting the batch. The same check repeats inside `enqueueCreation` per product — duplication is intentional so the enqueue service stays usable on its own.
- **Worker-handler seam stored as a block comment, not a private method.** §4 step 6 originally documented a private `advanceBatchStatus` method. `noUnusedLocals` would have flagged it; the algorithm now sits as a trailing `/* … */` block after the class so future-#737 has a canonical reference without TypeScript noise. Promoted to a public method when #737 actually calls it.
- **Int-spec drops the end-to-end POST happy-path.** §4 step 10 promised a full HTTP → DB → Redis-stream POST round-trip. Reality: the bulk service requires a connection whose adapter implements `OfferCreator`, which means real Allegro OAuth credentials in the test container. Coverage moves to the unit-level (service + enqueue + controller specs), with the int-spec focused on DTO validation + the GET endpoint's HTTP → DB read path (8 tests). Documented in the int-spec header.

## 7. Validation

- `pnpm lint` — green
- `pnpm type-check` — green (full repo; the new V2 branch unconsumed but type-safe)
- `pnpm test` — service spec + controller spec green
- `pnpm --filter @openlinker/api test:integration --testPathPattern=bulk-offer-creation` — green against Testcontainers Postgres + Redis (9/9)
- `pnpm --filter @openlinker/api migration:show` — no pending migrations
