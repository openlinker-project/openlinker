/**
 * Shoper Order Feed Cursor Mapper
 *
 * Encodes and decodes `ShoperOrderFeedCursor` as the opaque string core stores,
 * plus the wall-clock arithmetic the status pass needs. Pure, no I/O.
 *
 * Wire form: `v2|<lastOrderId>|<statusWatermark>|<statusPassStart>|<statusNextPage>`,
 * an empty field meaning "not set". A bare number is the cursor written before
 * the status pass existed (the order-id keyset alone) and is still read, so an
 * upgrade keeps its place in the new-orders feed.
 *
 * Wall-clock values are shop-local and zone-less, so they are compared as
 * fixed-width strings and shifted as if they were UTC: no Date is ever built in
 * the host's own zone. The cost of that is stated where the lookback is used.
 *
 * @module libs/integrations/shoper/src/infrastructure/mappers
 */
import type { ShoperOrderFeedCursor } from '../../domain/types/shoper-order-feed.types';

const VERSION = 'v2';
const ORDER_ID = /^\d+$/;
const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const PAGE = /^[1-9]\d*$/;

export const EMPTY_SHOPER_FEED_CURSOR: ShoperOrderFeedCursor = {
  lastOrderId: null,
  statusWatermark: null,
  statusPassStart: null,
  statusNextPage: null,
};

/**
 * The cursor core handed back. An unreadable ORDER ID is refused: guessing would
 * either re-read the shop's whole order history or skip part of it. An unreadable
 * status part only restarts the status pass (it re-stamps its watermark), which
 * loses at most the changes made while it was unreadable.
 */
export function parseShoperFeedCursor(raw: string | null | undefined, connectionId: string): ShoperOrderFeedCursor {
  if (raw === null || raw === undefined) {
    return EMPTY_SHOPER_FEED_CURSOR;
  }
  // Core never stores an empty cursor, so one arriving here is a defect, not a start.
  const text = raw.trim();
  if (ORDER_ID.test(text)) {
    return { ...EMPTY_SHOPER_FEED_CURSOR, lastOrderId: text };
  }
  const parts = text.split('|');
  if (parts.length !== 5 || parts[0] !== VERSION || (parts[1] !== '' && !ORDER_ID.test(parts[1]))) {
    throw new RangeError(
      `Shoper order feed cursor is not one this adapter wrote, got "${text}" (connection: ${connectionId})`,
    );
  }
  const [, lastOrderId, watermark, passStart, nextPage] = parts as [string, string, string, string, string];
  const statusWatermark = isWallClock(watermark) ? watermark : null;
  // A resumable pass is only meaningful with both halves and a watermark to fold into.
  const resumable = statusWatermark !== null && isWallClock(passStart) && PAGE.test(nextPage);
  return {
    lastOrderId: lastOrderId === '' ? null : lastOrderId,
    statusWatermark,
    statusPassStart: resumable ? passStart : null,
    statusNextPage: resumable ? Number(nextPage) : null,
  };
}

export function formatShoperFeedCursor(cursor: ShoperOrderFeedCursor): string {
  return [
    VERSION,
    cursor.lastOrderId ?? '',
    cursor.statusWatermark ?? '',
    cursor.statusPassStart ?? '',
    cursor.statusNextPage === null ? '' : String(cursor.statusNextPage),
  ].join('|');
}

export function isWallClock(value: string | null | undefined): value is string {
  const match = WALL_CLOCK.exec(value ?? '');
  if (match === null) {
    return false;
  }
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  // Date.UTC rolls an impossible reading over instead of refusing it.
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second
  );
}

/** `value` moved back by `seconds`, in the same zone-less form. `value` must be a wall clock. */
export function shiftWallClockBack(value: string, seconds: number): string {
  const match = WALL_CLOCK.exec(value);
  if (match === null) {
    throw new RangeError(`Not a Shoper wall-clock timestamp: "${value}"`);
  }
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second) - seconds * 1000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  );
}

/** The later of two wall clocks; fixed-width, so string order is time order. */
export function laterWallClock(a: string | null, b: string | null): string | null {
  if (a === null) {
    return b;
  }
  if (b === null) {
    return a;
  }
  return b > a ? b : a;
}
