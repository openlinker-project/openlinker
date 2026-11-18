/**
 * Order Sync Start Intent
 *
 * The operator's choice, made when a connection is created, of where its order
 * feed starts (#4228): from now (the default), from a date, or the whole
 * history. It is stored as a ONE-SHOT INTENT in a `connection_cursors` row, never
 * in the connection config: a start date kept in config would go stale after the
 * first poll and read as a live setting. The first poll consumes it and the
 * existing `.seededAt` marker then gates re-entry for good.
 *
 * The key is adapter-independent (the order cursor keys are adapter-defined and
 * the connection page has no adapter at create time), and the value is a JSON
 * string because `connection_cursors.cursorValue` is text.
 *
 * Pure-rule exception (`docs/engineering-standards.md`): these functions ARE the
 * rule for the intent's key, wire shape and bounds, shared by the API validator
 * and the ingestion reader so the two cannot disagree.
 *
 * @module domain/types
 */

export const ORDER_SYNC_START_CURSOR_KEY = 'orders.syncStart';

export const OrderSyncStartModeValues = ['now', 'from', 'all'] as const;
export type OrderSyncStartMode = (typeof OrderSyncStartModeValues)[number];

export type OrderSyncStart = { mode: 'now' } | { mode: 'from'; from: string } | { mode: 'all' };

/** Modes an adapter supports when its manifest declares nothing. */
export const DEFAULT_ORDER_SYNC_START_MODES: readonly OrderSyncStartMode[] = ['now', 'all'];

/** Oldest start date accepted; older history is almost never worth importing. */
export const ORDER_SYNC_START_MAX_AGE_YEARS = 5;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** The modes an adapter supports, defaulting when its manifest is silent. */
export function resolveOrderSyncStartModes(
  declared: readonly OrderSyncStartMode[] | undefined | null
): readonly OrderSyncStartMode[] {
  return declared ?? DEFAULT_ORDER_SYNC_START_MODES;
}

/**
 * Why a `from` value is unusable, or null when it is fine. A bare date and a full
 * ISO instant are both accepted; the date must not be in the future and not older
 * than {@link ORDER_SYNC_START_MAX_AGE_YEARS}.
 */
export function describeInvalidOrderSyncStartDate(from: unknown, now: Date): string | null {
  if (typeof from !== 'string' || from.trim() === '') {
    return 'orderSyncStart.from must be an ISO date (YYYY-MM-DD) or ISO date-time';
  }
  const value = from.trim();
  const parsed = new Date(DATE_ONLY.test(value) ? `${value}T00:00:00.000Z` : value);
  if (Number.isNaN(parsed.getTime())) {
    return 'orderSyncStart.from must be an ISO date (YYYY-MM-DD) or ISO date-time';
  }
  if (parsed.getTime() > now.getTime()) {
    return 'orderSyncStart.from must not be in the future';
  }
  const oldest = new Date(now.getTime());
  oldest.setUTCFullYear(oldest.getUTCFullYear() - ORDER_SYNC_START_MAX_AGE_YEARS);
  if (parsed.getTime() < oldest.getTime()) {
    return `orderSyncStart.from must not be older than ${ORDER_SYNC_START_MAX_AGE_YEARS} years`;
  }
  return null;
}

/** The persisted wire value of an intent. */
export function serializeOrderSyncStart(start: OrderSyncStart): string {
  return JSON.stringify(
    start.mode === 'from' ? { mode: 'from', from: start.from } : { mode: start.mode }
  );
}

/**
 * Read a stored intent back. Total: anything unreadable returns null, which the
 * caller treats as "now" and warns about, never as a guess at a date.
 */
export function parseOrderSyncStart(raw: string | null | undefined): OrderSyncStart | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as { mode?: unknown; from?: unknown };
  if (candidate.mode === 'now' || candidate.mode === 'all') {
    return { mode: candidate.mode };
  }
  if (
    candidate.mode === 'from' &&
    typeof candidate.from === 'string' &&
    candidate.from.trim() !== ''
  ) {
    return { mode: 'from', from: candidate.from.trim() };
  }
  return null;
}
