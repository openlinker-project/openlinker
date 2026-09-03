/**
 * Fulfilment-action dialog schema (#2411)
 *
 * The three form-bearing actions share one shell, so they share one schema with
 * every field optional at the type level and required per mode by the caller's
 * `defaultValues` (`hold` always has a reason selected, so it cannot submit an
 * empty one).
 *
 * `maxLength` matches the DTO's `@MaxLength(1000)` on both note fields — an
 * operator should learn they are over the limit while typing, not from a
 * rejected submit.
 *
 * @module apps/web/src/features/fulfillment/components
 */
import { z } from 'zod';

import { HoldReasonValues } from '../../orders';

export const FULFILLMENT_NOTE_MAX_LENGTH = 1000;

export const fulfillmentTaskActionSchema = z.object({
  reason: z
    .enum(HoldReasonValues, { message: 'Choose why this fulfilment task is being held' })
    .optional(),
  note: z
    .string()
    .max(
      FULFILLMENT_NOTE_MAX_LENGTH,
      `Keep the note under ${FULFILLMENT_NOTE_MAX_LENGTH} characters`
    )
    .optional(),
});

export type FulfillmentTaskActionFormValues = z.input<typeof fulfillmentTaskActionSchema>;
export type FulfillmentTaskActionSubmission = z.output<typeof fulfillmentTaskActionSchema>;
