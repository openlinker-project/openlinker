/**
 * Return Custody Lock helpers (#2370)
 *
 * Lock key + TTL for serializing custody DISPOSAL per LINE. Modelled directly on
 * `invoice-issue-lock.ts` (#2047), because the hazard has the same shape.
 *
 * `disposeLine` validates the disposition against the line's counters and then
 * crosses a provider boundary that moves real stock. That is read-then-act: two
 * concurrent disposals of the last 3 received units both read
 * `restocked + scrapped = 0`, both pass the `over-disposition` check, and both
 * call `adjustInventory` — under DIFFERENT `seq` values, so their idempotency
 * keys differ and no adapter can dedupe them. Six units land in the master's
 * book for three units of goods, and no later log line recovers that.
 *
 * Keyed per LINE, not per (line, act): the invariant being serialized is the
 * counter ordering, which is stated per line
 * (`quantityReceived >= quantityRestocked + quantityScrapped`).
 *
 * TTL expiry is NOT a correctness cliff, for the same reason it is not on the
 * invoice lock. The window that must be covered is validation-read -> act-append,
 * two DB round-trips; past that an `in_doubt` act row exists for the line and a
 * peer's own validation reads the counters it will settle. So the lock removes
 * the race, and the persisted act is what survives a lock that expired
 * mid-provider-call. Single-shot, no heartbeat — there is nothing left for a
 * heartbeat to protect.
 *
 * @module libs/core/src/returns/application/services
 */

/**
 * Lock TTL (ms). Sized to exceed a worst-case `adjustInventory` round trip —
 * PrestaShop resolves a mapping, reads `stock_availables` and writes it back —
 * with margin, while staying short enough that a crashed holder does not wedge
 * a line for long.
 *
 * Operator-tunable via `OL_RETURN_CUSTODY_LOCK_TTL_MS` (clamped to [5s, 300s]),
 * mirroring `INVOICE_ISSUE_LOCK_TTL_MS`. Resolved ONCE at module load, so it is
 * fixed for the process lifetime and cannot be varied per-test by mutating
 * `process.env` after import — the `SHIPMENT_DISPATCH_LOCK_TTL_MS` precedent,
 * kept deliberately for consistency.
 */
const DEFAULT_RETURN_CUSTODY_LOCK_TTL_MS = 60_000;
const MIN_RETURN_CUSTODY_LOCK_TTL_MS = 5_000;
const MAX_RETURN_CUSTODY_LOCK_TTL_MS = 300_000;

function resolveReturnCustodyLockTtlMs(): number {
  const raw = process.env.OL_RETURN_CUSTODY_LOCK_TTL_MS;
  const parsed = raw !== undefined && raw !== '' ? Number(raw) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return DEFAULT_RETURN_CUSTODY_LOCK_TTL_MS;
  }
  return Math.min(
    MAX_RETURN_CUSTODY_LOCK_TTL_MS,
    Math.max(MIN_RETURN_CUSTODY_LOCK_TTL_MS, parsed)
  );
}

export const RETURN_CUSTODY_LOCK_TTL_MS = resolveReturnCustodyLockTtlMs();

export function returnCustodyLockKey(lineId: string): string {
  return `return:line:${lineId}`;
}
