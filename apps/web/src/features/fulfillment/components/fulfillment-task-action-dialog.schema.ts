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

import { interpolate, type Messages, type ResolvedCopy } from '../../../shared/i18n';
import { HoldReasonValues } from '../../orders';

export const FULFILLMENT_NOTE_MAX_LENGTH = 1000;

type SchemaCopy = ResolvedCopy<Messages['fulfillment']>['fulfillmentTaskActionSchema'];

/** Built per render from the active language's copy - messages never live at module level. */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- the zod object type is inferred; spelling it out would duplicate the schema
export function createFulfillmentTaskActionSchema(copy: SchemaCopy) {
  return z.object({
    reason: z.enum(HoldReasonValues, { message: copy.reasonRequired }).optional(),
    note: z
      .string()
      .max(
        FULFILLMENT_NOTE_MAX_LENGTH,
        interpolate(copy.noteTooLong, { max: FULFILLMENT_NOTE_MAX_LENGTH })
      )
      .optional(),
  });
}

type FulfillmentTaskActionSchema = ReturnType<typeof createFulfillmentTaskActionSchema>;

export type FulfillmentTaskActionFormValues = z.input<FulfillmentTaskActionSchema>;
export type FulfillmentTaskActionSubmission = z.output<FulfillmentTaskActionSchema>;
