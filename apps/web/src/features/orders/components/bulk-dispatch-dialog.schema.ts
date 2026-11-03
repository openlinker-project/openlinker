/**
 * Bulk-dispatch dialog Zod schema (#1109)
 *
 * The shared parcel profile and every per-order override validate against the
 * SAME `parcelSchema` — an override can never submit dims/weight the single-order
 * form would have rejected (which would 422 mid-batch). Mirrors the parcel rules
 * in `generate-label-form.schema.ts`.
 *
 * @module apps/web/src/features/orders/components
 */
import { z } from 'zod';

import type { GenerateLabelValidationCopy } from './generate-label-form.schema';

/** The parcel rules read the single-order form's messages, so the two never drift. */
export type ParcelValidationCopy = Pick<
  GenerateLabelValidationCopy,
  'length' | 'width' | 'height' | 'weight'
>;

/**
 * Parcel dimensions + weight, shared by the batch profile and per-order rows.
 * A factory so the messages follow the active language.
 */
export function createParcelSchema(copy: ParcelValidationCopy) {
  return z.object({
    length: z.coerce.number().int().positive(copy.length),
    width: z.coerce.number().int().positive(copy.width),
    height: z.coerce.number().int().positive(copy.height),
    weightGrams: z.coerce.number().int().positive(copy.weight),
  });
}

type ParcelSchema = ReturnType<typeof createParcelSchema>;

export type ParcelFormValues = z.input<ParcelSchema>;
export type ParcelSubmission = z.output<ParcelSchema>;
