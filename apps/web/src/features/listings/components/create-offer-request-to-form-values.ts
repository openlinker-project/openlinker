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
  type CreateOfferOverrides,
  type CreateOfferRequest,
} from '../api/listings.types';
import {
  CREATE_OFFER_DEFAULT_VALUES,
  type CreateOfferFieldsValues,
} from './create-offer-fields.schema';
import type { CategoryParameterFormValues } from './category-parameter-form.types';

function readString(params: Record<string, unknown> | undefined, key: string): string {
  const value = params?.[key];
  return typeof value === 'string' ? value : '';
}

/**
 * Reverse the wire-shape `parameters[]` array Allegro accepts back into the
 * wizard's flat form-shape. Used by the retry path so a failed snapshot
 * re-opens with values visible to the operator. Without the parameter
 * meta we infer the form-side type from the wire payload:
 *
 *   - `rangeValue`             → `{ from, to }`
 *   - `valuesIds.length > 1`   → `string[]` (multi-select dictionary)
 *   - `valuesIds.length === 1` → `string`   (single dictionary)
 *   - `values.length >= 1`     → `string`   (scalar / custom-text first)
 *
 * Once the parameters meta resolves, the renderer interprets the raw value
 * correctly even when our heuristic guessed the wrong shape.
 *
 * Reads the neutral `overrides.parameters` (#1071); for pre-migration
 * persisted snapshots, falls back to the legacy Allegro-shaped
 * `platformParams.parameters` (offer) + `platformParams.productParameters`
 * (product). The form-state map is keyed by parameter id alone — re-submission
 * re-derives the section split from the freshly-loaded category-parameters
 * metadata, so the section distinction is not preserved on the form side.
 *
 * Exported for reuse by the Erli retry mapper (#1384) — both platforms
 * persist the same neutral `overrides.parameters` wire shape.
 */
export function readParameters(
  overrides: CreateOfferOverrides | undefined,
): CategoryParameterFormValues {
  const out: CategoryParameterFormValues = {};
  appendWireParameters(out, overrides?.parameters);
  // Transitional fallback for snapshots persisted before #1071.
  appendWireParameters(out, overrides?.platformParams?.parameters);
  appendWireParameters(out, overrides?.platformParams?.productParameters);
  return out;
}

function appendWireParameters(out: CategoryParameterFormValues, raw: unknown): void {
  if (!Array.isArray(raw)) return;

  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') continue;
    const e = entry as {
      id?: unknown;
      values?: unknown;
      valuesIds?: unknown;
      rangeValue?: unknown;
    };
    if (typeof e.id !== 'string' || e.id === '') continue;

    if (
      e.rangeValue !== undefined &&
      e.rangeValue !== null &&
      typeof e.rangeValue === 'object'
    ) {
      const r = e.rangeValue as { from?: unknown; to?: unknown };
      out[e.id] = {
        from: typeof r.from === 'string' ? r.from : '',
        to: typeof r.to === 'string' ? r.to : '',
      };
      continue;
    }

    if (Array.isArray(e.valuesIds) && e.valuesIds.every((v) => typeof v === 'string')) {
      const ids = e.valuesIds as string[];
      if (ids.length > 1) {
        out[e.id] = ids;
      } else if (ids.length === 1) {
        out[e.id] = ids[0];
      }
      continue;
    }

    if (Array.isArray(e.values) && e.values.every((v) => typeof v === 'string')) {
      const vals = e.values as string[];
      if (vals.length > 0) out[e.id] = vals[0];
    }
  }
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
    parameters: readParameters(overrides),
    deliveryPolicyId: readString(platformParams, 'deliveryPolicyId'),
    returnPolicyId: readString(platformParams, 'returnPolicyId'),
    warrantyId: readString(platformParams, 'warrantyId'),
    impliedWarrantyId: readString(platformParams, 'impliedWarrantyId'),
  };
}
