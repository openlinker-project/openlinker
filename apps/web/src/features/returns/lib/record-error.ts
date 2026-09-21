/**
 * Record-a-return error mapping (#2372/#2376, #3084)
 *
 * Turns a failed `POST /returns/record` into one of the four closed reasons
 * `ReturnRecordRefusedError` can carry — read from the response body's
 * `reason` field, never the message string, the `readMatchRefusalReason` /
 * `readBlockedTrigger` precedent.
 *
 * Every reason maps to 400 (`ReturnsExceptionFilter`'s own docblock: this
 * route addresses no existing return, so there is no resource whose STATE
 * could conflict — the payload is the entire request). `unknown-order` and
 * `order-not-on-connection` are field errors an operator can fix by picking a
 * different order or connection; `no-lines` / `invalid-quantity` should
 * already be caught by the form's own Zod validation and are handled here
 * only defensively.
 *
 * @module apps/web/src/features/returns/lib
 */
import { ApiError } from '../../../shared/api/api-error';

export const RECORD_RETURN_REFUSAL_REASON_VALUES = [
  'no-lines',
  'invalid-quantity',
  'unknown-order',
  'order-not-on-connection',
] as const;
export type RecordReturnRefusalReason = (typeof RECORD_RETURN_REFUSAL_REASON_VALUES)[number];

/**
 * Returns `null` for anything that is not one of the four reasons this build
 * recognises, so an error shape this build predates degrades to the generic
 * message rather than rendering `undefined`.
 */
export function readRecordRefusalReason(error: unknown): RecordReturnRefusalReason | null {
  if (!(error instanceof ApiError)) return null;
  const details: unknown = error.details;
  if (typeof details !== 'object' || details === null || !('reason' in details)) return null;
  const reason: unknown = (details as { reason: unknown }).reason;
  return (RECORD_RETURN_REFUSAL_REASON_VALUES as readonly string[]).includes(reason as string)
    ? (reason as RecordReturnRefusalReason)
    : null;
}
