/**
 * Bulk Batch Drain Helper (#742)
 *
 * Synchronously drains pending children of a `BulkListingBatch` for
 * int-spec end-to-end coverage. Stands in for the worker handler when the
 * worker process isn't booted: invokes `IOfferCreationExecutionService`
 * + `IBulkListingProgressService` directly per-record, mirroring the
 * `MarketplaceOfferCreateHandler.execute(job)` V2 path step-by-step.
 *
 * The fake adapter registered by `allegro-test-offer-manager-stub.helper.ts`
 * controls each record's outcome — the drain helper just walks the records
 * the upstream code path enqueued.
 *
 * Limitations vs real worker:
 *  - Reads pending records via TypeORM repository (not Redis stream). The
 *    stream-to-DB path is covered by the existing sync-jobs int-specs.
 *  - Skips AI description generation (the test stub doesn't need it; the
 *    AI suggestion is tested separately in the worker handler unit spec).
 *  - Doesn't poll Allegro for `validating → active` transitions; tests
 *    script terminal outcomes directly via `setNextCreateResult`.
 *
 * @module apps/api/test/integration/helpers
 */
import {
  BULK_LISTING_PROGRESS_SERVICE_TOKEN,
  BULK_LISTING_SUBMIT_SERVICE_TOKEN,
  IBulkListingProgressService,
  IBulkListingSubmitService,
  IOfferCreationExecutionService,
  OFFER_CREATION_EXECUTION_SERVICE_TOKEN,
} from '@openlinker/core/listings';

import type { IntegrationTestHarness } from '../setup';

export interface BulkBatchDrainResult {
  /** Per-record outcome in drain order, mirroring `sync_jobs.outcome`. */
  outcomes: Array<{ recordId: string; outcome: 'ok' | 'business_failure' }>;
}

/**
 * Drain every `offer_creation_records` row in the batch that's still at
 * `status='pending'`. For each: call `executeCreation` (which hits the
 * registered fake adapter and persists the terminal status), then call
 * `advanceBatchStatus` on the progress service to mirror the worker
 * handler's V2-path counter-advance.
 *
 * Returns the per-record outcomes for the test's terminal-state assertions.
 */
export async function drainBulkBatch(
  harness: IntegrationTestHarness,
  batchId: string
): Promise<BulkBatchDrainResult> {
  const app = harness.getApp();
  const executeService = app.get<IOfferCreationExecutionService>(
    OFFER_CREATION_EXECUTION_SERVICE_TOKEN
  );
  const progressService = app.get<IBulkListingProgressService>(
    BULK_LISTING_PROGRESS_SERVICE_TOKEN
  );
  const submitService = app.get<IBulkListingSubmitService>(
    BULK_LISTING_SUBMIT_SERVICE_TOKEN
  );

  const summary = await submitService.getBatch(batchId);
  if (!summary) {
    throw new Error(`drainBulkBatch: batch ${batchId} not found`);
  }
  const pending = summary.records.filter((r) => r.status === 'pending');

  const outcomes: Array<{ recordId: string; outcome: 'ok' | 'business_failure' }> = [];

  for (const row of pending) {
    if (!row.request) {
      throw new Error(
        `drainBulkBatch: record ${row.id} has request=null; the fake-adapter int-spec assumes #736+ schema.`
      );
    }
    const result = await executeService.executeCreation({
      internalVariantId: row.internalVariantId,
      connectionId: row.connectionId,
      stock: row.request.stock,
      publishImmediately: row.request.publishImmediately,
      ...(row.request.price !== undefined && { price: row.request.price }),
      ...(row.request.overrides !== undefined && {
        overrides: row.request.overrides,
      }),
      offerCreationRecordId: row.id,
    });

    const batchOutcome = result.outcome === 'ok' ? 'succeeded' : 'failed';
    await progressService.advanceBatchStatus(batchId, row.id, batchOutcome);

    outcomes.push({ recordId: row.id, outcome: result.outcome });
  }

  return { outcomes };
}
