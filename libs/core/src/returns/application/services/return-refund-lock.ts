/**
 * Return Refund Lock helpers (#2371, ADR-056)
 *
 * Lock key + TTL for serializing the refund trigger per RETURN. Modelled on
 * `return-custody-lock.ts` (#2370) and `invoice-issue-lock.ts` (#2047), with one
 * material difference worth stating because it changes what the lock is FOR.
 *
 * **The lock is not the correctness guarantee here.** `disposeRestock` validates
 * against a read and then crosses a boundary — read-then-act, which only a lock
 * can serialize. The refund trigger's guard is instead a single conditional
 * UPDATE (`ReturnRepositoryPort.claimRefundAttempt`, the `claimAttribution` /
 * `claimWaybillRelay` shape), so two concurrent attempts cannot both claim the
 * same lines whatever the lock does. A lost or expired lock therefore cannot
 * produce a double refund.
 *
 * What the lock buys is an ANSWER: a contended caller is refused with the
 * retryable `ReturnRefundContendedError` before reaching the executor, rather
 * than racing to a zero-row claim that is indistinguishable from "already
 * refunded". Stating which mechanism is load-bearing matters — a future reader
 * who removes the conditional UPDATE because "there is a lock anyway" reopens
 * the defect this file exists beside.
 *
 * Keyed per RETURN, not per line: a refund is one amount against one order, so
 * two operators refunding two lines of the same return is exactly the case a
 * per-line key would let through (the #1917 / #2047 reasoning).
 *
 * @module libs/core/src/returns/application/services
 */

/**
 * Lock TTL (ms). Sized to exceed a worst-case `executeRefund` round trip with
 * margin, while staying short enough that a crashed holder does not wedge a
 * return for long.
 *
 * Operator-tunable via `OL_RETURN_REFUND_LOCK_TTL_MS` (clamped to [5s, 300s]),
 * mirroring `RETURN_CUSTODY_LOCK_TTL_MS`. Resolved ONCE at module load, so it is
 * fixed for the process lifetime and cannot be varied per-test by mutating
 * `process.env` after import — the `SHIPMENT_DISPATCH_LOCK_TTL_MS` precedent,
 * kept deliberately for consistency.
 */
const DEFAULT_RETURN_REFUND_LOCK_TTL_MS = 60_000;
const MIN_RETURN_REFUND_LOCK_TTL_MS = 5_000;
const MAX_RETURN_REFUND_LOCK_TTL_MS = 300_000;

function resolveReturnRefundLockTtlMs(): number {
  const raw = process.env.OL_RETURN_REFUND_LOCK_TTL_MS;
  const parsed = raw !== undefined && raw !== '' ? Number(raw) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return DEFAULT_RETURN_REFUND_LOCK_TTL_MS;
  }
  return Math.min(
    MAX_RETURN_REFUND_LOCK_TTL_MS,
    Math.max(MIN_RETURN_REFUND_LOCK_TTL_MS, parsed)
  );
}

export const RETURN_REFUND_LOCK_TTL_MS = resolveReturnRefundLockTtlMs();

export function returnRefundLockKey(returnId: string): string {
  return `return:refund:${returnId}`;
}
