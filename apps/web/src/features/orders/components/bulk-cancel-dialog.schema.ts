/**
 * Bulk cancel dialog Zod schema (#3619)
 *
 * Same rules as the single-order form (`cancel-order-dialog.schema.ts`): the
 * reason is the closed D37 set and the note is required exactly for `other`.
 * A factory rather than a module-level schema, so the messages follow the
 * active language.
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
import type { BulkCancelValidationCopy } from './order-form.types';

export function createBulkCancelSchema(copy: BulkCancelValidationCopy) {
  return z
    .object({
      reason: z.enum(OrderCancelReasonValues, { message: copy.reasonRequired }),
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
        ctx.addIssue({ code: 'custom', path: ['note'], message: copy.otherNeedsNote });
      }
    });
}

export type BulkCancelFormValues = z.input<ReturnType<typeof createBulkCancelSchema>>;
export type BulkCancelSubmission = z.output<ReturnType<typeof createBulkCancelSchema>>;
