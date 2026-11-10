/**
 * Invoice Idempotency Keys (#3960)
 *
 * The exactly-once key one connection issuing one order's invoice is held
 * under, and the root a retry of a refused invoice builds its attempt key from.
 *
 * ONE definition for every place that derives the key - the auto-issue gate,
 * bulk issue, and an operator retry of a refused keyless invoice. Building it
 * inline at each site let the formats drift apart by inspection only; here a
 * change of format moves every chain together.
 *
 * @module libs/core/src/invoicing/domain/types
 */
import { attemptRootKey, withAttemptSuffix } from '@openlinker/core/sales-documents';

/**
 * The key attempt `attempt` of one connection's invoice for one order is held
 * under. Attempt 0 is `invoice:{connectionId}:{orderId}`, byte-identical to the
 * key written before attempts existed.
 */
export function invoiceIdempotencyKey(
  connectionId: string,
  orderId: string,
  attempt = 0,
): string {
  return withAttemptSuffix(`invoice:${connectionId}:${orderId}`, attempt);
}

/**
 * The root a retry of `refused` derives the next attempt's key from.
 *
 * A keyed record roots on its own key, minus its attempt suffix. A KEYLESS one
 * (a first manual issue persists no key) roots on the same derived key
 * `invoiceIdempotencyKey` gives, so a keyless chain and a keyed chain for one
 * (connection, order) share one shape and cannot drift apart.
 */
export function invoiceRetryRootKey(refused: {
  idempotencyKey: string | null;
  connectionId: string;
  orderId: string;
  attempt: number;
}): string {
  return refused.idempotencyKey === null
    ? invoiceIdempotencyKey(refused.connectionId, refused.orderId)
    : attemptRootKey(refused.idempotencyKey, refused.attempt);
}
