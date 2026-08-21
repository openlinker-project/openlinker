/**
 * Bulk batch recovery helpers (#2234)
 *
 * A terminal batch with failures has two ways out, and they are not two
 * flavours of the same action: retry re-sends the saved payload (right for a
 * transient error), while a data fix reopens the bulk wizard on the failed
 * variants (the only thing that helps once the platform rejected the payload).
 * This module owns the pure half of the second road - which records are
 * recoverable, and the wizard URL that carries them.
 *
 * @module apps/web/src/features/listings/lib
 */
import type { BulkBatchRecordSummary } from '../api/bulk-listings.types';

/**
 * Product cap enforced by the bulk wizard route, which redirects back to
 * /products above it. Shared so the recovery action can disable itself with a
 * stated reason instead of routing into a bounce.
 */
export const MAX_WIZARD_PRODUCTS = 100;

/** Why the fix action cannot be offered for a given failed set. */
export const BatchFixBlockerValues = ['no-product-link', 'over-product-cap'] as const;
export type BatchFixBlocker = (typeof BatchFixBlockerValues)[number];

export interface BatchFixTarget {
  /** Deduped owning product ids of the failed records. */
  productIds: string[];
  /** Failed variant ids, in record order. */
  variantIds: string[];
  /** Set when the fix action must be disabled; null when it can be offered. */
  blocker: BatchFixBlocker | null;
}

/**
 * Resolve the wizard target for a set of records.
 *
 * `productId` is optional on the record summary, so a batch whose records
 * carry no product link yields `no-product-link` rather than a half-populated
 * URL - the wizard hydrates from product ids and would bounce to /products.
 */
export function resolveBatchFixTarget(
  records: readonly BulkBatchRecordSummary[],
): BatchFixTarget {
  const variantIds = records.map((record) => record.internalVariantId);
  const productIds = [
    ...new Set(
      records
        .map((record) => record.productId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ];

  let blocker: BatchFixBlocker | null = null;
  if (productIds.length === 0) {
    blocker = 'no-product-link';
  } else if (productIds.length > MAX_WIZARD_PRODUCTS) {
    blocker = 'over-product-cap';
  }

  return { productIds, variantIds, blocker };
}

/** Failed records of a batch, in the order the table renders them. */
export function selectFailedRecords(
  records: readonly BulkBatchRecordSummary[],
): BulkBatchRecordSummary[] {
  return records.filter((record) => record.status === 'failed');
}

/**
 * Bulk wizard URL carrying a recovery selection.
 *
 * `fromBatch` is read only to render the wizard's "resuming" banner - nothing
 * in the submit path consumes it.
 */
export function buildBatchFixUrl(input: {
  productIds: readonly string[];
  variantIds: readonly string[];
  connectionId: string;
  batchId: string;
}): string {
  const params = new URLSearchParams({
    productIds: input.productIds.join(','),
    variantIds: input.variantIds.join(','),
    connectionId: input.connectionId,
    fromBatch: input.batchId,
  });
  return `/listings/bulk-create/wizard?${params.toString()}`;
}

/** Operator-facing reason a fix cannot be offered. */
export function describeBatchFixBlocker(blocker: BatchFixBlocker): string {
  switch (blocker) {
    case 'no-product-link':
      return 'Fix and resubmit needs the product link, which this batch did not record. Retry is unaffected.';
    case 'over-product-cap':
      return `Fix and resubmit handles up to ${MAX_WIZARD_PRODUCTS.toString()} products at a time. Retry is unaffected.`;
  }
}
