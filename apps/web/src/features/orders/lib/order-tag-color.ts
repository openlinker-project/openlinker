/**
 * Order tag colour helpers (#3532/#3533, D34)
 *
 * A tag created from the picker gets no colour choice — the picker is a
 * search box, not a form — so it gets a deterministic one that cycles the
 * closed set; the Settings manager pre-selects the same value so both entry
 * points agree on what "the next colour" is.
 *
 * @module apps/web/src/features/orders/lib
 */
import { OrderTagColorValues, type OrderTag, type OrderTagColorValue } from '../api/orders.types';

export function pickNextColor(existing: readonly Pick<OrderTag, 'id'>[]): OrderTagColorValue {
  return OrderTagColorValues[existing.length % OrderTagColorValues.length];
}
