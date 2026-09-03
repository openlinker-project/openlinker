/**
 * Place-hold dialog Zod schema (#2342)
 *
 * `reason` is required and validated against the mirrored closed vocabulary, so
 * the form cannot submit a value the backend's `@IsIn(HoldReasonValues)` would
 * answer 400 for. `note` is genuinely optional here — the backend requires one
 * only on the RELEASE of a service-placed hold, never on placing.
 *
 * `maxLength` matches the DTO's `@MaxLength(2000)`: an operator should learn
 * they are over the limit while typing, not from a rejected submit.
 *
 * @module apps/web/src/features/orders/components
 */
import { z } from 'zod';

import { HoldReasonValues } from '../lib/order-hold.types';

export const HOLD_NOTE_MAX_LENGTH = 2000;

export const placeOrderHoldSchema = z.object({
  // The select renders no empty option, but a cleared/at-rest form value must
  // still say what is missing rather than zod's default "Invalid option".
  reason: z.enum(HoldReasonValues, { message: 'Choose why this order is being held' }),
  note: z
    .string()
    .max(HOLD_NOTE_MAX_LENGTH, `Keep the note under ${HOLD_NOTE_MAX_LENGTH} characters`)
    .optional(),
});

export type PlaceOrderHoldFormValues = z.input<typeof placeOrderHoldSchema>;
export type PlaceOrderHoldSubmission = z.output<typeof placeOrderHoldSchema>;
