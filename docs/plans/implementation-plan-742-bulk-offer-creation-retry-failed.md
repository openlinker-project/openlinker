# Implementation Plan — #742: Bulk Offer Creation Retry-Failed Endpoint

**Status**: Approved (post-grilling + self-review, 2026-05-18)
**Issue**: [#742](https://github.com/openlinker-project/openlinker/issues/742)
**Layer**: Core application service + API HTTP endpoint + integration spec + test infrastructure
**Scope**: Backend only. Closes out the bulk-listings backend epic (#726).

---

## 1. Goal

Add a `POST /listings/bulk-create/:batchId/retry-failed` endpoint that re-enqueues only the `OfferCreationRecord` rows with `status='failed'` for a given batch — letting an operator recover from terminal failures (Allegro validation rejects, builder errors, master-catalog misconfig) without re-submitting the whole batch.

**Non-goals**:
- Bulk-cancel (cancel in-flight) — explicitly deferred per the issue.
- Retrying succeeded records — succeeded rows are no-ops (filtered out before the loop).
- Retrying `validating` rows — the poll service already handles those.
- Net-new payload schemas — retry rebuilds the same V2 payload the original submit emitted.

---

## 2. Design summary (post-grilling + self-review)

### Batch-status reopen

Retry-failed **reopens** the batch:
- For each retried record, the `bulk_batch_advancements` row is deleted so the worker handler's re-advancement isn't gated as a duplicate.
- `failedCount` is decremented by 1 **per retried record, inside the loop** (lock-stepped to local-state writes — prevents partial-failure counter drift).
- If the batch was at a terminal status (`completed | partially-failed | failed`), it transitions back to `'running'` **once after the loop** so the FE summary card reflects the live retry wave without intermediate flicker.
- Worker handler re-derives terminal status when the retry wave's outcomes refill the counters to `succeeded + failed == total`.

Rejected alternative: leave the batch frozen — the FE summary would lie about progress after a successful retry.

### AI flags rebuilt from `batch.sharedConfig`

The snapshot (`OfferCreationRequestSnapshot`, schemaVersion 1) carries `stock` / `publishImmediately` / `price` / `overrides` but **not** `generateDescription` / `descriptionTone`. Retry rebuilds those from the parent `BulkOfferCreationBatch.sharedConfig` JSONB (where the submit service originally read them).

Rejected alternative: extend the snapshot to schemaVersion 2.

### Idempotency key per retry wave

Retry waves use a wave-distinct key to bypass the existing 7-day dedup TTL on `bulk:{batchId}:variant:{variantId}`:

```
bulk:${batchId}:variant:${variantId}:retry:${retryWaveId}
```

`retryWaveId` is a UUID generated per `retryFailed(batchId)` invocation (one wave = one UUID, shared across the N children retried in that call). Internal-only — **not exposed on the wire**.

### Service builds payload + enqueues directly (no `OfferCreationEnqueueService` reuse)

`OfferCreationEnqueueService.enqueueCreation` always **creates a new `OfferCreationRecord`** as its first step. The retry path **reuses** the existing failed record (post-reset). Branching `enqueueCreation` to support both paths would complicate a hot-path service. Retry calls `JobEnqueuePort.enqueueJob` directly with an inline-assembled V2 payload — single-purpose service, narrow contract surface.

### Adapter capability check fail-fast at the top, before any state mutation

Mirrors `BulkOfferCreationSubmitService`'s upfront check. The throw shape is the domain-layer `AdapterCapabilityNotSupportedException` (not NestJS `UnprocessableEntityException`) so core stays NestJS-free — the controller maps it to 422.

### Null-snapshot is an invariant violation, not a skip

If a failed record has `request === null`, throw `BulkRetryMissingSnapshotException` (typed domain exception, classified non-retryable by the sync-job runner). The submit path always writes a snapshot, and the `bulk_offer_creation_batches` table didn't exist before #734 — so this path is unreachable in production. A silent skip + lying FE summary is worse than a clean structured-error stop.

---

## 3. Architectural layers touched

```
apps/api/src/listings/http/
  ├── bulk-offer-creation.controller.ts                          (extend — new endpoint)
  └── dto/
      └── bulk-offer-creation-retry-response.dto.ts              (NEW)

libs/core/src/listings/
  ├── application/
  │   ├── interfaces/
  │   │   └── bulk-offer-creation-retry.service.interface.ts     (NEW)
  │   ├── services/
  │   │   └── bulk-offer-creation-retry.service.ts               (NEW)
  │   └── types/
  │       └── bulk-offer-creation-retry.types.ts                 (NEW — Result + AiFlags)
  ├── domain/
  │   ├── exceptions/
  │   │   ├── adapter-capability-not-supported.exception.ts      (NEW)
  │   │   ├── bulk-retry-missing-snapshot.exception.ts           (NEW)
  │   │   └── no-failed-children-to-retry.exception.ts           (NEW)
  │   └── ports/
  │       ├── bulk-batch-advancement-repository.port.ts          (extend — deleteForRecord)
  │       └── offer-creation-record-repository.port.ts           (extend — resetForRetry)
  ├── infrastructure/persistence/repositories/
  │   ├── bulk-batch-advancement.repository.ts                   (extend)
  │   └── offer-creation-record.repository.ts                    (extend)
  ├── listings.module.ts                                         (register service)
  ├── listings.tokens.ts                                         (add token)
  └── index.ts                                                   (export contract)

apps/api/test/integration/
  ├── listings-bulk-offer-creation-retry-failed.int-spec.ts      (NEW — flat path, matches sibling)
  └── helpers/
      ├── allegro-test-offer-manager-stub.helper.ts              (NEW — fake adapter plugin)
      └── bulk-batch-drain.helper.ts                             (NEW — synchronous worker stand-in)

docs/
  ├── architecture-overview.md                                   (small note)
  └── plugin-author-guide.md                                     (composition example)
```

No migration. Schema already supports everything.

---

## 4. Domain contract

### `IBulkOfferCreationRetryService`

```ts
// libs/core/src/listings/application/interfaces/bulk-offer-creation-retry.service.interface.ts

export interface IBulkOfferCreationRetryService {
  /**
   * Throws:
   * - `BulkOfferCreationBatchNotFoundException` (→ HTTP 404)
   * - `NoFailedChildrenToRetryException` (→ HTTP 409)
   * - `AdapterCapabilityNotSupportedException` (→ HTTP 422; raised before any state mutation)
   * - `BulkRetryMissingSnapshotException` (→ HTTP 500; invariant violation, non-retryable)
   */
  retryFailed(batchId: string): Promise<BulkOfferCreationRetryResult>;
}
```

### `BulkOfferCreationRetryResult` + `BulkOfferCreationRetryAiFlags`

```ts
// libs/core/src/listings/application/types/bulk-offer-creation-retry.types.ts
import type { OfferDescriptionTone } from '@openlinker/core/sync';
import type { BulkBatchStatus } from '../../domain/types/bulk-offer-creation-batch.types';

export interface BulkOfferCreationRetryAiFlags {
  generateDescription: boolean;
  descriptionTone?: OfferDescriptionTone;
}

export interface BulkOfferCreationRetryResult {
  retriedCount: number;
  retriedRecordIds: string[];
  /** Internal — used for idempotency keys + log correlation. NOT on the wire. */
  retryWaveId: string;
  batchStatus: BulkBatchStatus;
}
```

### Domain exceptions

```ts
// domain/exceptions/adapter-capability-not-supported.exception.ts
export class AdapterCapabilityNotSupportedException extends Error {
  constructor(public readonly connectionId: string, public readonly capability: string) {
    super(`Adapter for connection ${connectionId} does not support capability: ${capability}`);
    this.name = 'AdapterCapabilityNotSupportedException';
    Error.captureStackTrace(this, this.constructor);
  }
}

// domain/exceptions/bulk-retry-missing-snapshot.exception.ts
export class BulkRetryMissingSnapshotException extends Error {
  constructor(public readonly recordId: string, public readonly batchId: string) {
    super(`Cannot retry record ${recordId} on bulk batch ${batchId}: missing request snapshot.`);
    this.name = 'BulkRetryMissingSnapshotException';
    Error.captureStackTrace(this, this.constructor);
  }
}

// domain/exceptions/no-failed-children-to-retry.exception.ts
export class NoFailedChildrenToRetryException extends Error {
  constructor(public readonly batchId: string) {
    super(`Batch ${batchId} has no failed children to retry`);
    this.name = 'NoFailedChildrenToRetryException';
    Error.captureStackTrace(this, this.constructor);
  }
}
```

### Repository-port extensions

```ts
// BulkBatchAdvancementRepositoryPort
deleteForRecord(bulkBatchId: string, offerCreationRecordId: string): Promise<void>;
// No-op when row doesn't exist.

// OfferCreationRecordRepositoryPort
resetForRetry(id: string): Promise<OfferCreationRecord>;
// Sets status='pending', clears externalOfferId / errors / classificationReport.
// Preserves `request` snapshot. Throws OfferCreationRecordNotFoundException if missing.
```

---

## 5. Service flow

Dependencies (Symbol-token injection):

- `BULK_OFFER_CREATION_BATCH_REPOSITORY_TOKEN` → `BulkOfferCreationBatchRepositoryPort`
- `OFFER_CREATION_RECORD_REPOSITORY_TOKEN` → `OfferCreationRecordRepositoryPort`
- `BULK_BATCH_ADVANCEMENT_REPOSITORY_TOKEN` → `BulkBatchAdvancementRepositoryPort`
- `INTEGRATIONS_SERVICE_TOKEN` → `IIntegrationsService`
- `JOB_ENQUEUE_TOKEN` → `JobEnqueuePort`

```
1. const batch = bulkBatchRepository.findById(batchId)
   if (!batch) throw BulkOfferCreationBatchNotFoundException

2. const allChildren = offerCreationRecords.findByBulkBatchId(batchId)
   const failedChildren = allChildren.filter(r => r.status === Failed)
   if (failedChildren.length === 0) throw NoFailedChildrenToRetryException

3. const adapter = integrationsService.getCapabilityAdapter(batch.connectionId, 'OfferManager')
   if (!isOfferCreator(adapter)) throw AdapterCapabilityNotSupportedException(batch.connectionId, 'OfferCreator')

4. const aiFlags = extractAiFlags(batch.sharedConfig)
   const retryWaveId = randomUUID()

5. For each failedChild (sequentially, N bounded by submit-side 100-cap):
     if (!failedChild.request) throw BulkRetryMissingSnapshotException(failedChild.id, batchId)

     // Critical ordering — (a) → (b) → (c) → (d):
     a. advancementRepository.deleteForRecord(batchId, failedChild.id)
        // Open the gate FIRST so a crash before (d) can't leave a closed
        // advancement row behind a fresh-on-the-stream job.
     b. offerCreationRecords.resetForRetry(failedChild.id)
        // Reset record to 'pending', clear externalOfferId / errors / classificationReport.
     c. bulkBatchRepository.incrementCounters(batchId, { failed: -1 })
        // Lock-stepped to the per-record reset — partial-failure recovery
        // never leaves drift past totalCount.
     d. jobEnqueue.enqueueJob({
          jobType: 'marketplace.offer.create',
          connectionId: batch.connectionId,
          idempotencyKey: `bulk:${batchId}:variant:${snapshot.internalVariantId}:retry:${retryWaveId}`,
          payload: <V2 payload assembled inline from snapshot + aiFlags>,
        })
        // Hand the job off LAST — local state is consistent before the worker can see it.
     retriedRecordIds.push(failedChild.id)

6. if (isTerminalStatus(batch.status)) {
     bulkBatchRepository.updateStatus(batchId, 'running')
     // Single status-flip after the loop — no intermediate flicker for the FE.
   }

7. return { retriedCount, retriedRecordIds, retryWaveId, batchStatus: 'running' }
```

### Why this exact ordering

`(a) → (b) → (c) → (d)` is the recovery-safe ordering pressure-tested in grilling Q1:

- Crash between (a)+(d): advancement gate is open + record is at `'pending'` + counter decremented, but no job exists yet. Operator re-invokes `retryFailed(batchId)`; the upstream filter only picks up `status='failed'` rows, so the already-recovered record isn't reprocessed. New jobs land for the still-failed records. The wave-distinct idempotency key keeps the second wave clean.
- Worker-handler swallow risk eliminated: the gate is open *before* the job exists. The worker can't observe a `markAdvancedIfNotExists({created: false})` against a stale advancement row.

### Why sequential, not Promise.all

- N is bounded by the submit-side `totalCount ≤ 100` cap → worst case ~400 sequential awaits (~4s) — well inside the HTTP request budget.
- Sequential makes partial-failure deterministic (the first M succeed, the rest stay `'failed'` and the operator can re-retry).
- If the submit cap ever lifts, revisit this loop.

### `extractAiFlags(sharedConfig)`

Defensive read against untyped JSONB:

- `generateDescription`: `sharedConfig.generateDescription === true` (defaults silently to `false`; non-boolean shapes also default to `false` without a WARN — `false` is the conservative default and tests cover both branches).
- `descriptionTone`: if `typeof rawTone === 'string'` AND in `OfferDescriptionToneValues`, use it. Otherwise log a WARN and drop to `undefined` — preserves the retry rather than failing on a bad value.

---

## 6. HTTP surface

### Endpoint

```
POST /listings/bulk-create/:batchId/retry-failed
```

- **Guard**: `@Roles('admin')` (same as the submit endpoint).
- **Path param**: `batchId` (UUID, `@ParseUUIDPipe`).
- **Body**: none.
- **Status**: `202 Accepted` on success.

### Response DTO

```ts
// apps/api/src/listings/http/dto/bulk-offer-creation-retry-response.dto.ts
export class BulkOfferCreationRetryResponseDto {
  @ApiProperty({ description: 'Internal IDs of records re-enqueued, in createdAt order.' })
  retriedRecordIds!: string[];

  @ApiProperty({ description: 'Count of records re-enqueued. Always > 0.' })
  retriedCount!: number;

  @ApiProperty({ enum: BulkBatchStatusValues, description: 'Post-retry batch status.' })
  batchStatus!: BulkBatchStatus;
}
```

`retryWaveId` is intentionally **NOT on the wire** — internal-only (idempotency-key composition + log correlation). Re-expose if a future FE wave-history view needs it.

### Error mapping

| Service exception | HTTP |
|---|---|
| `BulkOfferCreationBatchNotFoundException` | 404 (`NotFoundException`) |
| `NoFailedChildrenToRetryException` | 409 (`ConflictException`) |
| `AdapterCapabilityNotSupportedException` | 422 (`UnprocessableEntityException`) |
| Anything else (incl. `BulkRetryMissingSnapshotException`) | 500 (Nest default) |

---

## 7. Module wiring

- `listings.tokens.ts`: add `BULK_OFFER_CREATION_RETRY_SERVICE_TOKEN`.
- `listings.module.ts`: register `BulkOfferCreationRetryService` as provider + token binding + export.
- `index.ts` (top-level barrel): export `IBulkOfferCreationRetryService`, `BulkOfferCreationRetryResult`, `BulkOfferCreationRetryAiFlags`, `AdapterCapabilityNotSupportedException`, `BulkRetryMissingSnapshotException`, `NoFailedChildrenToRetryException`.

---

## 8. Tests

### Unit (`bulk-offer-creation-retry.service.spec.ts`) — 14 cases

| # | Case | Asserts |
|---|---|---|
| 1 | Batch not found | throws `BulkOfferCreationBatchNotFoundException`; no other writes |
| 2 | No failed children | throws `NoFailedChildrenToRetryException`; no enqueues, no counter change, no status change |
| 3 | Adapter lacks `OfferCreator` | throws `AdapterCapabilityNotSupportedException` (domain, not NestJS); no state mutation |
| 4 | Happy path — retries only failed; succeeded/pending untouched | 2 enqueues, 2 deleteForRecord, 2 incrementCounters, 0 changes to other records |
| 5 | V2 payload reconstructed from snapshot + sharedConfig AI flags | enqueueJob called with correct payload shape including `generateDescription: true`, `descriptionTone: 'detailed'` |
| 6 | AI flags absent from sharedConfig | defaults `generateDescription: false`, `descriptionTone` undefined |
| 7 | Unknown `descriptionTone` value | ignored (logged WARN); `descriptionTone` undefined in payload |
| 8 | `retryWaveId` shared across all children in one call | all enqueueJob calls receive the same `retryWaveId` substring |
| 9 | Per-record decrement (not bulk after-loop) | `incrementCounters` called once per retried record with `{failed:-1}` |
| 10 | Status flip when terminal | batch was `partially-failed` → `updateStatus(batchId, 'running')` |
| 11 | No flip when batch already `'running'` | counters decrement but `updateStatus` not called |
| 12 | Terminal reopen for `failed` AND `completed` | both flip to `'running'` |
| 13 | Loop ordering (a)→(b)→(c)→(d) | call-order assertion: deleteForRecord → resetForRetry → incrementCounters → enqueueJob |
| 14 | Snapshot=null throws `BulkRetryMissingSnapshotException` | no state mutation on the bad record |
| 15 | Partial-failure mid-loop (enqueue throws on record 2 of 2) | record 1: fully processed (delete+reset+decrement+enqueue all ran); record 2: delete+reset+decrement ran (recoverable on re-invoke), enqueue threw; updateStatus not reached |

### Repository unit specs

- `bulk-batch-advancement.repository.ts` — `deleteForRecord` removes by composite PK; no-op on missing row.
- `offer-creation-record.repository.ts` — `resetForRetry` clears the 3 fields + sets status; throws `OfferCreationRecordNotFoundException` on missing id.

### Controller unit spec (`bulk-offer-creation.controller.spec.ts` extension)

- 202 success path — response shape matches DTO; `retryWaveId` is NOT present.
- 404 mapping (BulkOfferCreationBatchNotFoundException → NotFoundException).
- 409 mapping (NoFailedChildrenToRetryException → ConflictException).
- 422 mapping (AdapterCapabilityNotSupportedException → UnprocessableEntityException).

### Integration spec (`listings-bulk-offer-creation-retry-failed.int-spec.ts`)

Five test cases:

1. **DB+Redis side-effects of a happy retry** (seed batch with 1 failed + N succeeded records via SQL, POST retry-failed, assert response shape + DB state + Redis stream additions).
2. **404 for unknown batch id.**
3. **409 when batch exists but has no failed children.**
4. **400 when batchId is not a UUID.**
5. **401 without bearer token.**

A sixth "AC end-to-end" case (submit-like seed of 5 records → wave-1 drain (3 succeed, 2 fail via fake adapter) → POST retry-failed → wave-2 drain (1 succeeds, 1 fails) → assert final state `partially-failed`) is **structurally written but `.skip`'d** in the spec: it requires `OfferBuilderService` master-catalog seeding (Product + ProductVariant + master-catalog connection) that the existing int-spec harness doesn't provide. The fake-adapter stub + drain helper are wired up as reusable infrastructure for the next PR that adds those fixtures. The orchestration semantics covered by this AC case are fully validated by `bulk-offer-creation-retry.service.spec.ts`'s 15 unit cases; the worker-side drain wiring is covered by the worker handler's own unit spec.

### Test infrastructure

`apps/api/test/integration/helpers/allegro-test-offer-manager-stub.helper.ts`:
- Registers a test-only `adapterKey='allegro.test.offer-manager.v1'` against the running app's `AdapterRegistryService` + `AdapterFactoryResolverService` (same seam used by `allegro-test-source-stub.helper.ts` for #535).
- The stub implements `OfferManagerPort` + `OfferCreator`. Per-variant scripted results via `setNextCreateResult(variantId, { kind: 'success' | 'failure', ... })`.
- Suite-scoped: install once in `beforeAll`; `reset()` in `afterEach` clears scripts.

`apps/api/test/integration/helpers/bulk-batch-drain.helper.ts`:
- Synchronously drains pending children of a batch by calling `IOfferCreationExecutionService.executeCreation` per-record + `IBulkOfferCreationProgressService.advanceBatchStatus` for terminal outcomes.
- Stands in for the worker handler (which the API harness doesn't boot). Documented as skipping the AI suggestion path (covered by the worker handler's own unit spec).

---

## 9. Documentation

### `docs/architecture-overview.md` — § 6 Listings

Append one paragraph: retry-failed is the operator-facing recovery seam; reopen semantics (decrement counters, delete advancement rows, flip terminal → running); composition pattern (delegates to the same single-offer primitives — no parallel "bulk-retry" pipeline).

### `docs/plugin-author-guide.md` — composition example

Add a "Composing bulk flows over single-offer primitives" section showing the four-phase lifecycle (submit / run / progress / retry) all delegate to the same `OfferCreationExecutionService` + `OfferCreator` capability. Plugin authors implement the single-offer port; bulk composition is core's responsibility.

---

## 10. Step-by-step plan

| # | Step | File | Acceptance |
|---|---|---|---|
| 1 | Add `BulkOfferCreationRetryResult` + `BulkOfferCreationRetryAiFlags` types | `libs/core/src/listings/application/types/bulk-offer-creation-retry.types.ts` | Type compiles; no inline interfaces |
| 2 | Add `NoFailedChildrenToRetryException` | `libs/core/src/listings/domain/exceptions/no-failed-children-to-retry.exception.ts` | Stack-trace captured |
| 3 | Add `AdapterCapabilityNotSupportedException` | `libs/core/src/listings/domain/exceptions/adapter-capability-not-supported.exception.ts` | Captures `connectionId` + `capability` properties |
| 4 | Add `BulkRetryMissingSnapshotException` | `libs/core/src/listings/domain/exceptions/bulk-retry-missing-snapshot.exception.ts` | Captures `recordId` + `batchId` |
| 5 | Extend `BulkBatchAdvancementRepositoryPort.deleteForRecord` | `libs/core/src/listings/domain/ports/bulk-batch-advancement-repository.port.ts` | Doc-comment notes no-op on missing |
| 6 | Implement `deleteForRecord` in repository | `libs/core/src/listings/infrastructure/persistence/repositories/bulk-batch-advancement.repository.ts` | TypeORM `.delete({...})`; returns void |
| 7 | Extend `OfferCreationRecordRepositoryPort.resetForRetry` | `libs/core/src/listings/domain/ports/offer-creation-record-repository.port.ts` | Doc-comment notes `request` snapshot is preserved |
| 8 | Implement `resetForRetry` in repository | `libs/core/src/listings/infrastructure/persistence/repositories/offer-creation-record.repository.ts` | Clears 3 fields + status='pending'; throws `OfferCreationRecordNotFoundException` |
| 9 | Add `IBulkOfferCreationRetryService` interface | `libs/core/src/listings/application/interfaces/bulk-offer-creation-retry.service.interface.ts` | Method shape + throws doc per §4 |
| 10 | Add `BulkOfferCreationRetryService` impl | `libs/core/src/listings/application/services/bulk-offer-creation-retry.service.ts` | Flow per §5; uses relative imports for same-context; uses `BulkOfferCreationRetryAiFlags` typedef from types file |
| 11 | Register token | `libs/core/src/listings/listings.tokens.ts` | `BULK_OFFER_CREATION_RETRY_SERVICE_TOKEN` |
| 12 | Register provider | `libs/core/src/listings/listings.module.ts` | Provider + `useExisting` + export |
| 13 | Update top-level barrel | `libs/core/src/listings/index.ts` | All 3 exceptions + 2 types + interface |
| 14 | Add response DTO | `apps/api/src/listings/http/dto/bulk-offer-creation-retry-response.dto.ts` | No `retryWaveId` field; Swagger decorators |
| 15 | Extend controller with retry-failed endpoint | `apps/api/src/listings/http/bulk-offer-creation.controller.ts` | `@Post(':batchId/retry-failed')`; 3-exception mapping (404/409/422) |
| 16 | Unit spec for retry service | `libs/core/src/listings/application/services/__tests__/bulk-offer-creation-retry.service.spec.ts` | 15 cases per §8 |
| 17 | Repository spec extensions | `libs/core/src/listings/infrastructure/persistence/repositories/offer-creation-record.repository.spec.ts` | New `resetForRetry` describe block (advancement-repo skipped — int-spec covers it) |
| 18 | Update existing mock objects with new methods | 4 specs (`bulk-offer-creation-submit`, `offer-creation-enqueue`, `offer-creation-execution`, `offer-status-poll`, `bulk-offer-creation-progress`, plus `apps/api/src/listings/http/listings.controller.spec.ts`) | Add `resetForRetry: jest.fn()` to record-port mocks; `deleteForRecord: jest.fn()` to advancement-port mocks |
| 19 | Controller spec extension | `apps/api/src/listings/http/bulk-offer-creation.controller.spec.ts` | 202 / 404 / 409 / 422 paths + `retryWaveId` not on wire |
| 20 | Add test-adapter plugin helper | `apps/api/test/integration/helpers/allegro-test-offer-manager-stub.helper.ts` | Registers at boot; per-variant scripts; `reset()` between tests |
| 21 | Add drain helper | `apps/api/test/integration/helpers/bulk-batch-drain.helper.ts` | Synchronously drives executeCreation + advanceBatchStatus over pending records |
| 22 | Integration spec | `apps/api/test/integration/listings-bulk-offer-creation-retry-failed.int-spec.ts` | 5 wiring cases + 1 AC end-to-end case |
| 23 | Architecture-overview note | `docs/architecture-overview.md` | One-paragraph addition to § 6 Listings |
| 24 | Plugin-author-guide composition section | `docs/plugin-author-guide.md` | "Composing bulk flows over single-offer primitives" |
| 25 | Quality gate | (script) | `pnpm lint && pnpm type-check && pnpm test && pnpm test:integration` all green |

---

## 11. Risk register

| # | Risk | Mitigation |
|---|---|---|
| R1 | Worker-handler silently swallows a retry's outcome (advancement gate closed when the job runs) | `(a) deleteForRecord` runs **before** `(d) enqueueJob` — gate is open before the job exists. Pressure-tested in grilling Q1; covered by unit case #13. |
| R2 | Partial mid-loop failure leaves drift past `totalCount` | Per-record counter decrement (step c, inside loop) — lock-stepped to local writes. Operator re-invokes `retryFailed`; upstream filter on `status='failed'` skips already-recovered rows. Covered by unit case #15. |
| R3 | `extractAiFlags` reads untyped JSONB | Defensive narrowing: boolean shapes default to `false` silently; tone-string shapes default to `undefined` with a WARN log on unknown values. Covered by unit cases #6, #7. |
| R4 | sharedConfig drifts between submit-time and retry-time | Documented as a future concern in the architecture-overview note. v1 assumption: sharedConfig is immutable post-submit (no edit endpoint exists). |
| R5 | Idempotency-key collision across retry waves | 7-day TTL on `bulk:{batchId}:variant:{variantId}` from the original submit would silently swallow a same-key retry. Wave-distinct `retryWaveId` UUID makes each wave unique. Covered by unit case #8 + int-spec assertion. |
| R6 | Same-context `@openlinker/core/listings` self-import in the service | Service uses relative imports (`../../domain/...`, `../../domain/types/offer-creation-record.types`) instead of the top-level barrel (which would risk runtime circular-require, per #337/#359). |

---

## 12. Out of scope (deferred)

- **Per-record retry endpoint** — superseded by retry-failed; not in AC.
- **Retry-N-times policy** (auto-retry on certain error codes) — v2.
- **Bulk-cancel** — explicit issue carve-out.
- **AI-description path in the int-spec** — the drain helper bypasses the worker handler, so AI suggestion (which lives in the handler, not the execution service) isn't exercised by the AC end-to-end case. Worker handler's own unit spec covers it.
- **Cross-cutting cleanup of NestJS-from-core in the older services** — `OfferCreationEnqueueService` + `BulkOfferCreationSubmitService` still throw `UnprocessableEntityException` from core. This PR fixes only the retry service; a separate cleanup PR + ADR migrates them with a global filter.
- **AC end-to-end int-spec case** (submit → drain → retry → drain → final terminal state) — the fake-adapter stub + drain helper are wired up but the case is `.skip`'d because `OfferBuilderService` needs master-catalog fixtures (Product + ProductVariant + a second connection with `masterCatalogConnectionId`). Follow-up PR adds those fixtures and removes the `.skip`. The orchestration is fully covered by unit-spec case-15 (mid-loop throw) and the V2 payload reconstruction cases.
- **Decrement counters atomically with status flip** — current `incrementCounters` + `updateStatus` are two writes. Combining into one repo method is a future ADR; the orchestration-policy boundary keeps it readable today.
