/**
 * Mirakl Order Feed Policy
 *
 * Pure rules for reading Mirakl orders as an OpenLinker order feed. Mirakl has
 * no change journal and OR11 sorts only by creation date, so the feed is a
 * series of closed `last_updated_date` windows:
 *
 * - A window ends a little in the past (`FEED_READ_LAG_MS`), so an order
 *   written while the read runs falls into the next window rather than being
 *   half-seen.
 * - The next window starts `FEED_OVERLAP_MS` before the previous one ended.
 *   Orders in the overlap are read twice and collapse on their event key,
 *   which is `{order_id}:{last_updated_date}`, so the same change enqueues one
 *   job however often it is read.
 * - Without a cursor the first window reaches back `FEED_BOOTSTRAP_LOOKBACK_MS`,
 *   which covers Empik's 7-day payment window.
 *
 * @module libs/integrations/mirakl/src/domain/policies
 */
import type { OrderFeedEventType } from '@openlinker/core/orders';
import { MiraklOrderStateValues, type MiraklOrderState } from '../types/mirakl-order.types';

export const FEED_READ_LAG_MS = 30_000;
export const FEED_OVERLAP_MS = 120_000;
export const FEED_BOOTSTRAP_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/** States that are not an order yet: never ingested. */
const NOT_YET_ORDER_STATES: readonly MiraklOrderState[] = ['STAGING', 'WAITING_ACCEPTANCE'];

/** States read by the feed. */
export const INGESTIBLE_ORDER_STATES: readonly MiraklOrderState[] = MiraklOrderStateValues.filter(
  (state) => !NOT_YET_ORDER_STATES.includes(state),
);

const CANCELLED_ORDER_STATES: readonly string[] = ['REFUSED', 'CANCELED'];

export interface MiraklFeedWindow {
  readonly from: Date;
  readonly to: Date;
}

/**
 * The window a poll reads. An unreadable cursor starts over from the bootstrap
 * lookback: re-reading is free (the event key de-duplicates) while skipping is
 * not.
 */
export function computeFeedWindow(cursor: string | null, now: Date): MiraklFeedWindow {
  const to = new Date(now.getTime() - FEED_READ_LAG_MS);
  const cursorMs = cursor ? Date.parse(cursor) : Number.NaN;
  const fromMs = Number.isFinite(cursorMs)
    ? cursorMs - FEED_OVERLAP_MS
    : to.getTime() - FEED_BOOTSTRAP_LOOKBACK_MS;
  // A cursor ahead of the clock (a skewed host) still reads the overlap.
  const boundedFromMs = Math.min(fromMs, to.getTime() - FEED_OVERLAP_MS);
  return { from: new Date(boundedFromMs), to };
}

/** The first half of a window, read when the whole window did not fit. */
export function halveFeedWindow(window: MiraklFeedWindow): MiraklFeedWindow {
  const span = window.to.getTime() - window.from.getTime();
  return { from: window.from, to: new Date(window.from.getTime() + Math.floor(span / 2)) };
}

export function isCancelledOrderState(state: string | undefined): boolean {
  return state !== undefined && CANCELLED_ORDER_STATES.includes(state);
}

/**
 * Mirakl does not say what changed. A cancelled or refused order is reported as
 * `cancelled` (core relays the cancellation); anything else is `updated`, which
 * makes core read and upsert the order.
 */
export function deriveFeedEventType(state: string | undefined): OrderFeedEventType {
  return isCancelledOrderState(state) ? 'cancelled' : 'updated';
}

/**
 * Event key for one observed change. `last_updated_date` falls back to the
 * creation date so an order that carries none still gets a stable key.
 */
export function buildFeedEventKey(
  orderId: string,
  lastUpdatedDate: string | undefined,
  createdDate: string | undefined,
): string {
  return `${orderId}:${lastUpdatedDate ?? createdDate ?? 'unknown'}`;
}
