/**
 * CreateOfferRequest → Erli form-values mapper
 *
 * Maps a persisted `CreateOfferRequest` snapshot (from a failed / `reused`
 * `OfferCreationRecord.request`) into `ErliCreateOfferValues` so the Erli
 * wizard's Retry path re-opens with every field pre-populated — the Erli
 * counterpart to `createOfferRequestToFormValues` (Allegro). Kept pure so it's
 * trivially testable and usable outside the wizard.
 *
 * Wire → form deltas handled here:
 * - `price.amount` is `number` on the wire but the wizard types it as a
 *   `string` (operator edits freely; Zod validates the decimal at submit).
 * - `overrides.description` is `string | null | undefined` on the wire; the
 *   form treats any missing/null as empty string.
 * - dispatch time rides `overrides.platformParams.dispatchTime`; parsed via
 *   `isValidDispatch` and falling back to the supplied connection default when
 *   absent or malformed.
 *
 * The wizard reconstructs the variant CONTEXT (picked product for images,
 * EAN for category resolution) separately from the variant id — this mapper
 * only fills the form fields.
 *
 * @module features/listings/components/erli
 */
import {
  SUPPORTED_OFFER_CREATION_REQUEST_SCHEMA_VERSION,
  type CreateOfferRequest,
} from '../../api/listings.types';
import type { ErliCreateOfferValues } from './erli-create-offer.schema';
import { isValidDispatch, type ErliDispatchTimeParam } from './erli-offer-fields.schema';

/**
 * Guard against reading a snapshot persisted by a server newer than the
 * client. `undefined` is tolerated for records persisted before the schema
 * version field landed — they are structurally v1, so the mapping is safe.
 */
export function canReadErliOfferRequestSnapshot(request: CreateOfferRequest): boolean {
  const version = request.schemaVersion;
  return version === undefined || version === SUPPORTED_OFFER_CREATION_REQUEST_SCHEMA_VERSION;
}

export function createErliOfferRequestToFormValues(
  request: CreateOfferRequest,
  fallbackDispatch: ErliDispatchTimeParam,
): ErliCreateOfferValues {
  const overrides = request.overrides;
  const dispatchRaw = overrides?.platformParams?.dispatchTime;
  const dispatch: ErliDispatchTimeParam = isValidDispatch(dispatchRaw)
    ? { period: dispatchRaw.period, unit: dispatchRaw.unit ?? 'day' }
    : fallbackDispatch;

  return {
    internalVariantId: request.internalVariantId,
    // Variant label is not part of the wire shape; the wizard backfills it from
    // the reconstructed variant summary, and Review falls back to the raw id.
    variantLabel: '',
    title: overrides?.title ?? '',
    categoryId: overrides?.categoryId ?? '',
    priceAmount: request.price ? request.price.amount.toFixed(2) : '',
    stock: request.stock,
    description: overrides?.description ?? '',
    publishImmediately: request.publishImmediately,
    dispatchPeriod: dispatch.period,
    dispatchUnit: dispatch.unit,
  };
}

/**
 * Resolve the prefill in one step: the mapped form values when the snapshot is
 * readable, else `null` (unknown schema version → open a blank wizard). An
 * individually-invalid field still opens prefilled — the operator fixes it and
 * Zod validates at submit, matching the Allegro retry path.
 */
export function readErliOfferRequestPrefill(
  request: CreateOfferRequest | undefined,
  fallbackDispatch: ErliDispatchTimeParam,
): ErliCreateOfferValues | null {
  if (!request || !canReadErliOfferRequestSnapshot(request)) return null;
  return createErliOfferRequestToFormValues(request, fallbackDispatch);
}
