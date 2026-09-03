/**
 * Worklist paging vocabulary (#2406, `W3a-19`)
 *
 * The filter a worklist read is expressed with, the page it answers, and the
 * bound on how much may be asked for at once.
 *
 * The clamp is a pure rule that ships beside the type it bounds
 * (`engineering-standards.md` pure-rule exception), and it lives in the DOMAIN
 * rather than beside the request DTO on purpose: the repository applies it too,
 * so a caller that never touches HTTP — a worker, a future MCP tool — cannot
 * ask for an unbounded page either. **Reported === enforced**: the request DTO's
 * `@Max` and this clamp read the same constant, so the documented ceiling and
 * the applied one cannot drift.
 *
 * @module libs/core/src/fulfillment/domain/types
 */
import type { FulfillmentRequestStatus } from './fulfillment-request-status.types';
import type { FulfillmentWork } from './fulfillment-work.types';
import type { FulfillmentWorkStatus } from './fulfillment-work-status.types';

/** Page size used when a caller names none. */
export const FULFILLMENT_WORKLIST_DEFAULT_LIMIT = 25;

/**
 * Hard ceiling on one page.
 *
 * 100 because the read fans out to two further batched queries (lines, active
 * holds) whose payload grows with it, and a worklist is a human surface — a
 * page nobody scrolls is cost with no reader.
 */
export const FULFILLMENT_WORKLIST_MAX_LIMIT = 100;

/**
 * Coerce an untrusted page size into the supported range.
 *
 * A missing or non-finite value takes the default rather than the maximum: an
 * unparseable limit is a caller mistake, and the safe reading of a mistake is
 * the small page.
 */
export function clampWorklistLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return FULFILLMENT_WORKLIST_DEFAULT_LIMIT;
  const whole = Math.trunc(limit);
  if (whole < 1) return FULFILLMENT_WORKLIST_DEFAULT_LIMIT;
  return Math.min(whole, FULFILLMENT_WORKLIST_MAX_LIMIT);
}

/**
 * Coerce an untrusted page offset into a usable one.
 *
 * Beside `clampWorklistLimit` and for the same reason: the service reports the
 * offset it applied and the repository applies it, so the rule has to be ONE
 * function with two callers. Spelled out at both call sites instead, the two
 * copies drift and the page reports an offset it did not use.
 *
 * A negative, fractional or non-finite offset takes 0 — the first page is the
 * safe reading of a caller mistake, exactly as the small page is for the limit.
 */
export function clampWorklistOffset(offset: number | undefined): number {
  if (offset === undefined || !Number.isFinite(offset)) return 0;
  return Math.max(0, Math.trunc(offset));
}

/** Worklist filter. Every axis is optional; omitted means "any". */
export interface FulfillmentWorkListFilter {
  readonly status?: readonly FulfillmentWorkStatus[];
  readonly requestStatus?: readonly FulfillmentRequestStatus[];
  readonly locationId?: string;
  readonly orderId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/** One page of works plus the unpaged total, for a worklist's pager. */
export interface FulfillmentWorkPage {
  readonly works: readonly FulfillmentWork[];
  readonly total: number;
}
