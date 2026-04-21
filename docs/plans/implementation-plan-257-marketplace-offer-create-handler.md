# Implementation Plan — `marketplace.offer.create` Worker Handler (#257)

**Branch:** `257-marketplace-offer-create-worker-handler`
**Scope:** Core `OfferCreationExecutionService` that orchestrates the full create flow, plus a thin worker handler that dispatches jobs to it.

---

## 1. Understand the Task

### Goal
Ship the async orchestration step of offer creation. Per `architecture-overview.md` §6 (*"Sync orchestration policies live in core application services, not in worker handlers"*), the orchestration lives in a core application service; the worker handler is a thin shell that parses the payload and delegates.

### Layer classification
- CORE — new job type, new payload type, **new application service `OfferCreationExecutionService`** (owns the orchestration policy)
- Worker — thin handler that parses payload and calls the core service

### Scope split from the issue

The issue asks for two handlers:
1. `marketplace.offer.create` — **this PR**
2. `marketplace.offer.pollCreationStatus` — **deferred follow-up**

**Why:** `JobEnqueuePort.enqueueJob()` has no `runAfter` / `delayMs`. The poll handler needs 30s → 60s → 120s backoff; enqueueing immediately would spam Allegro. Delayed-enqueue is a cross-cutting change affecting `SyncJobRequest`, the enqueue implementation, possibly the runner's scan query. Ship create now; file a follow-up that adds delayed-enqueue + the poll handler together.

If `adapter.createOffer` returns `status='validating'`, the record persists with `status='validating'` + `externalOfferId` populated — all the data a future poll handler needs. A warn-level log fires so operators can grep for stuck records in the interim.

### Explicit non-goals
- `marketplace.offer.pollCreationStatus` handler — follow-up
- Delayed-enqueue on `JobEnqueuePort` — follow-up
- REST endpoint — #259 (will call the **same** `OfferCreationExecutionService`; no orchestration duplication)

---

## 2. Research Findings (codebase-grounded)

### Worker handler pattern (reference: `marketplace-offer-field-update.handler.ts`)
- `@Injectable()`, implements `SyncJobHandler`, single `async execute(job: SyncJob): Promise<void>`
- Constructor injects dependencies via `@Inject(TOKEN)`
- Private `getPayload(job)` narrows `job.payload` with runtime checks, throws `SyncJobExecutionError` on invalid
- Errors from injected collaborators → wrap in `SyncJobExecutionError` with job id/type/connectionId
- Throwing from `execute()` → runner retries with exponential backoff. Returning → success (no retry).

### Core orchestration pattern (reference: `MarketplaceOffersSyncHandler` → `IOfferMappingSyncService`)
- Handler calls a single core service method; service owns all of the policy.
- Service returns a result object the handler can log / use for follow-up decisions.

### Sync-job infrastructure
- Job types: `libs/core/src/sync/domain/types/sync-job.types.ts` — append `'marketplace.offer.create'`
- Payload types: `libs/core/src/sync/domain/types/marketplace-job-payloads.types.ts` — add `MarketplaceOfferCreatePayloadV1`
- Handler registration: list in `SyncWorkerModule.providers` + inject in `HandlerRegistrationService` + `registry.register('marketplace.offer.create', handler)` in `onModuleInit()`

### Foundation (merged in #282)
- `IOfferBuilderService.buildCreateOfferCommand(input)` (`OFFER_BUILDER_SERVICE_TOKEN`)
- `MarketplacePort.createOffer?(cmd)` returns `CreateOfferResult { externalOfferId, status, validationErrors? }`
- `OfferCreationRecordRepositoryPort` — `create`, `findById`, `findLatestByVariantAndConnection`, `updateStatus`, `updateExternalOfferId`
- Domain exceptions to catch terminally: `OfferBuilderValidationException`, `AllegroOfferCreateException`, `MasterCatalogConnectionNotConfiguredException`

### `IdentifierMappingService.createMapping` idempotency — **verified, not idempotent**
`createMapping` throws `DuplicateIdentifierMappingError` when a (entityType, platformType, connectionId, externalId) row already exists. On job retry this will fire. The core service catches it and treats it as success — the identifier mapping is already in place, which is exactly what we wanted.

### Retry semantics confirmed
- Throwing `SyncJobExecutionError` → runner schedules retry with exp backoff
- Returning without throwing → job `succeeded`, no retry
- "Terminal" domain failures (validation, config, platform reject) → core service updates the record to `failed` and **returns normally**; handler returns success. Operators debug via the record, not via job state.

---

## 3. Design

### File map

