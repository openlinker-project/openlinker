/**
 * Invoice Issue Lock helpers (#2047)
 *
 * Lock key + TTL for serializing originating-document issuance per ORDER. The
 * lock (`SyncLockPort`) closes the race window in `InvoiceService`'s
 * one-invoice-per-order guard: `assertNotInvoicedElsewhere` is a plain read
 * (`findAllByOrderId` -> `find`), so two attempts on DIFFERENT connections for an
 * order with no prior record both read `[]`, both pass, and both create a
 * `pending` row - the `(connectionId, idempotencyKey)` unique index cannot
 * collide across connections (ADR-026 §Decision 4), so both then cross the
 * provider boundary and one sale gets two real fiscal documents. That is exactly
 * the outcome #2047 exists to prevent, so the guard cannot stay read-then-act.
 *
 * Keyed per ORDER, not per (order, connection): the invariant being serialized
 * is "this order gets at most one originating document"
 * ([ADR-041](../../../../../docs/architecture/adrs/041-sales-document-routing-policy.md)
 * §3a/3b), and two operators picking different invoicing connections for the
 * same order is precisely the case a per-connection key would let through. Same
 * reasoning - and the same key shape - as `shipmentDispatchLockKey`.
 *
 * @module libs/core/src/invoicing/application/services
 */

/**
 * Lock TTL (ms). Sized to comfortably exceed a worst-case `issueInvoice`
 * round-trip: an adapter may block for the provider's own async create (inFakt
 * POSTs an `async/*.json` task and polls its status) or for a submit->poll->UPO
 * clearance cycle (KSeF), so this is seconds, not milliseconds.
 *
 * TTL expiry is nonetheless NOT a correctness cliff. The window that must be
 * covered is only guard-read -> `repo.create`, two DB round-trips: past that
 * point a `pending` row exists for the order, and a peer's own guard read sees
 * it (`blocksIssuanceElsewhere` covers `pending`) and refuses. So the lock
 * removes the race, while the persisted intent row is what survives a lock that
 * expired mid-provider-call. The lock is single-shot (no heartbeat) for that
 * reason - there is nothing left for a heartbeat to protect.
 *
 * Operator-tunable via `OL_INVOICE_ISSUE_LOCK_TTL_MS` (clamped to [10s, 600s]),
 * mirroring `ORDER_CREATE_LOCK_TTL_MS` / `SHIPMENT_DISPATCH_LOCK_TTL_MS`.
 *
 * Resolved ONCE at module load, so it is fixed for the process lifetime and
 * cannot be varied per-test by mutating `process.env` after import (a spec that
 * needs a different value re-imports the module in isolation). That is the
 * `SHIPMENT_DISPATCH_LOCK_TTL_MS` precedent, kept deliberately for consistency.
 */
const DEFAULT_INVOICE_ISSUE_LOCK_TTL_MS = 120_000;
const MIN_INVOICE_ISSUE_LOCK_TTL_MS = 10_000;
const MAX_INVOICE_ISSUE_LOCK_TTL_MS = 600_000;

function resolveInvoiceIssueLockTtlMs(): number {
  const raw = process.env.OL_INVOICE_ISSUE_LOCK_TTL_MS;
  const parsed = raw !== undefined && raw !== '' ? Number(raw) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return DEFAULT_INVOICE_ISSUE_LOCK_TTL_MS;
  }
  return Math.min(
    MAX_INVOICE_ISSUE_LOCK_TTL_MS,
    Math.max(MIN_INVOICE_ISSUE_LOCK_TTL_MS, parsed),
  );
}

export const INVOICE_ISSUE_LOCK_TTL_MS = resolveInvoiceIssueLockTtlMs();

/**
 * Build the lock key for issuing one order's originating document.
 */
export function invoiceIssueLockKey(orderId: string): string {
  return `invoice:issue:${orderId}`;
}
