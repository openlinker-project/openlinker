/**
 * Amazon Order Window Policy
 *
 * Pure rules for the two operator start choices that need a date (#4262):
 * "start from {date}" (`cursorForDate`) and the date-window import
 * (`listOrdersInWindow`). Core hands over `YYYY-MM-DD` days or ISO instants,
 * already shape-checked; every other failure here is a typed refusal.
 *
 * Rules:
 *   - A bare day is read in UTC: `from` is 00:00:00 and `to` is 23:59:59 of
 *     that day. Amazon marketplaces span many time zones and the Orders API
 *     takes instants, so no shop-local day exists to honour.
 *   - `searchOrders` has no sort order and allows one call per ~3 minutes, so a
 *     window is walked in fixed slices (`AMAZON_ORDER_WINDOW_SLICE_DAYS`) in the
 *     requested direction, and a page is ordered by creation time inside its
 *     slice. The direction is therefore exact between slices and best effort
 *     within one.
 *   - Amazon refuses a bound later than two minutes before the request, so the
 *     upper bound is clamped to `now - AMAZON_ORDER_WINDOW_LATENCY_MS`.
 *   - No `from` means the oldest history the Orders API serves (two years).
 *   - The window cursor holds the slice index and, mid-slice, Amazon's
 *     pagination token (valid 24 h; an older one restarts the slice, which is
 *     safe because order sync is idempotent).
 *
 * @module libs/integrations/amazon/src/domain/policies
 */
import { OrderSyncStartUnavailableError } from '@openlinker/core/orders';

import { AMAZON_PAGINATION_TOKEN_TTL_MS } from './amazon-order-feed-cursor.policy';

export const AMAZON_ORDER_WINDOW_SLICE_DAYS = 30;
export const AMAZON_ORDER_WINDOW_HISTORY_DAYS = 730;
export const AMAZON_ORDER_WINDOW_LATENCY_MS = 2 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface AmazonOrderWindow {
  readonly fromMs: number;
  readonly toMs: number;
  readonly sliceCount: number;
}

export interface AmazonOrderWindowCursor {
  readonly slice: number;
  readonly paginationToken?: string;
  readonly tokenIssuedAt?: string;
}

/** `YYYY-MM-DD` or an ISO instant as epoch ms. `bound` says which edge of a bare day. */
export function parseAmazonStartDate(value: string, bound: 'start' | 'end', label: string): number {
  const ms = DAY_PATTERN.test(value)
    ? Date.parse(`${value}T${bound === 'start' ? '00:00:00.000' : '23:59:59.000'}Z`)
    : Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new OrderSyncStartUnavailableError(`${label}: "${value}" is not a date Amazon can start order sync from`);
  }
  return ms;
}

/** The latest instant Amazon will accept as an upper bound right now. */
export function amazonLatestQueryableMs(now: Date): number {
  return now.getTime() - AMAZON_ORDER_WINDOW_LATENCY_MS;
}

export function resolveAmazonOrderWindow(
  input: { readonly from?: string; readonly to?: string },
  now: Date,
): AmazonOrderWindow {
  const latest = amazonLatestQueryableMs(now);
  const floor = now.getTime() - AMAZON_ORDER_WINDOW_HISTORY_DAYS * DAY_MS;
  const fromMs = Math.max(
    input.from === undefined ? floor : parseAmazonStartDate(input.from, 'start', 'Amazon order window'),
    floor,
  );
  const toMs = Math.min(
    input.to === undefined ? latest : parseAmazonStartDate(input.to, 'end', 'Amazon order window'),
    latest,
  );
  if (toMs < fromMs) {
    throw new OrderSyncStartUnavailableError('Amazon order window: the end of the range is before its start');
  }
  const sliceMs = AMAZON_ORDER_WINDOW_SLICE_DAYS * DAY_MS;
  return { fromMs, toMs, sliceCount: Math.max(1, Math.ceil((toMs - fromMs + 1) / sliceMs)) };
}

/** Inclusive `[createdAfter, createdBefore]` bounds of one slice, disjoint from its neighbours. */
export function amazonOrderWindowSlice(
  window: AmazonOrderWindow,
  slice: number,
): { readonly createdAfter: string; readonly createdBefore: string } {
  const sliceMs = AMAZON_ORDER_WINDOW_SLICE_DAYS * DAY_MS;
  const start = window.fromMs + slice * sliceMs;
  const end = slice === window.sliceCount - 1 ? window.toMs : start + sliceMs - 1000;
  return { createdAfter: new Date(start).toISOString(), createdBefore: new Date(end).toISOString() };
}

export function firstAmazonWindowSlice(window: AmazonOrderWindow, newestFirst: boolean): number {
  return newestFirst ? window.sliceCount - 1 : 0;
}

/** The slice after `slice` in the walk direction, or null when the walk is over. */
export function nextAmazonWindowSlice(
  window: AmazonOrderWindow,
  slice: number,
  newestFirst: boolean,
): number | null {
  const next = newestFirst ? slice - 1 : slice + 1;
  return next < 0 || next >= window.sliceCount ? null : next;
}

export function encodeAmazonOrderWindowCursor(cursor: AmazonOrderWindowCursor): string {
  return JSON.stringify(cursor);
}

/** Throws on a cursor this policy did not write: a quiet restart would re-import the window. */
export function decodeAmazonOrderWindowCursor(
  raw: string | null,
  window: AmazonOrderWindow,
  newestFirst: boolean,
  now: Date,
): AmazonOrderWindowCursor {
  if (raw === null || raw.length === 0) {
    return { slice: firstAmazonWindowSlice(window, newestFirst) };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new OrderSyncStartUnavailableError('Amazon order window: the cursor is not one this import wrote');
  }
  const value = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  const slice = value.slice;
  if (typeof slice !== 'number' || !Number.isInteger(slice) || slice < 0 || slice >= window.sliceCount) {
    throw new OrderSyncStartUnavailableError('Amazon order window: the cursor is not one this import wrote');
  }
  const token = typeof value.paginationToken === 'string' ? value.paginationToken : undefined;
  const issuedAt = typeof value.tokenIssuedAt === 'string' ? Date.parse(value.tokenIssuedAt) : Number.NaN;
  const usable = token !== undefined && !Number.isNaN(issuedAt) && now.getTime() - issuedAt < AMAZON_PAGINATION_TOKEN_TTL_MS;
  return usable ? { slice, paginationToken: token, tokenIssuedAt: value.tokenIssuedAt as string } : { slice };
}
