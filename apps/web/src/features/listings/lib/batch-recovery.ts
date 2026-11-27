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
import { getMessages, interpolate } from '../../../shared/i18n';
import type { BulkBatchRecordSummary, BulkOfferOverrides } from '../api/bulk-listings.types';
import type { OfferParameter } from '../api/listings.types';
import type { CategoryParameterFormValues } from '../components/category-parameter-form.types';

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
 * `fromBatch` renders the wizard's "resuming" banner and tells the route which
 * batch's saved requests to prefill from (#4037); nothing in the submit path
 * consumes it.
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

/**
 * What the resumed wizard restores for one failed variant (#4037): the
 * overrides it was submitted with, plus the category parameters as the editor's
 * form state so the editor opens on them instead of empty.
 */
export interface RecoveryPrefillEntry {
  overrides: BulkOfferOverrides;
  formParameters: CategoryParameterFormValues;
}

/** Snapshot versions this reader understands; anything else degrades to no prefill. */
const KNOWN_SNAPSHOT_SCHEMA_VERSION = 1;

/**
 * Wire parameters back to the editor's flat form state. The schema is not
 * known here, so a parameter with several chosen ids becomes a list and one
 * with a single value a string; the serializer tolerates a string for a
 * multi-choice parameter.
 */
export function offerParametersToFormValues(
  parameters: readonly OfferParameter[],
): CategoryParameterFormValues {
  const out: CategoryParameterFormValues = {};
  for (const p of parameters) {
    if (p.rangeValue) out[p.id] = { from: p.rangeValue.from, to: p.rangeValue.to };
    else if (p.valuesIds && p.valuesIds.length > 1) out[p.id] = [...p.valuesIds];
    else if (p.valuesIds && p.valuesIds.length === 1) out[p.id] = p.valuesIds[0];
    else if (p.values && p.values.length > 0) out[p.id] = p.values[0];
  }
  return out;
}

/**
 * Prefill for the failed variants of a batch, keyed by variant id.
 *
 * Reads only the saved request's overrides. Price and stock are deliberately
 * not restored: they are the policy's resolved figures at submit time, and
 * freezing them as overrides would stop the resumed wizard from following the
 * master. Known limit: a barcode the operator cleared (#4036) is sent as an
 * absent EAN, so it cannot be told apart from an unchanged master barcode and
 * is not restored.
 */
export function buildRecoveryPrefill(
  records: readonly BulkBatchRecordSummary[],
  variantIds: ReadonlySet<string>,
): Map<string, RecoveryPrefillEntry> {
  const out = new Map<string, RecoveryPrefillEntry>();
  for (const record of records) {
    if (record.status !== 'failed') continue;
    if (!variantIds.has(record.internalVariantId)) continue;
    const request = record.request;
    if (!request || request.schemaVersion !== KNOWN_SNAPSHOT_SCHEMA_VERSION) continue;
    if (!request.overrides) continue;
    const overrides = { ...request.overrides };
    out.set(record.internalVariantId, {
      overrides,
      formParameters: offerParametersToFormValues(overrides.parameters ?? []),
    });
  }
  return out;
}

/** Operator-facing reason a fix cannot be offered. */
export function describeBatchFixBlocker(blocker: BatchFixBlocker): string {
  const copy = getMessages('listings').batchRecovery.blockers;
  switch (blocker) {
    case 'no-product-link':
      return copy.noProductLink;
    case 'over-product-cap':
      return interpolate(copy.overProductCap, { max: MAX_WIZARD_PRODUCTS });
  }
}
