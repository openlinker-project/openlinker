/**
 * Create Offer Fields Schema
 *
 * Zod schema and types for the CreateOfferWizard form. Covers all four
 * steps in a single schema so `form.trigger(stepFields)` can validate
 * incrementally. Field names mirror the wire shape where sensible so
 * the submit-time mapping in the wizard is straightforward.
 *
 * @module apps/web/src/features/listings/components
 */
import { z } from 'zod';

export const createOfferFieldsSchema = z.object({
  // Step 1 — Connection & Variant
  connectionId: z.string().min(1, 'Choose a connection'),
  internalVariantId: z
    .string()
    .regex(/^ol_variant_[a-f0-9]+$/, 'Pick a variant'),
  // Display label for the review step; not submitted to the API
  variantLabel: z.string().optional(),

  // Step 2 — Offer details
  title: z
    .string()
    .min(1, 'Title is required')
    .max(75, 'Title must be 75 characters or fewer'),
  categoryId: z.string().min(1, 'Allegro category ID is required'),
  priceAmount: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, 'Price must be a positive number with up to 2 decimal places'),
  priceCurrency: z.string().min(1),
  // RHF `valueAsNumber: true` hands us a `number`; Zod guards against NaN/empty.
  stock: z
    .number({ message: 'Stock must be a number' })
    .int('Stock must be an integer')
    .min(0, 'Stock must be 0 or greater'),
  description: z.string().optional(),
  publishImmediately: z.boolean(),

  // Step 3 — Policies
  deliveryPolicyId: z.string().min(1, 'Delivery policy is required'),
  returnPolicyId: z.string().optional(),
  warrantyId: z.string().optional(),
  impliedWarrantyId: z.string().optional(),
});

export type CreateOfferFieldsValues = z.input<typeof createOfferFieldsSchema>;
export type CreateOfferFieldsSubmission = z.output<typeof createOfferFieldsSchema>;

export const CREATE_OFFER_DEFAULT_VALUES: CreateOfferFieldsValues = {
  connectionId: '',
  internalVariantId: '',
  variantLabel: '',
  title: '',
  categoryId: '',
  priceAmount: '',
  priceCurrency: 'PLN',
  stock: 0,
  description: '',
  publishImmediately: false,
  deliveryPolicyId: '',
  returnPolicyId: '',
  warrantyId: '',
  impliedWarrantyId: '',
};
