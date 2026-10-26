/**
 * Bulk cancel dialog Zod schema (#3619)
 *
 * Same rules as the single-order form (`cancel-order-dialog.schema.ts`): the
 * reason is the closed D37 set and the note is required exactly for `other`.
 *
 * @module apps/web/src/features/orders/components
 */
import { z } from 'zod';

import {
  ORDER_CANCEL_NOTE_MAX_LENGTH,
  OrderCancelReasonValues,
  orderCancelReasonRequiresNote,
} from '../lib/order-cancel';

export const bulkCancelSchema = z
  .object({
    reason: z.enum(OrderCancelReasonValues, { message: 'Choose why these orders are being cancelled' }),
    note: z
      .string()
      .max(ORDER_CANCEL_NOTE_MAX_LENGTH, `Keep the note under ${ORDER_CANCEL_NOTE_MAX_LENGTH} characters`)
      .optional(),
    acknowledgeAcceptedWork: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (orderCancelReasonRequiresNote(value.reason) && !value.note?.trim()) {
      ctx.addIssue({ code: 'custom', path: ['note'], message: 'Say what the other reason is' });
    }
  });

export type BulkCancelFormValues = z.input<typeof bulkCancelSchema>;
export type BulkCancelSubmission = z.output<typeof bulkCancelSchema>;
