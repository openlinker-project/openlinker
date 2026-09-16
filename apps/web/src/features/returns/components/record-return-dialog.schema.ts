/**
 * Record Return Dialog Form Schema (#3078/#3084)
 *
 * Mirrors `RecordReturnDto` / `RecordReturnLineDto` bounds (`apps/api/src/
 * returns/dto/return-write.dto.ts`) so an obviously invalid submission is
 * caught inline instead of round-tripping to a 400 — the
 * `infakt-webhook-secret.schema.ts` precedent.
 *
 * **Single line only.** `RecordReturnDto.lines` is an array, but this dialog
 * collects exactly one — the mockup's own scope, and every acceptance
 * criterion for #3084 is stated in terms of one line. The component wraps
 * the single set of fields into a one-element array at submit time.
 *
 * **`reason` is a plain string, not `z.enum`**, deliberately: `RefundReasonValues`
 * (core) is a closed union today, but the form must not become a SECOND place
 * that fails to compile when core adds a member — the membership check runs
 * at validation time (`refine`), against the FE's own mirrored
 * `RETURN_LINE_REASON_VALUES`, exactly as `isReturnLineReason` already does.
 *
 * @module apps/web/src/features/returns/components
 */
import { z } from 'zod';
import { RETURN_LINE_REASON_VALUES } from '../api/returns.types';

export const recordReturnDialogSchema = z.object({
  internalOrderId: z
    .string()
    .trim()
    .min(1, 'Enter an order id, or pick one from the list.'),
  sourceConnectionId: z
    .string()
    .trim()
    .min(1, 'Select the channel this return came in on.'),
  itemName: z
    .string()
    .trim()
    .min(1, 'Enter what came back.')
    .max(500, 'Item name must be at most 500 characters.'),
  reason: z
    .string()
    .refine(
      (value) => (RETURN_LINE_REASON_VALUES as readonly string[]).includes(value),
      'Select a reason.',
    ),
  // `@IsInt() @Min(1)` on the backend. `z.coerce` because a native
  // `<input type="number">` value arrives as a string.
  quantityAdvised: z.coerce
    .number({ invalid_type_error: 'Quantity must be a whole number.' })
    .int('Quantity must be a whole number.')
    .min(1, 'Quantity must be at least 1.'),
});

export type RecordReturnDialogFormValues = z.input<typeof recordReturnDialogSchema>;
export type RecordReturnDialogFormSubmission = z.output<typeof recordReturnDialogSchema>;

export const RECORD_RETURN_DIALOG_DEFAULT_VALUES: RecordReturnDialogFormValues = {
  internalOrderId: '',
  sourceConnectionId: '',
  itemName: '',
  reason: '',
  quantityAdvised: 1,
};
