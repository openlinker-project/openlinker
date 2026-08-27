/**
 * PrestaShop Order-Feed Keyset Cursor
 *
 * The order feed's read position, plus the rules for reading and writing it.
 *
 * PrestaShop stores `date_upd` as a `DATETIME`: a wall-clock reading in the
 * shop's own timezone, with nothing recorded about which zone that is. So the
 * only safe thing to do with it is to never interpret it. Every function here
 * treats the value as an opaque fixed-width string and, where arithmetic is
 * unavoidable, does it in UTC - so the worker's own timezone is not an input to
 * which orders come back. A container that moves from Europe/Warsaw to UTC
 * therefore reads the same page.
 *
 * A bare timestamp is not enough to be a read position. PrestaShop's precision
 * is one second, so several orders share a second routinely, and a strict `>`
 * watermark that stopped in the middle of such a group dropped the rest of it
 * permanently. The position is therefore a keyset over `(date_upd, id)`: the
 * timestamp says where to resume reading, and the id says which rows of that
 * one second were already consumed.
 *
 * One wire format, always: `YYYY-MM-DD HH:MM:SS|<id>`. Core orders cursors only
 * when both sides carry one shape it recognises (#2606), so a second format on
 * any path - including a fallback - would silently switch the monotonicity
 * guard off across the boundary between them.
 *
 * @module libs/integrations/prestashop/src/domain/types
 */

/**
 * A read position in the order feed.
 */
export interface PrestashopOrderFeedCursor {
  /** Shop-local `date_upd` wall clock, `YYYY-MM-DD HH:MM:SS`. */
  updatedAt: string;
  /** Highest `id_order` already consumed AT `updatedAt`. */
  lastOrderId: number;
}

const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;

/**
 * Separator between the two keyset parts. `|` cannot occur in either part, so
 * the format needs no escaping.
 */
const SEPARATOR = '|';

/**
 * Serialize a read position.
 */
export function formatOrderFeedCursor(cursor: PrestashopOrderFeedCursor): string {
  return `${cursor.updatedAt}${SEPARATOR}${cursor.lastOrderId}`;
}

/**
 * Read a read position back.
 *
 * Accepts a bare timestamp with no keyset part, which is what every cursor
 * persisted before this format looks like. Such a cursor resumes at id 0, so the
 * first poll after the upgrade re-reads that one second and re-enqueues it - the
 * ingestion path is idempotent, and re-reading a second is the cheap direction
 * of the trade.
 *
 * Returns `null` for anything that is not a wall clock, rather than a position
 * derived from a guess: a cursor we cannot read must mean "read from the
 * beginning", never "read from now", which would skip everything in between.
 */
export function parseOrderFeedCursor(raw: string | null | undefined): PrestashopOrderFeedCursor | null {
  if (!raw) {
    return null;
  }

  const [timestampPart, idPart] = raw.trim().split(SEPARATOR);
  const normalized = normalizeWallClock(timestampPart ?? '');
  if (normalized === null) {
    return null;
  }

  const parsedId = idPart === undefined ? 0 : Number.parseInt(idPart, 10);

  return {
    updatedAt: normalized,
    lastOrderId: Number.isFinite(parsedId) && parsedId > 0 ? parsedId : 0,
  };
}

/**
 * Coerce a `date_upd` / `date_add` field onto the one wall-clock shape.
 *
 * PrestaShop answers `YYYY-MM-DD HH:MM:SS`; an ISO variant with a `T` is
 * accepted because a shop behind a proxy or a future WebService version may
 * hand one back, and re-formatting it is not interpretation - the digits are
 * kept exactly as they arrived. Anything else is `null`, never a substituted
 * clock reading.
 */
export function normalizeWallClock(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const match = WALL_CLOCK.exec(value.trim());
  if (match === null) {
    return null;
  }

  const [, year, month, day, hours, minutes, seconds] = match;
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * Move a wall clock back by whole seconds, in UTC.
 *
 * The shift exists because the WebService offers `>` but no `>=`: to include the
 * orders that share the cursor's own second, the filter has to ask for the
 * second before it. UTC is not a claim about the shop's zone - the value is
 * parsed and re-formatted in the same zone, so the arithmetic cancels out, and
 * doing it in UTC additionally means a DST boundary cannot make a second
 * disappear or repeat.
 */
export function shiftWallClockSeconds(wallClock: string, deltaSeconds: number): string {
  const match = WALL_CLOCK.exec(wallClock);
  if (match === null) {
    return wallClock;
  }

  const [, year, month, day, hours, minutes, seconds] = match;
  const asUtcMs = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hours),
    Number(minutes),
    Number(seconds)
  );
  const shifted = new Date(asUtcMs + deltaSeconds * 1000);

  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ` +
    `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`
  );
}

/**
 * True when `(updatedAt, orderId)` was already consumed at or before `cursor`.
 *
 * The timestamp comparison is lexicographic, which is chronological for this
 * fixed-width format and needs no `Date`. Equality on the timestamp defers to
 * the id, which is the whole point of the keyset: a row from the cursor's own
 * second is consumed only if its id is not past the one we stopped at.
 */
export function isAlreadyConsumed(
  cursor: PrestashopOrderFeedCursor,
  updatedAt: string,
  orderId: number
): boolean {
  if (updatedAt < cursor.updatedAt) {
    return true;
  }
  if (updatedAt > cursor.updatedAt) {
    return false;
  }
  return orderId <= cursor.lastOrderId;
}

/**
 * True when `candidate` is a read position ahead of `current`.
 */
export function isAheadOf(
  candidate: PrestashopOrderFeedCursor,
  current: PrestashopOrderFeedCursor
): boolean {
  return !isAlreadyConsumed(current, candidate.updatedAt, candidate.lastOrderId);
}