**Core — new application service (owns the orchestration):**
- `libs/core/src/listings/domain/types/offer-creation-execution.types.ts` — input/result types
- `libs/core/src/listings/application/interfaces/offer-creation-execution.service.interface.ts` — port contract
- `libs/core/src/listings/application/services/offer-creation-execution.service.ts` — implementation
- `libs/core/src/listings/application/services/__tests__/offer-creation-execution.service.spec.ts` — comprehensive unit tests
- `libs/core/src/listings/listings.tokens.ts` — add `OFFER_CREATION_EXECUTION_SERVICE_TOKEN`
- `libs/core/src/listings/listings.module.ts` — register provider, Symbol-only
- `libs/core/src/listings/index.ts` — barrel export

**Core — sync types:**
- `libs/core/src/sync/domain/types/sync-job.types.ts` — append `'marketplace.offer.create'`
- `libs/core/src/sync/domain/types/marketplace-job-payloads.types.ts` — add `MarketplaceOfferCreatePayloadV1`

**Worker — thin handler:**
- `apps/worker/src/sync/handlers/marketplace-offer-create.handler.ts`
- `apps/worker/src/sync/handlers/__tests__/marketplace-offer-create.handler.spec.ts`
- `apps/worker/src/sync/sync-worker.module.ts` — register handler
- `apps/worker/src/sync/handlers/handler-registration.service.ts` — register for `'marketplace.offer.create'`

### `OfferCreationExecutionService` (the orchestration owner)

```typescript
// offer-creation-execution.types.ts
export interface ExecuteOfferCreationInput {
  /** OL internal variant id being listed. */
  internalVariantId: string;
  /** Target marketplace connection id (e.g. Allegro). */
  connectionId: string;
  /** Offered stock quantity. */
  stock: number;
  /** Publish immediately after creation (marketplaces that support inline publish). */
  publishImmediately: boolean;
  /** Optional caller-supplied price; when omitted, builder falls back to master product. */
  price?: { amount: number; currency: string };
  /** Optional overrides (title, description, category, images, platformParams). */
  overrides?: CreateOfferOverrides;
  /** Optional idempotency key (threaded to adapter, e.g. Allegro external.id). */
  idempotencyKey?: string;
  /**
   * Existing OfferCreationRecord id to update, if the caller pre-created one
   * (#259 REST endpoint will do this). When absent, the service creates a
   * fresh record with status='pending'. Same semantic for both paths.
   */
  offerCreationRecordId?: string;
}

export interface ExecuteOfferCreationResult {
  offerCreationRecord: OfferCreationRecord;  // terminal state on the record
}
```

**Interface:**
```typescript
// offer-creation-execution.service.interface.ts
export interface IOfferCreationExecutionService {
  /**
   * Execute the full create-offer flow: resolve variant and marketplace,
   * build the neutral command, invoke the adapter, persist the
   * OfferCreationRecord + IdentifierMapping. Terminal domain failures
   * (validation, config, platform reject) are caught and persisted to the
   * record as `status='failed'` with structured errors — the method
   * resolves normally in those cases so the calling worker job isn't
   * retried. Transient errors propagate to the caller.
   */
  executeCreation(input: ExecuteOfferCreationInput): Promise<ExecuteOfferCreationResult>;
}
```

**Flow (in the service, not the handler):**
```
executeCreation(input):
  1. record = input.offerCreationRecordId
       ? await repo.findById(input.offerCreationRecordId)  // throw if missing — contract break
       : await repo.create({ internalVariantId, connectionId, status: 'pending',
                             publishImmediately, externalOfferId: null, errors: null })
  2. try {
       command = await offerBuilder.buildCreateOfferCommand({
         internalVariantId, connectionId, stock, price, publishImmediately, overrides, idempotencyKey,
       })
     } catch (e) {
       if (e is OfferBuilderValidationException)                    → markFailed(record, e.issues)
       if (e is MasterCatalogConnectionNotConfiguredException)      → markFailed(record, synthetic)
       else                                                          → throw   // transient / unknown
       return { offerCreationRecord: updatedRecord }
     }
  3. adapter = integrationsService.getCapabilityAdapter<MarketplacePort>(connectionId, 'Marketplace')
     if (!adapter.createOffer) throw CapabilityNotSupportedError('Marketplace.createOffer')
     // (this error is terminal-at-operator-config level, but retryable from the runner's POV
     //  because operators might enable the capability; propagate.)
  4. try {
       result = await adapter.createOffer(command)
     } catch (e) {
       if (e is AllegroOfferCreateException) → markFailed(record, mapAllegroErrors(e.errors))
       else → throw   // transient / unknown
       return { offerCreationRecord: updatedRecord }
     }
  5. try {
       await identifierMapping.createMapping('Offer', result.externalOfferId, connectionId, internalVariantId)
     } catch (e) {
       if (e is DuplicateIdentifierMappingError) { /* idempotent retry — already mapped, continue */ }
       else throw
     }
  6. await repo.updateExternalOfferId(record.id, result.externalOfferId)
  7. await repo.updateStatus(record.id, result.status, result.validationErrors ? mapErrors(result.validationErrors) : null)
  8. if (result.status === 'validating') log.warn({ recordId, externalOfferId, connectionId },
       'offer created but stuck in validating — awaiting marketplace.offer.pollCreationStatus handler (follow-up)')
  9. return { offerCreationRecord: finalRecord }
```

