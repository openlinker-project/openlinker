/**
 * CreateOfferRequest → form-values mapper
 *
 * Maps a persisted `CreateOfferRequest` snapshot (from a failed
 * `OfferCreationRecord.request`) into the wizard's form shape so Retry
 * can re-open with every field pre-populated. Kept pure so it's trivially
 * testable and usable outside the wizard.
 *
 * Wire → form deltas handled here:
 * - `price.amount` is `number` on the wire but the wizard's Input types
 *   it as `string` (so the operator can edit freely and Zod validates
 *   the decimal pattern at submit).
 * - `overrides.description` is `string | null | undefined` on the wire;
 *   the form treats any missing/null as empty string.
 * - `overrides.platformParams` is the escape hatch where Allegro policy
 *   IDs live. Pull the four known keys into first-class form fields.
 *
 * @module apps/web/src/features/listings/components
 */
import {
  SUPPORTED_OFFER_CREATION_REQUEST_SCHEMA_VERSION,
  type CreateOfferRequest,
} from '../api/listings.types';
import {
  CREATE_OFFER_DEFAULT_VALUES,
  type CreateOfferFieldsValues,
} from './create-offer-fields.schema';

function readString(params: Record<string, unknown> | undefined, key: string): string {
  const value = params?.[key];
  return typeof value === 'string' ? value : '';
}

/**
 * Guard against reading a snapshot persisted by a server newer than the
 * client. `undefined` is tolerated for records persisted before the
 * schema version field landed — those are structurally identical to v1
 * so the mapping is safe.
 */
export function canReadCreateOfferRequestSnapshot(request: CreateOfferRequest): boolean {
  const version = request.schemaVersion;
  return version === undefined || version === SUPPORTED_OFFER_CREATION_REQUEST_SCHEMA_VERSION;
}

export function createOfferRequestToFormValues(
  request: CreateOfferRequest,
  connectionId: string,
): CreateOfferFieldsValues {
  const overrides = request.overrides;
  const platformParams = overrides?.platformParams;

  return {
    ...CREATE_OFFER_DEFAULT_VALUES,
    connectionId,
    internalVariantId: request.internalVariantId,
    // Variant label is not part of the wire shape; left blank — Review step
    // falls back to the raw id, which is acceptable on a retry where the
    // operator is re-confirming known values.
    variantLabel: '',
    title: overrides?.title ?? '',
    categoryId: overrides?.categoryId ?? '',
    priceAmount: request.price ? request.price.amount.toFixed(2) : '',
    priceCurrency: request.price?.currency ?? CREATE_OFFER_DEFAULT_VALUES.priceCurrency,
    stock: request.stock,
    description: overrides?.description ?? '',
    publishImmediately: request.publishImmediately,
    deliveryPolicyId: readString(platformParams, 'deliveryPolicyId'),
    returnPolicyId: readString(platformParams, 'returnPolicyId'),
    warrantyId: readString(platformParams, 'warrantyId'),
    impliedWarrantyId: readString(platformParams, 'impliedWarrantyId'),
  };
}
