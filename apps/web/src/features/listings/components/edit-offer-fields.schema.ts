/**
 * Edit Offer Fields Schema
 *
 * Zod schema and types for the EditOfferDrawer form.
 *
 * @module apps/web/src/features/listings/components
 */
import { z } from 'zod';

import { interpolate } from '../../../shared/i18n';

import type { EditOfferFieldsValidationCopy } from './listing-form.types';

/** Longest offer title the destination accepts. */
export const EDIT_OFFER_TITLE_MAX_LENGTH = 75;

/**
 * A factory rather than a module-level schema: the messages are read when the
 * form builds its resolver, so they follow the active language.
 */
export function createEditOfferFieldsSchema(copy: EditOfferFieldsValidationCopy) {
  return z.object({
  title: z
    .string()
    .max(
      EDIT_OFFER_TITLE_MAX_LENGTH,
      interpolate(copy.titleTooLong, { max: EDIT_OFFER_TITLE_MAX_LENGTH }),
    )
    .optional(),
  priceAmount: z
    .string()
    .optional()
    .refine(
      (val) => val === undefined || val === '' || /^\d+(\.\d{1,2})?$/.test(val),
      { message: copy.priceInvalid },
    ),
  priceCurrency: z.string().optional(),
  descriptionText: z.string().optional(),
  });
}

type EditOfferFieldsSchema = ReturnType<typeof createEditOfferFieldsSchema>;
export type EditOfferFieldsValues = z.input<EditOfferFieldsSchema>;
export type EditOfferFieldsSubmission = z.output<EditOfferFieldsSchema>;
