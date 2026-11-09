/**
 * Combined discount wording (#3544, E-44).
 *
 * An order can carry a discount the channel applied AND one the operator added
 * in OpenLinker. The operator needs the one figure, and where it comes from.
 * Both channel fields are optional: an older payload that lacks them falls back
 * to the OpenLinker amount alone.
 */
import { formatAmount } from '../../../shared/format/format-amount';
import { getMessages, interpolate } from '../../../shared/i18n';

export interface CombinedDiscountInput {
  currency: string;
  /** The channel's own whole-order discount; null/absent = it reported none. */
  channelDiscountTotal?: number | null;
  /** Channel + OpenLinker; absent on an older payload. */
  combinedDiscountTotal?: number | null;
}

/** "5.00 PLN at the channel + 10.00 PLN in OpenLinker = 15.00 PLN", only the parts that exist. */
export function describeCombinedDiscount(
  totals: CombinedDiscountInput,
  openLinkerAmount: number | null,
  channelName: string | null
): string | null {
  const channel = totals.channelDiscountTotal ?? null;
  const own = openLinkerAmount !== null && openLinkerAmount > 0 ? openLinkerAmount : null;
  const combined = totals.combinedDiscountTotal ?? (channel ?? 0) + (own ?? 0);
  if (channel === null && own === null) return null;
  const copy = getMessages('orders').combinedDiscount;
  const money = (n: number): string => formatAmount(n, totals.currency);
  if (channel === null && own !== null) return interpolate(copy.ownOnly, { amount: money(own) });
  const parts: string[] = [];
  if (channel !== null) {
    parts.push(
      interpolate(copy.channelPart, { amount: money(channel), channel: channelName ?? copy.channelFallback }),
    );
  }
  if (own !== null) parts.push(interpolate(copy.ownPart, { amount: money(own) }));
  return interpolate(copy.combined, { parts: parts.join(' + '), total: money(combined) });
}