### Worker handler (thin shell)

```typescript
// marketplace-offer-create.handler.ts
@Injectable()
export class MarketplaceOfferCreateHandler implements SyncJobHandler {
  private readonly logger = new Logger(MarketplaceOfferCreateHandler.name);

  constructor(
    @Inject(OFFER_CREATION_EXECUTION_SERVICE_TOKEN)
    private readonly offerCreation: IOfferCreationExecutionService,
  ) {}

  async execute(job: SyncJob): Promise<void> {
    const payload = this.getPayload(job);
    this.logger.log(
      `Executing marketplace.offer.create job ${job.id} variant=${payload.internalVariantId} connection=${job.connectionId}`,
    );

    try {
      const { offerCreationRecord } = await this.offerCreation.executeCreation({
        ...payload,
        connectionId: job.connectionId,
      });
      this.logger.log(
        `Offer creation finished: job=${job.id} recordId=${offerCreationRecord.id} status=${offerCreationRecord.status}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `marketplace.offer.create job failed: ${message}`,
        job.id, job.jobType, job.connectionId,
        error instanceof Error ? error : undefined,
      );
    }
  }

  private getPayload(job: SyncJob): MarketplaceOfferCreatePayloadV1 {
    // Runtime narrowing — validate required fields, throw SyncJobExecutionError on bad input
    // (matches pattern from marketplace-offer-field-update.handler.ts)
  }
}
```

### Job payload (v1)

```typescript
// marketplace-job-payloads.types.ts
export interface MarketplaceOfferCreatePayloadV1 {
  schemaVersion: 1;
  internalVariantId: string;
  stock: number;
  publishImmediately: boolean;
  price?: { amount: number; currency: string };
  overrides?: CreateOfferOverrides;
  idempotencyKey?: string;
  offerCreationRecordId?: string;  // #259 will provide; #257 standalone won't
}
```

`schemaVersion: 1` follows the established contract: future breaking changes bump `schemaVersion`; handlers must accept all schema versions they've seen in persisted jobs until the backlog is drained.

### Error-to-record mapping (in the core service)

- `OfferBuilderValidationException.issues[]` (already `{ field, code, message }`) → passthrough
- `AllegroOfferCreateException.errors[]` → `{ field: e.path, code: e.code, message: e.userMessage ?? e.message }`
- `MasterCatalogConnectionNotConfiguredException` → `[{ field: 'connection.config.masterCatalogConnectionId', code: 'MASTER_CATALOG_NOT_CONFIGURED', message: e.message }]`

### Core service DI

```typescript
constructor(
  @Inject(OFFER_BUILDER_SERVICE_TOKEN) offerBuilder: IOfferBuilderService,
  @Inject(OFFER_CREATION_RECORD_REPOSITORY_TOKEN) offerCreationRecords: OfferCreationRecordRepositoryPort,
  @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN) identifierMapping: IIdentifierMappingService,
  @Inject(INTEGRATIONS_SERVICE_TOKEN) integrationsService: IIntegrationsService,
)
```

All tokens already exist and are exported from their respective modules.

### Observability for `validating` state

Since the poll handler is deferred, any record exiting this flow with `status='validating'` is "stuck" until the follow-up ships. The service emits a `log.warn` on each such transition with the `offerCreationRecordId`, `externalOfferId`, and `connectionId`. Operators can grep/dashboard on these to see the backlog count. No metrics system change required; existing structured logging covers it.

---

## 4. Step-by-Step Implementation

### Step 1 — Execution service types + interface
- Create `offer-creation-execution.types.ts` with `ExecuteOfferCreationInput`, `ExecuteOfferCreationResult`
- Create `offer-creation-execution.service.interface.ts` with `IOfferCreationExecutionService`

### Step 2 — Execution service implementation
- Create `offer-creation-execution.service.ts` implementing the flow in §3
- Catches `OfferBuilderValidationException`, `AllegroOfferCreateException`, `MasterCatalogConnectionNotConfiguredException` terminally — updates record to `failed`, returns normally
- Catches `DuplicateIdentifierMappingError` inside step 5 as idempotent success
- Emits `log.warn` when exit status is `'validating'`

### Step 3 — Token + module wiring
- Add `OFFER_CREATION_EXECUTION_SERVICE_TOKEN` to `listings.tokens.ts`
- Register provider in `listings.module.ts` (Symbol only, no string-fallback per #264)
- Export type + token from `listings/index.ts`

### Step 4 — Execution service unit tests (≥12 tests)
`libs/core/src/listings/application/services/__tests__/offer-creation-execution.service.spec.ts`:

- Happy path `status='draft'` → record + mapping created, status updated, externalOfferId set
- `status='active'` → record ends up active
- `status='validating'` with no validation errors → warn log fires
- 2xx with `validationErrors` → record keeps externalOfferId, errors persisted
- `OfferBuilderValidationException` → record `failed` with mapped issues, resolves normally
- `AllegroOfferCreateException` → record `failed` with mapped Allegro errors, resolves normally
- `MasterCatalogConnectionNotConfiguredException` → record `failed` with synthetic error
- Adapter missing `createOffer` → throws (propagates to handler)
- Unknown adapter error → throws (propagates)
- Payload with `offerCreationRecordId` → uses existing record, doesn't create a new one
- `DuplicateIdentifierMappingError` during mapping → swallowed, flow continues
- Stock / price / connectionId missing on variant path → covered by builder exception branch

### Step 5 — Append job type + payload
- `libs/core/src/sync/domain/types/sync-job.types.ts` — append `'marketplace.offer.create'`
- `libs/core/src/sync/domain/types/marketplace-job-payloads.types.ts` — add `MarketplaceOfferCreatePayloadV1`
- Barrel export from `libs/core/src/sync/index.ts`

### Step 6 — Handler implementation + tests
- `apps/worker/src/sync/handlers/marketplace-offer-create.handler.ts` — thin shell, delegates to service
- `apps/worker/src/sync/handlers/__tests__/marketplace-offer-create.handler.spec.ts` — **smaller** test surface than before (since orchestration is in the service):
  - Happy path: payload parsed → service called with correct input → success
  - Invalid payload → `SyncJobExecutionError` thrown (runner retries)
  - Service throws → handler wraps in `SyncJobExecutionError`
  - Service resolves with `failed` record → handler logs and returns (no throw, no retry)

### Step 7 — Register handler
- `SyncWorkerModule.providers`: add `MarketplaceOfferCreateHandler`
- `HandlerRegistrationService`: inject + `registry.register('marketplace.offer.create', this.marketplaceOfferCreateHandler)`

### Step 8 — Quality gate
```bash
pnpm lint
pnpm type-check
pnpm test
```
0 lint errors, 0 type errors, all green.

---

## 5. Validation

### Architecture compliance
- ✅ Orchestration policy lives in a core application service, not the worker handler (per `architecture-overview.md` §6)
- ✅ Handler is a thin shell: payload validation + service dispatch + log
- ✅ Service depends only on ports + application services (`IOfferBuilderService`, `OfferCreationRecordRepositoryPort`, `IIdentifierMappingService`, `IIntegrationsService`)
- ✅ All tokens Symbol-based (no string-fallbacks — #264 respected)
- ✅ Interface + implementation in separate files per Engineering Standards
- ✅ Types in `*.types.ts`; no inline type definitions in implementation files
- ✅ Domain exceptions from `domain/exceptions/` caught in the service, mapped to structured `OfferCreationError[]`
- ✅ Same service will back #259's REST endpoint — no orchestration duplication

### Testing strategy
- **Core service unit tests** carry the bulk of coverage (orchestration + error paths + idempotency)
- **Handler unit tests** are minimal — payload parsing + delegation only
- No new int-spec needed. The existing `apps/api/test/integration/app-boot.int-spec.ts` and worker boot tests load the full module graph; any DI wiring mistake fails there. (Same posture as #282.)

### Risks / open questions

- **`validating` records are operator-visible via log only** until the poll handler ships. Structured `log.warn` with `recordId` + `externalOfferId` makes them grep-able. Operator dashboards / alerting are out of scope for this PR — can be built on the existing log stream whenever needed.
- **`createMapping` idempotency verified**: throws `DuplicateIdentifierMappingError` on duplicate. Service catches it as idempotent success. No race condition risk in this flow since retries are sequential per job.
- **`CapabilityNotSupportedError`** (when adapter lacks `createOffer`) propagates rather than marks the record `failed`. Rationale: if the operator enables the capability on the connection, a retry could succeed — so we let the runner's retry schedule handle it. If this is the wrong call, an easy future change is to treat it terminally like the other config error.

### Commit plan
Single commit on this branch:
`feat(worker): marketplace.offer.create job handler with core execution service`

Or two commits (core service first, worker handler second) if the reviewer prefers reviewability over grouping. Default to single commit given that both pieces land together.

PR body: `Closes #257`. Follow-up issue to be filed: `marketplace.offer.pollCreationStatus` handler + delayed-enqueue support on `JobEnqueuePort`.
