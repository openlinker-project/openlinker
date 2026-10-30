/**
 * Combined discount wording (#3544, E-44).
 *
 * An order can carry a discount the channel applied AND one the operator added
 * in OpenLinker. The operator needs the one figure, and where it comes from.
 * Both channel fields are optional: an older payload that lacks them falls back
 * to the OpenLinker amount alone.
 */
import { formatAmount } from '../../../shared/format/format-amount';

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
  const money = (n: number): string => formatAmount(n, totals.currency);
  const parts: string[] = [];
  if (channel !== null) parts.push(`${money(channel)} at ${channelName ?? 'the channel'}`);
  if (own !== null) parts.push(`${money(own)} in OpenLinker`);
  return parts.length === 1 && own !== null && channel === null
    ? `Discount: ${money(own)} in OpenLinker`
    : `Discount: ${parts.join(' + ')} = ${money(combined)}`;
}
