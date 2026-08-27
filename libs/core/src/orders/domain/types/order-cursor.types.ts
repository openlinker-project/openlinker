/**
 * Order Cursor Comparison
 *
 * An order-feed cursor is an OPAQUE, adapter-defined string: an Allegro event id,
 * a PrestaShop `date_upd` watermark, a WooCommerce GMT timestamp, an Erli inbox
 * message id. Core therefore cannot order two cursors in general.
 *
 * This module states exactly which shapes core is willing to order, and answers
 * `unrecognised` for everything else. The asymmetry is deliberate: a FALSE
 * regression stops committing the cursor for that connection and can wedge
 * ingestion permanently, while a MISSED regression costs one repeated read of an
 * idempotent ingestion path. Guessing is therefore never acceptable here.
 *
 * Domain-only: pure, no framework dependencies. Kept beside the type it is the
 * rule for, per `docs/engineering-standards.md` § pure-rule exception.
 *
 * @module libs/core/src/orders/domain/types
 */

export const OrderCursorOrderValues = ['regressed', 'not-regressed', 'unrecognised'] as const;

/**
 * Result of ordering two cursors.
 *
 * - `regressed`: the shape is recognised and `next` is strictly behind `previous`.
 * - `not-regressed`: the shape is recognised and `next` is equal to or ahead of `previous`.
 * - `unrecognised`: core does not know how to order this shape. Callers MUST treat
 *   this as "no regression"; it is never evidence of one.
 */
export type OrderCursorOrder = (typeof OrderCursorOrderValues)[number];

/** Unsigned decimal counter, e.g. an event sequence number. */
const DECIMAL_COUNTER = /^[0-9]+$/;

/**
 * ISO 8601 instant with an explicit UTC designator or numeric offset. The offset
 * is required: without it the string is a local wall-clock reading and two such
 * readings from different zones are not comparable.
 */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Naive `YYYY-MM-DD HH:MM:SS` wall clock, the shape PrestaShop's `date_upd`
 * carries. It has no zone, so it is only ordered against another reading of the
 * same shape, and then lexicographically - which for this fixed-width format is
 * chronological without ever constructing a Date in the host's own zone.
 */
const NAIVE_WALL_CLOCK = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

function order(isBehind: boolean): OrderCursorOrder {
  return isBehind ? 'regressed' : 'not-regressed';
}

/**
 * Order two order-feed cursors, refusing to answer for shapes core does not
 * understand.
 *
 * Both cursors must be of the SAME recognised shape. A mixed pair (an adapter
 * that changed its cursor format across a deploy, say) is `unrecognised` rather
 * than coerced, because coercing it is exactly how a legitimate forward move
 * gets reported as a regression.
 */
export function compareOrderCursors(previous: string, next: string): OrderCursorOrder {
  const prev = previous.trim();
  const nxt = next.trim();

  if (prev === '' || nxt === '') {
    return 'unrecognised';
  }

  if (prev === nxt) {
    return 'not-regressed';
  }

  if (DECIMAL_COUNTER.test(prev) && DECIMAL_COUNTER.test(nxt)) {
    // BigInt, not Number: an id longer than 15 digits loses precision as a float,
    // and two distinct cursors would then compare equal.
    return order(BigInt(nxt) < BigInt(prev));
  }

  if (ISO_INSTANT.test(prev) && ISO_INSTANT.test(nxt)) {
    const prevMs = Date.parse(prev);
    const nextMs = Date.parse(nxt);
    if (!Number.isFinite(prevMs) || !Number.isFinite(nextMs)) {
      return 'unrecognised';
    }
    return order(nextMs < prevMs);
  }

  if (NAIVE_WALL_CLOCK.test(prev) && NAIVE_WALL_CLOCK.test(nxt)) {
    return order(nxt < prev);
  }

  return 'unrecognised';
}
