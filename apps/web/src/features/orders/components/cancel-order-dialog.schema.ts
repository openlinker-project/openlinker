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

import {
  ORDER_CANCEL_NOTE_MAX_LENGTH,
  OrderCancelReasonValues,
  orderCancelReasonRequiresNote,
} from '../lib/order-cancel';

export const cancelOrderSchema = z
  .object({
    reason: z.enum(OrderCancelReasonValues, { message: 'Choose why this order is being cancelled' }),
    note: z
      .string()
      .max(ORDER_CANCEL_NOTE_MAX_LENGTH, `Keep the note under ${ORDER_CANCEL_NOTE_MAX_LENGTH} characters`)
      .optional(),
    acknowledgeAcceptedWork: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (orderCancelReasonRequiresNote(value.reason) && !value.note?.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['note'],
        message: 'Say what the other reason is',
      });
    }
  });

export type CancelOrderFormValues = z.input<typeof cancelOrderSchema>;
export type CancelOrderSubmission = z.output<typeof cancelOrderSchema>;
