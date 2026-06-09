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

/**
 * COD currencies the carrier accepts. **FE mirror** of the BE
 * `DpdCodCurrencyValues` (`libs/integrations/dpd-polska/.../dpd-rest.types.ts`).
 * DPD is the only COD-capable carrier today, so this carrier-neutral form
 * carries DPD's set; if a second COD carrier with a different set ships, source
 * this per-platform instead of widening here. Keep in sync with the BE — same
 * FE↔BE value-drift discipline as `SHIPPING_METHOD_VALUES` (#966).
 */
export const COD_CURRENCY_VALUES = ['PLN', 'EUR', 'RON', 'CZK'] as const;
export type CodCurrency = (typeof COD_CURRENCY_VALUES)[number];

export const generateLabelSchema = z.object({
  length: z.coerce.number().int().positive('Length must be a positive integer'),
  width: z.coerce.number().int().positive('Width must be a positive integer'),
  height: z.coerce.number().int().positive('Height must be a positive integer'),
  weightGrams: z.coerce.number().int().positive('Weight must be a positive integer'),
  paczkomatId: z.string().trim().optional(),
  // Optional cash-on-delivery (operator-supplied, #966). Empty amount ⇒ no COD.
  // COD-incapable carriers ignore it server-side; DPD translates it to the COD
  // service. Amount accepts a decimal string (comma or dot) — normalised at submit.
  codAmount: z
    .union([
      z.string().trim().regex(/^\d+([.,]\d{1,2})?$/, 'Enter a valid amount, e.g. 129.90'),
      z.literal(''),
    ])
    .optional(),
  codCurrency: z.enum(COD_CURRENCY_VALUES).optional(),
});

// Two derived types: `Values` is what RHF binds to (Zod's input type — for
// `z.coerce.number()` that's `unknown`, so `string` defaults pass through);
// `Submission` is the resolved post-coercion shape the submit handler sees.
export type GenerateLabelFormValues = z.input<typeof generateLabelSchema>;
export type GenerateLabelFormSubmission = z.output<typeof generateLabelSchema>;
