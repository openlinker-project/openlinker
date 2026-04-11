/**
 * Edit Offer Fields Schema
 *
 * Zod schema and types for the EditOfferDrawer form.
 *
 * @module apps/web/src/features/listings/components
 */
import { z } from 'zod';

export const editOfferFieldsSchema = z.object({
  title: z.string().max(75, 'Title must be 75 characters or fewer').optional(),
  priceAmount: z
    .string()
    .optional()
    .refine(
      (val) => val === undefined || val === '' || /^\d+(\.\d{1,2})?$/.test(val),
      { message: 'Price must be a positive number with up to 2 decimal places' },
    ),
  priceCurrency: z.string().optional(),
  descriptionText: z.string().optional(),
});

export type EditOfferFieldsValues = z.input<typeof editOfferFieldsSchema>;
export type EditOfferFieldsSubmission = z.output<typeof editOfferFieldsSchema>;
