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

/** Parcel dimensions + weight, shared by the batch profile and per-order rows. */
export const parcelSchema = z.object({
  length: z.coerce.number().int().positive('Length must be a positive integer'),
  width: z.coerce.number().int().positive('Width must be a positive integer'),
  height: z.coerce.number().int().positive('Height must be a positive integer'),
  weightGrams: z.coerce.number().int().positive('Weight must be a positive integer'),
});

export type ParcelFormValues = z.input<typeof parcelSchema>;
export type ParcelSubmission = z.output<typeof parcelSchema>;
