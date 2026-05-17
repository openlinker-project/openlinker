# Implementation Plan — Bulk-aware `marketplace.offer.create` worker handler (#737)

**Issue**: [#737 — feat(worker): bulk-aware marketplace.offer.create handler + AI description + Smart classification readback](https://github.com/SilkSoftwareHouse/openlinker/issues/737)
**Parent epic**: [#726 — Allegro Smart! + bulk listing](https://github.com/SilkSoftwareHouse/openlinker/issues/726)
**Spec**: `docs/specs/product-spec-726-allegro-bulk-listing.md` AC-7 + AC-9
**Branch**: `737-bulk-aware-offer-create-worker`

---

## 0. Goal

Bring the bulk offer-creation flow to a working end-to-end BE state. After this PR, a `marketplace.offer.create` job from a bulk submission (#736) advances its parent `BulkOfferCreationBatch` correctly, optionally generates an AI description via `ContentSuggestionService`, and reads the post-create Allegro Smart classification (with a follow-up read on the `validating → active` transition for offers that need async validation).

**Non-goals** (explicitly out of scope):
- Order ingestion `delivery.smart` propagation (separate slice → #738).
- FE for any of this (→ #739–#741).
- AI per-batch generation (we do per-job, not per-batch).
- Allegro Smart reclassification handling (`scheduledForReclassification: true`) beyond the initial read at `active`-transition — future polling-based re-reads are a separate concern.

---

## 1. Layer mapping

This PR touches all four layers, one migration, and a sub-barrel promotion:

| File | Layer | Role |
|---|---|---|
| `libs/core/src/listings/domain/types/smart-classification.types.ts` | CORE — Domain | Neutral `SmartClassificationReport` + `SmartClassificationCondition` types (Allegro-shaped today, named generically) |
| `libs/core/src/listings/domain/ports/capabilities/offer-smart-classification-reader.capability.ts` | CORE — Domain | New `OfferSmartClassificationReader` sub-capability of `OfferManagerPort` + `isOfferSmartClassificationReader` guard. Bare-string method: `getOfferSmartClassification(externalOfferId)` |
| `libs/core/src/listings/domain/entities/offer-creation-record.entity.ts` | CORE — Domain | One new readonly field `classificationReport: SmartClassificationReport \| null` |
| `libs/core/src/listings/domain/ports/offer-creation-record-repository.port.ts` | CORE — Domain | New method `updateClassificationReport(id, report)` |
| `libs/core/src/listings/infrastructure/persistence/entities/offer-creation-record.orm-entity.ts` | CORE — Infra | `classificationReport jsonb \| null` column (single field, not per-axis) |
| `libs/core/src/listings/infrastructure/persistence/repositories/offer-creation-record.repository.ts` | CORE — Infra | Implement `updateClassificationReport` |
| `libs/core/src/listings/domain/entities/bulk-batch-advancement.entity.ts` | CORE — Domain | New domain entity for the at-most-once advancement guard (replaces the original guard-column plan) |
| `libs/core/src/listings/domain/ports/bulk-batch-advancement-repository.port.ts` | CORE — Domain | Repo port with one method: `markAdvancedIfNotExists(bulkBatchId, offerCreationRecordId) → Promise<{ created: boolean }>` |
| `libs/core/src/listings/infrastructure/persistence/entities/bulk-batch-advancement.orm-entity.ts` | CORE — Infra | TypeORM entity for new `bulk_batch_advancements` table (PK: composite `bulkBatchId + offerCreationRecordId`) |
| `libs/core/src/listings/infrastructure/persistence/repositories/bulk-batch-advancement.repository.ts` | CORE — Infra | Implements `markAdvancedIfNotExists` via INSERT ... ON CONFLICT DO NOTHING; returns `{created}` discriminating whether the row landed |
| `libs/core/src/listings/application/services/bulk-offer-creation-progress.service.ts` | CORE — App | **New service** (per Q1 grilling decision). Owns the worker-side state machine: counter increment + terminal-status derivation. Method: `advanceBatchStatus(batchId, offerCreationRecordId, outcome) → Promise<BulkOfferCreationBatch \| null>`. Internally consults `bulkBatchAdvancementRepository.markAdvancedIfNotExists` for at-most-once before delegating to `bulkBatchRepository.incrementCounters` + status derivation |
| `libs/core/src/listings/application/services/bulk-offer-creation-progress.service.interface.ts` | CORE — App | `IBulkOfferCreationProgressService` |
| `libs/core/src/listings/listings.tokens.ts` | CORE — DI | New token `BULK_OFFER_CREATION_PROGRESS_SERVICE_TOKEN` + `BULK_BATCH_ADVANCEMENT_REPOSITORY_TOKEN` |
| `libs/core/src/listings/application/services/offer-status-poll.service.ts` | CORE — App | Extend `validating → active` transition with Smart-readback hook (Q4 grilling outcome) |
| `libs/core/src/listings/services/listings.module.ts` | CORE — wiring | Register the new progress service + new advancement repository |
| `libs/core/src/listings/index.ts` | CORE — barrel | Re-export new types + capability + guard + progress-service interface + new tokens |
| `libs/integrations/allegro/src/infrastructure/adapters/allegro-offer-manager.adapter.ts` | Integration | Add `OfferSmartClassificationReader` to `implements`, plus `getOfferSmartClassification` method calling `GET /sale/offers/{offerId}/smart` |
| `libs/integrations/allegro/src/domain/types/allegro-api.types.ts` | Integration | `AllegroSmartOfferClassificationReport` raw response type |
| `apps/api/src/migrations/{timestamp}-add-smart-classification-and-batch-advancements.ts` | DX — migration | Single migration: (1) `classificationReport jsonb` column on `offer_creation_records`; (2) `bulk_batch_advancements` table |
| **`libs/core/src/content/services/content.module.ts`** | CORE — wiring | **Move target** for `apps/api/src/content/content.module.ts` (Q5 sub-barrel promotion) |
| **`libs/core/src/content/services/index.ts`** | CORE — wiring | New sub-barrel index that exports `ContentModule` |
| **`libs/core/package.json`** | CORE — wiring | Add `"./content/services"` export entry mirroring `"./listings/services"` |
| `apps/api/src/app.module.ts` (or wherever `ContentModule` is currently imported) | API — wiring | Update import path from local to `@openlinker/core/content/services` |
| `apps/worker/src/sync/sync-worker.module.ts` | Worker — wiring | Import `ContentModule` from `@openlinker/core/content/services` so handler can `@Inject(CONTENT_SUGGESTION_SERVICE_TOKEN)` |
| `apps/worker/src/plugins.ts` | Worker — wiring | Append `AiIntegrationModule.register()` to `workerPlugins` so `AI_COMPLETION_PORT_TOKEN` resolves |
| `apps/worker/src/sync/handlers/marketplace-offer-create.handler.ts` | Worker — handler | V2 payload branch: AI before, Smart readback + progress after; V1 backwards-compat preserved |
| `apps/worker/src/sync/handlers/marketplace-offer-create.handler.spec.ts` | Worker — test | Unit spec for handler |
| `libs/core/src/listings/application/services/__tests__/bulk-offer-creation-progress.service.spec.ts` | Test | Progress service unit spec — counter math + terminal derivation + advancement guard |
| `libs/core/src/listings/application/services/__tests__/offer-status-poll.service.spec.ts` | Test (additive) | Poll-service Smart-readback hook spec |
| `libs/integrations/allegro/src/infrastructure/adapters/__tests__/allegro-offer-manager.adapter.spec.ts` | Test (additive) | Adapter spec for `getOfferSmartClassification` |
| `apps/api/test/integration/listings/bulk-offer-creation.int-spec.ts` | Test — integration | 5-job batch end-to-end (per issue AC) |
| `docs/architecture-overview.md § 13 AI` | Doc | Replace the "worker registration not required" note with the new wiring topology |
| `docs/engineering-standards.md § Import Aliases` | Doc | Add `@openlinker/core/content/services` to the sub-barrel list |

---

## 2. Domain shape additions

### 2.1 `SmartClassificationReport` (neutral)

```ts
// libs/core/src/listings/domain/types/smart-classification.types.ts

/**
 * Neutral, marketplace-agnostic classification report. Today only Allegro
 * produces one; the shape is named generically so future marketplaces
 * can reuse it without a rename.
 *
 * Stored on `OfferCreationRecord.classificationReport`. Null when never
 * read (pre-bulk-flow records, marketplaces with no classification, or
 * readback failures).
 */
export interface SmartClassificationReport {
  fulfilled: boolean | null;
  conditions: SmartClassificationCondition[];
  scheduledForReclassification?: boolean;
}

export interface SmartClassificationCondition {
  code: string;
  name: string;
  description: string;
  fulfilled: boolean;
}
```

### 2.2 `OfferSmartClassificationReader` capability

```ts
// libs/core/src/listings/domain/ports/capabilities/offer-smart-classification-reader.capability.ts

import type { OfferManagerPort } from '../offer-manager.port';
import type { SmartClassificationReport } from '../../types/smart-classification.types';

export interface OfferSmartClassificationReader {
  /**
   * Fetch the marketplace's Smart-classification report for an offer.
   *
   * - Returns `null` only for **404** — the offer isn't yet classified
   *   (Allegro takes a few seconds-to-minutes post-create to compute).
   *   Persistable; callers do NOT retry on null.
   * - Throws on any other error (5xx, 4xx other than 404, network).
   *   Caller is expected to wrap in try/catch and degrade gracefully
   *   (Smart readback failure MUST NOT fail the offer-creation job —
   *   AC-7).
   */
  getOfferSmartClassification(externalOfferId: string): Promise<SmartClassificationReport | null>;
}

export function isOfferSmartClassificationReader(
  adapter: OfferManagerPort,
): adapter is OfferManagerPort & OfferSmartClassificationReader {
  return (
    typeof (adapter as Partial<OfferSmartClassificationReader>).getOfferSmartClassification ===
    'function'
  );
}
```

### 2.3 `OfferCreationRecord` widening

Add one readonly field:

```ts
// Constructor positional, after `request`, before `bulkBatchId`:
public readonly classificationReport: SmartClassificationReport | null = null,
```

Defaults to `null` so existing instantiation sites compile unchanged.

### 2.4 Repository port — one new method

```ts
updateClassificationReport(
  id: string,
  report: SmartClassificationReport | null,
): Promise<OfferCreationRecord>;
```

Throws `OfferCreationRecordNotFoundException` if missing (matches sibling-method precedent).

### 2.5 `BulkBatchAdvancement` entity + types

```ts
// libs/core/src/listings/domain/entities/bulk-batch-advancement.entity.ts

export class BulkBatchAdvancement {
  constructor(
    public readonly bulkBatchId: string,
    public readonly offerCreationRecordId: string,
    public readonly advancedAt: Date,
  ) {}
}
```

```ts
// libs/core/src/listings/domain/ports/bulk-batch-advancement-repository.port.ts

export interface BulkBatchAdvancementRepositoryPort {
  /**
   * INSERT ... ON CONFLICT DO NOTHING. Returns `{ created: true }` when the
   * row landed (first-time advancement, caller should run the increment);
   * `{ created: false }` when it already existed (retry path, caller should
   * skip the increment to keep at-most-once semantics).
   *
   * Composite PK `(bulkBatchId, offerCreationRecordId)` makes the race-free
   * guarantee atomic at the DB level — no transaction needed.
   */
  markAdvancedIfNotExists(
    bulkBatchId: string,
    offerCreationRecordId: string,
  ): Promise<{ created: boolean }>;
}
```

### 2.6 `BulkOfferCreationProgressService`

New service per Q1 grilling decision. Lives at
`libs/core/src/listings/application/services/`.

```ts
// .service.interface.ts
export interface IBulkOfferCreationProgressService {
  advanceBatchStatus(
    batchId: string,
    offerCreationRecordId: string,
    outcome: 'succeeded' | 'failed',
  ): Promise<BulkOfferCreationBatch | null>;
}

// .service.ts
@Injectable()
export class BulkOfferCreationProgressService implements IBulkOfferCreationProgressService {
  private readonly logger = new Logger(BulkOfferCreationProgressService.name);

  constructor(
    @Inject(BULK_OFFER_CREATION_BATCH_REPOSITORY_TOKEN)
    private readonly bulkBatchRepository: BulkOfferCreationBatchRepositoryPort,
    @Inject(BULK_BATCH_ADVANCEMENT_REPOSITORY_TOKEN)
    private readonly advancementRepository: BulkBatchAdvancementRepositoryPort,
  ) {}

  async advanceBatchStatus(
    batchId: string,
    offerCreationRecordId: string,
    outcome: 'succeeded' | 'failed',
  ): Promise<BulkOfferCreationBatch | null> {
    // At-most-once guard: insert-if-not-exists into the advancement join table.
    const { created } = await this.advancementRepository.markAdvancedIfNotExists(
      batchId,
      offerCreationRecordId,
    );
    if (!created) {
      // Retry path — advancement already happened. Skip the counter
      // increment to preserve idempotency.
      this.logger.debug(
        `Skipping advance — already advanced. batchId=${batchId} recordId=${offerCreationRecordId}`,
      );
      return null;
    }

    const delta = outcome === 'succeeded' ? { succeeded: 1 } : { failed: 1 };
    const batch = await this.bulkBatchRepository.incrementCounters(batchId, delta);

    const finished = batch.succeededCount + batch.failedCount === batch.totalCount;
    if (!finished) return null;

    const terminal: BulkBatchStatus =
      batch.failedCount === 0
        ? BULK_BATCH_STATUS.Completed
        : batch.succeededCount === 0
          ? BULK_BATCH_STATUS.Failed
          : BULK_BATCH_STATUS.PartiallyFailed;

    return this.bulkBatchRepository.updateStatus(batchId, terminal);
  }
}
```

The advancement guard sits inside the service, NOT inside `incrementCounters` (which stays single-purpose). The service is the single owner of "has this record's outcome been counted yet?" — that's an orchestration concern, not a repository concern.

---

## 3. Migration

`apps/api/src/migrations/{timestamp}-add-smart-classification-and-batch-advancements.ts`:

```sql
-- 1. Smart classification report on offer_creation_records (per Q6: single jsonb).
ALTER TABLE "offer_creation_records" ADD COLUMN "classificationReport" jsonb;

-- 2. At-most-once advancement guard table (per Q2 + tech-review IMPORTANT #2).
CREATE TABLE "bulk_batch_advancements" (
  "bulkBatchId"            uuid NOT NULL,
  "offerCreationRecordId"  uuid NOT NULL,
  "advancedAt"             TIMESTAMP NOT NULL DEFAULT now(),
  PRIMARY KEY ("bulkBatchId", "offerCreationRecordId")
);

-- Index for the bulk-batch-progress-page query path (#741): "give me all
-- advancement rows for this batch", typically used to render the per-row
-- ✅/❌ counter at FE-render time. The PK already covers (batchId, recordId)
-- so prefix-queries by batchId are free; no extra index needed.
```

`down()`: reverse — drop table, drop column.

Timestamp: next free slot. Most recent migration in repo is `1798000000000` (the BulkOfferCreationBatch foundation from #734). I shipped #735 without a migration; #736 (bulk submit + HTTP API) also shipped without migration. Next free: `1799000000000`.

No backfill needed:
- `classificationReport` is null for any pre-existing record. The FE treats null as "unread / not applicable".
- `bulk_batch_advancements` is empty at migration time. New advancements from #737's handler flow populate it forward.

---

## 4. Allegro Smart capability implementation

### 4.1 Adapter method

```ts
// In AllegroOfferManagerAdapter
async getOfferSmartClassification(
  externalOfferId: string,
): Promise<SmartClassificationReport | null> {
  try {
    const response = await this.httpClient.get<AllegroSmartOfferClassificationReport>(
      `/sale/offers/${externalOfferId}/smart`,
    );
    return mapToNeutralReport(response.data);
  } catch (err) {
    if (err instanceof AllegroApiException && err.statusCode === 404) {
      return null;
    }
    throw err;
  }
}
```

**Error contract** (concrete per tech-review SUGGESTION #8):
- **404** → `null`. Only Allegro's "offer not yet classified" signal collapses. Sets up the caller for "we'll try again on the poll-service `validating → active` hook".
- **Anything else** propagates: 400 / 422 (malformed offer-id — impossible in our flow but still propagate so a bug surfaces), 403 (permission lost — operator-actionable), 5xx (Allegro infra), network errors. Caller (handler / poll service) catches + logs + degrades — Smart-readback failure must NOT fail the offer-creation job (AC-7).

### 4.2 Mapper

```ts
function mapToNeutralReport(
  raw: AllegroSmartOfferClassificationReport,
): SmartClassificationReport {
  return {
    fulfilled: raw.classification?.fulfilled ?? null,
    conditions: (raw.conditions ?? []).map(c => ({
      code: c.code,
      name: c.name,
      description: c.description,
      fulfilled: c.fulfilled,
    })),
    scheduledForReclassification: raw.scheduledForReclassification,
  };
}
```

Drops `smartDeliveryMethods` + `passed/failedDeliveryMethods` (deprecated 2026-07-28 per swagger).

### 4.3 Adapter `implements` list

`AllegroOfferManagerAdapter` adds `OfferSmartClassificationReader` (now 14 sub-capabilities — same growth pattern as #735's `EanCategoryMatcher`).

---

## 5. Worker handler V2

### 5.1 Detection

The V2 payload is already defined and emitted by #736's `OfferCreationEnqueueService` when `input.bulkBatchId !== undefined`. The handler discriminates by presence:

```ts
function isV2Payload(
  p: MarketplaceOfferCreatePayloadV1 | MarketplaceOfferCreatePayloadV2,
): p is MarketplaceOfferCreatePayloadV2 {
  return 'bulkBatchId' in p && typeof p.bulkBatchId === 'string';
}
```

Per SUGGESTION #6: keep the presence-based predicate; if a V3 ever lands, refactor to a discriminant field at that time.

### 5.2 Flow

```
1. Parse payload (zod-validated). Extend existing schema to cover V2 fields.
2. If isV2 + generateDescription === true:
     a. Try contentSuggestionService.suggestDescription({
          channel: 'allegro', variantId, tone: payload.descriptionTone,
        })
     b. On success: overrides.description = aiResult.description
     c. On failure: log warn, fall through — operator override or
        builder default takes over. AI failure does NOT fail the job
        (Q3 outcome).
3. Call offerCreationExecutionService.executeCreation(payload).
   This still owns OfferCreationRecord status updates (success + failure).
4. If isV2: derive outcome from result.outcome ('ok' → 'succeeded',
   'business_failure' → 'failed').
5. If isV2 + result.outcome === 'ok' + externalOfferId present:
     a. Resolve adapter via integrationsService.getCapabilityAdapter<OfferManagerPort>(connectionId, 'OfferManager').
     b. Narrow via isOfferSmartClassificationReader(adapter).
     c. If supported: try { report = await adapter.getOfferSmartClassification(externalOfferId) }
        catch { log warn; report = null }
     d. Persist via offerCreationRecordRepository.updateClassificationReport(recordId, report).
6. If isV2: await bulkOfferCreationProgressService.advanceBatchStatus(
     payload.bulkBatchId,
     result.offerCreationRecord.id,
     outcome
   ).
   The service does at-most-once via the advancement table — on retry,
   skips the increment cleanly. Handler doesn't need its own guard.
7. Return SyncJobHandlerResult per existing #391/#400 outcome contract.
```

### 5.3 Backwards-compat

V1 payloads skip steps 2 / 4 / 5 / 6 entirely. Reduces to today's behaviour.

---

## 6. Poll-service Smart hook (per Q4)

`OfferStatusPollService` already handles the `validating → active` transition for offers that need async Allegro validation (per its existing implementation). When that transition happens, it currently calls `updateExternalIdAndStatus` on the record. New hook:

```ts
// In OfferStatusPollService, in the branch where status transitions to 'active'
// (or for the first time a non-validating-status is observed):
if (newStatus === OFFER_CREATION_STATUS.Active) {
  // Best-effort Smart readback. Mirrors the handler's try/catch shape.
  const adapter = await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(
    connectionId, 'OfferManager',
  );
  if (isOfferSmartClassificationReader(adapter)) {
    let report: SmartClassificationReport | null = null;
    try {
      report = await adapter.getOfferSmartClassification(externalOfferId);
    } catch (err) {
      this.logger.warn(`Smart readback failed during poll: ${(err as Error).message}`);
    }
    await this.offerCreationRecordRepository.updateClassificationReport(recordId, report);
  }
}
```

The poll service already has the right injections (`integrationsService`, `offerCreationRecordRepository`) — no constructor changes. Adding the Smart-readback call is ~10 lines.

**Why we read at create-success AND on `validating → active`**: offers that come back `active` immediately get Smart-classified at create time (one call, one read). Offers that go through `validating` get a placeholder `null` at create time + a definitive read once they're `active`. AC-7 is satisfied for both paths.

---

## 7. Worker AI wiring (with Q5 sub-barrel promotion)

### 7.1 The promotion

Move `apps/api/src/content/content.module.ts` → `libs/core/src/content/services/content.module.ts`. Update `libs/core/package.json` to export the new sub-barrel:

```json
{
  "exports": {
    "./content/services": "./dist/content/services/index.js",
    // ... existing entries
  }
}
```

Add `libs/core/src/content/services/index.ts` that exports `ContentModule`.

### 7.2 Verification step (per IMPORTANT #3)

Before committing the move:
- `pnpm --filter @openlinker/api start:dev` (or boot via test) — confirm API still serves the existing `/content/*` and `/ai/prompt-templates/*` endpoints.
- `pnpm test` — full suite passes, no API-side imports left dangling.
- `pnpm lint` — `check-cross-context-imports.mjs` invariant doesn't fire (the existing API → content imports are not cross-context; they become consumer-of-core, which is the standard shape).

Captured as **Step 11.5** in the implementation order.

### 7.3 Worker plugin registration

`apps/worker/src/plugins.ts`:

```ts
import { AiIntegrationModule } from '@openlinker/integrations-ai';

export const workerPlugins: PluginEntry[] = [
  // ... existing plugins ...
  AiIntegrationModule.register(),
];
```

This makes `AI_COMPLETION_PORT_TOKEN` resolvable in the worker's DI graph.

### 7.4 Worker content module import

`apps/worker/src/sync/sync-worker.module.ts`:

```ts
import { ContentModule } from '@openlinker/core/content/services';

@Module({
  imports: [
    // ... existing imports ...
    ContentModule,
  ],
  // ...
})
```

Handler can now `@Inject(CONTENT_SUGGESTION_SERVICE_TOKEN)`.

---

## 8. Implementation steps (ordered)

| # | Step | File(s) | AC |
|---|---|---|---|
| 1 | Add `SmartClassificationReport` + `SmartClassificationCondition` types | `libs/core/src/listings/domain/types/smart-classification.types.ts` (new) | Type-only, no framework deps |
| 2 | Add `OfferSmartClassificationReader` capability + `isOfferSmartClassificationReader` guard | `libs/core/src/listings/domain/ports/capabilities/offer-smart-classification-reader.capability.ts` (new) | Mirrors #735's `EanCategoryMatcher` shape |
| 3 | Widen `OfferCreationRecord` entity with `classificationReport: SmartClassificationReport \| null = null` | `libs/core/src/listings/domain/entities/offer-creation-record.entity.ts` | Default null; existing instantiation sites compile unchanged |
| 4 | Extend `OfferCreationRecordRepositoryPort` with `updateClassificationReport` | `libs/core/src/listings/domain/ports/offer-creation-record-repository.port.ts` | Throws `OfferCreationRecordNotFoundException` on missing |
| 5 | Add ORM column + repo impl | `libs/core/src/listings/infrastructure/persistence/{entities,repositories}/offer-creation-record.*` | `classificationReport jsonb`, nullable, no default |
| 6 | Add `BulkBatchAdvancement` entity + port + ORM entity + repository | `libs/core/src/listings/domain/{entities,ports}/bulk-batch-advancement*` + `infrastructure/persistence/{entities,repositories}/bulk-batch-advancement.*` (new — 4 files) | Composite-PK ORM entity; `markAdvancedIfNotExists` via INSERT ON CONFLICT DO NOTHING |
| 7 | Add `BulkOfferCreationProgressService` interface + impl | `libs/core/src/listings/application/services/bulk-offer-creation-progress.service.{interface,ts}` (new) | At-most-once guard + counter increment + terminal-status derivation |
| 8 | Add new tokens + register the new service & repository in `ListingsModule` | `libs/core/src/listings/listings.tokens.ts` + `libs/core/src/listings/services/listings.module.ts` | `BULK_OFFER_CREATION_PROGRESS_SERVICE_TOKEN`, `BULK_BATCH_ADVANCEMENT_REPOSITORY_TOKEN` |
| 9 | Migration: column + table | `apps/api/src/migrations/1799000000000-add-smart-classification-and-batch-advancements.ts` (new) | Single migration; `up()` and `down()` both implemented |
| 10 | Allegro raw type + adapter method + `implements` update | `libs/integrations/allegro/src/{domain/types,infrastructure/adapters}/...` | 404 → null; everything else propagates |
| 11 | Update listings barrel | `libs/core/src/listings/index.ts` | Re-export new types, capability, guard, progress-service interface, both new tokens |
| **11.5** | **Move `ContentModule` to `@openlinker/core/content/services`** + verification | `libs/core/src/content/services/{content.module.ts,index.ts}` + `libs/core/package.json` exports + update `apps/api`'s import | API boots locally; existing `/content/*` endpoints respond; `pnpm test` green; `check-cross-context-imports.mjs` doesn't fire |
| 12 | Wire worker AI: plugin registration + ContentModule import | `apps/worker/src/plugins.ts` + `apps/worker/src/sync/sync-worker.module.ts` | `CONTENT_SUGGESTION_SERVICE_TOKEN` resolvable in worker |
| 13 | Extend handler V2 branch | `apps/worker/src/sync/handlers/marketplace-offer-create.handler.ts` | V1 backwards-compat preserved; V2 path runs AI before + Smart + progress after |
| 14 | Extend `OfferStatusPollService` with Smart-readback hook | `libs/core/src/listings/application/services/offer-status-poll.service.ts` | On `validating → active` transition, best-effort Smart readback |
| 15 | Handler unit spec (8 cases) | `apps/worker/src/sync/handlers/marketplace-offer-create.handler.spec.ts` | Per § 9.1 |
| 16 | `BulkOfferCreationProgressService` spec (6 cases) | `libs/core/src/listings/application/services/__tests__/bulk-offer-creation-progress.service.spec.ts` (new) | Per § 9.2 |
| 17 | `OfferStatusPollService` Smart-hook spec (additive 3 cases) | existing `offer-status-poll.service.spec.ts` | Per § 9.3 |
| 18 | Adapter `getOfferSmartClassification` spec (5 cases) | `allegro-offer-manager.adapter.spec.ts` (additive) | Per § 9.4 |
| 19 | Integration spec — 5-job batch end-to-end | `apps/api/test/integration/listings/bulk-offer-creation.int-spec.ts` | Per § 9.5; existing test harness |
| 20 | Update `docs/architecture-overview.md § 13 AI` | `docs/architecture-overview.md` | Replace "not required for #342" note per SUGGESTION #5 wording |
| 21 | Update `docs/engineering-standards.md § Import Aliases` | `docs/engineering-standards.md` | Add `@openlinker/core/content/services` to sub-barrel list |
| 22 | Quality gate | — | `pnpm lint && pnpm type-check && pnpm test && pnpm test:integration` all green |

---

## 9. Tests

### 9.1 Handler unit spec — 8 cases

| # | Case | Coverage |
|---|---|---|
| 1 | V1 payload (no `bulkBatchId`) | Today's path: `executeCreation` called; no AI, no Smart, no progress |
| 2 | V2 + no `generateDescription`, success | AI NOT called; Smart called; progress.advanceBatchStatus called |
| 3 | V2 + `generateDescription: true`, AI succeeds | AI called with `{channel:'allegro', variantId, tone}`; result threaded into `overrides.description` |
| 4 | V2 + `generateDescription: true`, AI throws | Warning logged; falls back to `overrides.description` or builder default; `executeCreation` still called; job succeeds |
| 5 | V2 + success, Smart readback throws (5xx) | Warning logged; `updateClassificationReport(recordId, null)` called; counter still advanced; job succeeds |
| 6 | V2 + success, Smart readback returns null (404) | `updateClassificationReport(recordId, null)` called; counter advanced |
| 7 | V2 + `executeCreation` returns `outcome: 'business_failure'` | No Smart readback; counter advanced via `advanceBatchStatus(..., 'failed')` |
| 8 | V2 retry path (advancement already marked) | `executeCreation` runs; `advanceBatchStatus` returns null (`created: false`); no double-increment |

### 9.2 `BulkOfferCreationProgressService` spec — 6 cases

| # | Case | Coverage |
|---|---|---|
| 1 | First-time advancement, not yet terminal (1 of 5 succeeded) | `markAdvancedIfNotExists` returns `created: true`; `incrementCounters({succeeded:1})` called; `updateStatus` NOT called; returns null |
| 2 | All succeeded (5 of 5) | Status → `completed` |
| 3 | All failed (5 of 5) | Status → `failed` |
| 4 | Mixed (3 succeeded + 2 failed) | Status → `partially-failed` |
| 5 | `outcome: 'failed'` input | `incrementCounters({failed:1})` (verifies branch) |
| 6 | Retry path: `markAdvancedIfNotExists` returns `created: false` | `incrementCounters` NOT called; returns null; logs debug |

### 9.3 `OfferStatusPollService` Smart-hook spec — 3 additive cases

| # | Case | Coverage |
|---|---|---|
| 1 | Transition `validating → active` + adapter supports Smart | `getOfferSmartClassification` called; `updateClassificationReport` called with the report |
| 2 | Transition `validating → active` + Smart readback throws | Warning logged; `updateClassificationReport(recordId, null)` called; poll iteration succeeds |
| 3 | Transition `validating → failed` (no Smart applicable) | Smart NOT called; existing failure path unchanged |

### 9.4 Adapter spec — 5 cases

Per swagger schema verification:

| # | Case | Coverage |
|---|---|---|
| 1 | 200 + classification.fulfilled=true | Neutral report; conditions mapped; deprecated fields dropped |
| 2 | 200 + classification.fulfilled=false + conditions[] | Failed conditions surfaced |
| 3 | 404 | Returns `null` (no throw) |
| 4 | 5xx | Throws `AllegroApiException` |
| 5 | `isOfferSmartClassificationReader(adapter) === true` (guard assertion) | Capability registered |

### 9.5 Integration spec — 5-job batch end-to-end

Per issue AC. Location: `apps/api/test/integration/listings/bulk-offer-creation.int-spec.ts`.

1. Seed connection + 5 variants with EANs + a bulk batch.
2. POST `/bulk-offer-creations` → service enqueues 5 jobs.
3. Drain jobs via the test harness's worker (in-process).
4. Stub `AllegroOfferManagerAdapter`: 3 succeed, 2 fail.
5. Stub Smart endpoint: success → fulfilled=true; failure → 404.
6. Assert:
   - 5 `OfferCreationRecord` rows with expected statuses
   - 5 `bulk_batch_advancements` rows
   - Successful rows have `classificationReport` populated; failed have null
   - `BulkOfferCreationBatch.succeededCount = 3`, `failedCount = 2`, `status = 'partially-failed'`

---

## 10. Decisions locked

| # | Decision | Source | Why |
|---|---|---|---|
| 1 | **New `BulkOfferCreationProgressService`** (separate from submit service) | grill-me Q1 | Per-phase orchestration pattern (matches `OfferCreationEnqueueService` / `OfferCreationExecutionService` / `OfferStatusPollService`); submit-side and progress-side have different concurrency profiles + different consumers |
| 2 | **At-most-once guard via `bulk_batch_advancements` join table** (not a column on `offer_creation_records`) | tech-review IMPORTANT #2 | Keeps `OfferCreationRecord` pure (single-offer concept); INSERT ON CONFLICT DO NOTHING is race-free; one table grows with bulk-flow activity but stays cleanly orthogonal to the single-offer concept |
| 3 | **AI failure → log + fall through** (no status column) | grill-me Q3 | Operator override or builder default takes over; matches the AC-7 Smart-readback shape for symmetry; offer still ships to Allegro |
| 4 | **Smart readback at handler create-success AND poll-service `validating → active` hook** | grill-me Q4 | At create time: covers offers that come back `active` immediately. At poll time: covers offers that go through `validating`. AC-7 is satisfied for both paths |
| 5 | **Promote `ContentModule` to `@openlinker/core/content/services`** sub-barrel | grill-me Q5 | Mirrors `@openlinker/core/listings/services` precedent; single source of truth across `apps/api` and `apps/worker`; eliminates mirror-module maintenance drift |
| 6 | **Single `classificationReport jsonb` column** (neutral name, not `smartReport`) | grill-me Q6 + tech-review IMPORTANT #1 | jsonb is forward-compat against Allegro response shape changes; "classification" is the neutral domain term (Smart is Allegro's brand for the same concept); future marketplaces with classification can reuse |
| 7 | **Bare-string `getOfferSmartClassification(externalOfferId)`** | grill-me Q7 | Matches sibling capability shape (`getOfferStatus`, `getOffer`, `matchCategoryByBarcode`); shape-based rule in this codebase (single-arg = bare, multi-arg = object) |
| 8 | **404 → null; everything else throws** in the Allegro adapter | tech-review SUGGESTION #8 | Crisp error contract; 404 is "not yet classified" (Allegro's documented signal); everything else surfaces (operator-actionable or infra failure) |
| 9 | **Capability port lives on `OfferManagerPort` as a sub-capability** | #337 precedent | Uniform with the existing 13 sub-capabilities on the Allegro adapter |
| 10 | **Migration timestamp `1799000000000`** | repo state | Most recent migration is `1798000000000` (#734's bulk-offer-creation-batches); next free slot |
| 11 | **No `as const` runtime values** for `SmartClassificationReport` | Allegro's free-form `code`/`name`/`description` strings | The enum-shaped runtime array isn't applicable; structural type only |

---

## 11. Residual risks

- **Migration timestamp collision**: `1799000000000`. Lint catches collisions via `check-migration-timestamps.mjs`.
- **`ContentModule` move risk**: § 7.2 verification gate (Step 11.5) catches regression to the API's existing endpoints before commit. The diff touches paths in `apps/api/src/` so reviewers will see the impact clearly.
- **AI flake amplification**: if the LLM provider has a bad hour, every job in a 50-row batch logs a warning and falls through. Operationally noisy but doesn't fail jobs. FE (#741) may want to surface "AI didn't run for these N rows" — out of scope here but flagged for #741.
- **Smart readback timing on first attempt**: offers that come back `active` immediately are read for Smart status at create-time. Allegro's docs note Smart classification can take a few seconds-to-minutes post-create. If we read too eagerly and Allegro returns 404, we persist null; the poll-service hook covers the `validating → active` path, but offers that come back `active` immediately and aren't yet classified end up with null forever in #737's scope. The plan accepts this — the `scheduledForReclassification` field on the report shape gives the FE a signal to poll-or-refresh manually if needed. A future follow-up could add periodic re-reads for null-classification offers.
- **Counter-advancement at-most-once across concurrent workers**: the `bulk_batch_advancements` table uses a composite-PK INSERT-ON-CONFLICT-DO-NOTHING. Two workers attempting the same `(batchId, recordId)` see exactly one `created: true` and one `created: false`. Counter increments accordingly. Verified safe.
- **Sub-barrel precedent now 4 deep**: `listings/services`, `<ctx>/orm-entities`, `<ctx>/testing`, and now `content/services`. The engineering-standards doc § Import Aliases needs updating (Step 21).

---

## 12. After this PR

- #742 (bulk retry-failed endpoint) — depends on this; retry re-enqueues failed records, and the `bulk_batch_advancements` row from the failed attempt is removed (or the advancement row is checked against `OfferCreationRecord.status` for "retry-eligible") so the new attempt re-counts correctly.
- #739–#741 (FE) — start landing once this is merged.
- Architecture-overview § 13 AI flips from "not required for #342" to "Wired in #737".
