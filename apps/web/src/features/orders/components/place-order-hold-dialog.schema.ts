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

import { interpolate } from '../../../shared/i18n';
import { HoldReasonValues } from '../lib/order-hold.types';
import type { HoldValidationCopy } from './order-form.types';

export const HOLD_NOTE_MAX_LENGTH = 2000;

/** The note-length message, shared by the place and release schemas. */
export function holdNoteTooLongMessage(copy: HoldValidationCopy): string {
  return interpolate(copy.noteTooLong, { max: HOLD_NOTE_MAX_LENGTH });
}

/**
 * A factory rather than a module-level schema: the messages are read when the
 * form builds its resolver, so they follow the active language.
 */
export function createPlaceOrderHoldSchema(copy: HoldValidationCopy) {
  return z.object({
    // The select renders no empty option, but a cleared/at-rest form value must
    // still say what is missing rather than zod's default "Invalid option".
    reason: z.enum(HoldReasonValues, { message: copy.reasonRequired }),
    note: z.string().max(HOLD_NOTE_MAX_LENGTH, holdNoteTooLongMessage(copy)).optional(),
  });
}

export type PlaceOrderHoldFormValues = z.input<ReturnType<typeof createPlaceOrderHoldSchema>>;
export type PlaceOrderHoldSubmission = z.output<ReturnType<typeof createPlaceOrderHoldSchema>>;
