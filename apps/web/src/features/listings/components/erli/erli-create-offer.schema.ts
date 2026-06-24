/**
 * Erli single-offer wizard schema
 *
 * Field schema for `ErliCreateOfferWizard`. Erli offers are products — no
 * seller/delivery policies and no Allegro-style category parameters — so the
 * field set is smaller than Allegro's: variant, title, category (Allegro-id
 * reuse #985), price (PLN), stock, description, and dispatch time. Images come
 * from the master product (not operator-entered).
 *
 * @module features/listings/components/erli
 */
import { z } from 'zod';

import { erliOfferFieldsSchema } from './erli-offer-fields.schema';

export const erliCreateOfferSchema = z
  .object({
    internalVariantId: z.string().regex(/^ol_variant_[a-f0-9]+$/, 'Pick a variant'),
    variantLabel: z.string().optional(),
    title: z
      .string()
      .min(1, 'Title is required')
      .max(120, 'Title must be 120 characters or fewer'),
    categoryId: z.string().optional(),
    priceAmount: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/, 'Price must be a positive number with up to 2 decimal places'),
    stock: z
      .number({ message: 'Stock must be a number' })
      .int('Stock must be an integer')
      .min(0, 'Stock must be 0 or greater'),
    description: z.string().optional(),
    publishImmediately: z.boolean(),
  })
  .merge(erliOfferFieldsSchema);

export type ErliCreateOfferValues = z.infer<typeof erliCreateOfferSchema>;
