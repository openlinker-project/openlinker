/**
 * Generate-label form Zod schema (#769)
 *
 * Captures parcel dimensions + weight; the rest of `GenerateLabelInput` is
 * resolved from the order's snapshot at submit time (source connection,
 * delivery method id, recipient, paczkomatId).
 *
 * @module apps/web/src/features/orders/components
 */
import { z } from 'zod';

export const generateLabelSchema = z.object({
  length: z.coerce.number().int().positive('Length must be a positive integer'),
  width: z.coerce.number().int().positive('Width must be a positive integer'),
  height: z.coerce.number().int().positive('Height must be a positive integer'),
  weightGrams: z.coerce.number().int().positive('Weight must be a positive integer'),
  paczkomatId: z.string().trim().optional(),
});

// Two derived types: `Values` is what RHF binds to (Zod's input type — for
// `z.coerce.number()` that's `unknown`, so `string` defaults pass through);
// `Submission` is the resolved post-coercion shape the submit handler sees.
export type GenerateLabelFormValues = z.input<typeof generateLabelSchema>;
export type GenerateLabelFormSubmission = z.output<typeof generateLabelSchema>;
