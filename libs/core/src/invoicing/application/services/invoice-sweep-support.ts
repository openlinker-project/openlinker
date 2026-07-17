/**
 * Invoice Sweep Support
 *
 * Shared constants + helpers for the three connection-fan-out invoice sweeps
 * (`RegulatoryStatusReconciliationService`, `OfflineResubmissionService`,
 * `PendingRecoveryService`). Extracted (#1585 review) so the identical
 * page-walk bounds and the length-bounded error sanitizer live in ONE place
 * rather than being copy-pasted per service.
 *
 * NOT a `*.service.ts` (no injectable, no interface) — a leaf helper module the
 * sweeps import. No `faktura`/`ksef`/`NIP` vocabulary (ADR-026 neutral core).
 *
 * @module libs/core/src/invoicing/application/services
 */

/**
 * Max length of a sanitized, operator-facing per-record error diagnostic. A
 * sub-capability adapter is third-party-shaped and its error may echo
 * buyer/authority-side data — bound it before logging.
 *
 * PII CONTRACT (#1585 review): `sanitizeError` truncates but does NOT redact.
 * It is safe for today's adapters (KSeF error messages are PII-free), and its
 * output is INTERNAL-ONLY (never streamed to an external sink). A future
 * locator/resubmitter adapter whose errors could embed buyer name / tax id MUST
 * keep that data out of `error.message` (or narrow logging to `error.name`) —
 * this helper does not scrub it.
 */
export const MAX_ERROR_MESSAGE_LENGTH = 500;

/**
 * Runaway guard on an intra-run keyset page walk. The walk normally terminates
 * when a page returns fewer than `limit` rows; this caps the worst case so a
 * single run cannot spin unboundedly. At the default page size (100) this is
 * 100k records/run — far above any realistic MVP frontier.
 */
export const MAX_PAGES_PER_RUN = 1000;

/**
 * Half-width of the issue-date window handed to the authority lookup. A record's
 * exact authority-side issue date may drift from OL's recorded instant, so the
 * window is anchored on the record's issue/last-touch instant with a full day
 * either side — wide enough to catch the drift, narrow enough that the metadata
 * query stays selective.
 */
export const LOCATE_DATE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Length-bounded, operator-facing diagnostic for a per-record sweep error.
 * INTERNAL-ONLY; see the PII CONTRACT on {@link MAX_ERROR_MESSAGE_LENGTH}.
 */
export function sanitizeError(error: unknown, maxLength: number = MAX_ERROR_MESSAGE_LENGTH): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (raw.length <= maxLength) {
    return raw;
  }
  const marker = '…[truncated]';
  return raw.slice(0, maxLength - marker.length) + marker;
}

/**
 * Business-hours a `pending-submission` document may linger before it is
 * WARN-surfaced as approaching its next-business-day transmission deadline
 * (#1585 F6). Measured in BUSINESS time (see {@link businessMillisElapsed}), so a
 * Friday-evening outage does not raise a Saturday alarm for a deadline that is
 * really Monday. Below a typical CTC next-business-day window so an operator sees
 * a prolonged outage / no-locator / repeatedly-failing record before any legal
 * window is missed. Observability only — never a state change (fiscal safety).
 */
export const PENDING_SUBMISSION_LINGER_BUSINESS_MS = 20 * 60 * 60 * 1000;

/**
 * Elapsed BUSINESS-time (ms) between two instants, excluding whole weekend days
 * (Saturday / Sunday, UTC). A coarse day-granular approximation of a
 * business-day deadline clock — precise enough for an observability threshold,
 * without a holiday calendar. UTC-based: business-day boundaries are not
 * timezone-localised here (documented trade-off; the threshold is a heuristic,
 * not a legal computation). Returns 0 when `to <= from`. Pure.
 */
export function businessMillisElapsed(from: Date, to: Date): number {
  if (to.getTime() <= from.getTime()) {
    return 0;
  }
  let elapsed = 0;
  let cursor = from.getTime();
  const toMs = to.getTime();
  while (cursor < toMs) {
    const c = new Date(cursor);
    const nextMidnightUtc = Date.UTC(
      c.getUTCFullYear(),
      c.getUTCMonth(),
      c.getUTCDate() + 1,
    );
    const segmentEnd = Math.min(nextMidnightUtc, toMs);
    const dayOfWeek = c.getUTCDay(); // 0 = Sunday, 6 = Saturday
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      elapsed += segmentEnd - cursor;
    }
    cursor = segmentEnd;
  }
  return elapsed;
}
