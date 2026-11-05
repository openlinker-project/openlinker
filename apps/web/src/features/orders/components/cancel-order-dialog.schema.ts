/**
 * Cancel-order dialog Zod schema (#3541)
 *
 * `reason` is validated against the mirrored closed vocabulary so the form
 * cannot submit a value the backend's `@IsIn(OrderCancelReasonValues)` would
 * answer 400 for. `note` is required exactly when the reason is `other` (the
 * backend's `OrderCancellationNoteRequiredError`), so the operator learns that
 * while typing rather than from a rejected submit.
 *
 * @module apps/web/src/features/orders/components
 */
import { z } from 'zod';

import { interpolate } from '../../../shared/i18n';

import {
  ORDER_CANCEL_NOTE_MAX_LENGTH,
  OrderCancelReasonValues,
  orderCancelReasonRequiresNote,
} from '../lib/order-cancel';
import type { CancelOrderValidationCopy } from './order-form.types';

/**
 * A factory rather than a module-level schema: the messages are read when the
 * form builds its resolver, so they follow the active language.
 */
export function createCancelOrderSchema(copy: CancelOrderValidationCopy) {
  return z
    .object({
      reason: z.enum(OrderCancelReasonValues, { message: copy.reason }),
      note: z
        .string()
        .max(
          ORDER_CANCEL_NOTE_MAX_LENGTH,
          interpolate(copy.noteTooLong, { max: ORDER_CANCEL_NOTE_MAX_LENGTH })
        )
        .optional(),
      acknowledgeAcceptedWork: z.boolean().optional(),
    })
    .superRefine((value, ctx) => {
      if (orderCancelReasonRequiresNote(value.reason) && !value.note?.trim()) {
        ctx.addIssue({
          code: 'custom',
          path: ['note'],
          message: copy.otherNeedsNote,
        });
      }
    });
}

export type CancelOrderFormValues = z.input<ReturnType<typeof createCancelOrderSchema>>;
export type CancelOrderSubmission = z.output<ReturnType<typeof createCancelOrderSchema>>;
