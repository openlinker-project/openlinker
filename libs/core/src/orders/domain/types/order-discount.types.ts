/**
 * Order Discount (#3543, D10, ADR-014 amendment)
 *
 * An order-level discount an operator grants AFTER import is a money event, not a
 * price rewrite: ingestion keeps storing the price the buyer was charged on the
 * channel (ADR-014), and the discount lives in the order-edits overlay
 * (`order_records.orderEdits.discount`), merged over the channel snapshot when a
 * record is read. Every document, label and surface therefore reads the
 * discounted figures, while the channel's own figures stay readable beside them.
 *
 * ## The rules this file owns
 *
 * - **One discount per order.** The overlay stores the CURRENT absolute discount;
 *   a second one replaces the first and never stacks. An amount of `0` is stored
 *   as a zero discount (a tombstone, not an absent key) so the overlay's `rev`
 *   stays readable after the only section is cleared.
 * - **The split is derived, not trusted.** `perLine` is stored for audit and for
 *   the correction proposal, but the merge RE-DERIVES the split from the absolute
 *   amount over the lines as they are NOW. A quantity lowered after the discount
 *   therefore cannot leave the lines summing to something other than the total.
 * - **Rounding.** The split is `distributeOrderDiscount` (exact in the currency's
 *   minor unit, shares floored, remainder on the largest line - the
 *   `splitShippingAcrossRates` rule). A line's per-UNIT gross price is then
 *   `round((line gross total - line share) / quantity)` at the minor unit; the
 *   residual of at most half a minor unit per unit is within the tolerance the
 *   document mappers already allow for per-unit rounding
 *   (`quantityScaledReconciliationEpsilon`), so the lines still reconcile to the
 *   restated total.
 * - **No tax.** Core computes none (ADR-063): `totals.tax` stays the channel's.
 *   A net-priced line keeps its net `price`; only its gross carrier moves.
 *
 * Pure functions, no I/O (the pure-rule exception in
 * `docs/engineering-standards.md`).
 *
 * @module libs/core/src/orders/domain/types
 */
import { minorUnitExponentFor } from '@openlinker/core/sales-documents';

import { distributeOrderDiscount } from './order-discount-split.types';
import type { OrderEditStamp } from './order-edits.types';

/** One line's share of the discount, in the order currency, GROSS. */
export interface OrderDiscountLine {
  readonly orderItemId: string;
  /** Decimal string at the currency's minor unit. */
  readonly amount: string;
}

export interface OrderDiscountEdit extends OrderEditStamp {
  /** Decimal string at the currency's minor unit; `"0"`-valued means "no discount". */
  readonly amount: string;
  readonly currency: string;
  readonly perLine: readonly OrderDiscountLine[];
}

/** The slice of a line the discount needs; `OrderItem` and a snapshot item both satisfy it. */
export interface DiscountableLine {
  readonly id: string;
  readonly quantity: number;
  readonly price: number;
  readonly unitPriceGross?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exponentOf(currency: string): number {
  return minorUnitExponentFor(currency.trim() === '' ? 'PLN' : currency.trim());
}

function toMinor(value: number, exponent: number): number {
  return Math.round((value + Number.EPSILON) * 10 ** exponent);
}

function fromMinor(minor: number, exponent: number): number {
  return Number((minor / 10 ** exponent).toFixed(exponent));
}

/** A decimal string like `"12"` or `"12.50"`; no sign, no exponent, no grouping. */
export function isDecimalAmountText(value: unknown): value is string {
  return typeof value === 'string' && /^\d+(\.\d+)?$/.test(value);
}

/** Digits after the decimal point of an amount string. */
export function decimalPlaces(value: string): number {
  const dot = value.indexOf('.');
  return dot === -1 ? 0 : value.length - dot - 1;
}

/**
 * Coerce a persisted `orderEdits.discount`. Never throws: a malformed value reads
 * as `undefined` (no discount) so one corrupt section cannot hide the others.
 */
export function readOrderDiscountEdit(value: unknown): OrderDiscountEdit | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.changeId !== 'string' ||
    typeof value.editedAt !== 'string' ||
    !isDecimalAmountText(value.amount) ||
    typeof value.currency !== 'string'
  ) {
    return undefined;
  }
  const perLine: OrderDiscountLine[] = [];
  if (Array.isArray(value.perLine)) {
    for (const raw of value.perLine) {
      if (isRecord(raw) && typeof raw.orderItemId === 'string' && isDecimalAmountText(raw.amount)) {
        perLine.push({ orderItemId: raw.orderItemId, amount: raw.amount });
      }
    }
  }
  return {
    changeId: value.changeId,
    editedAt: value.editedAt,
    editedBy: typeof value.editedBy === 'string' ? value.editedBy : null,
    amount: value.amount,
    currency: value.currency,
    perLine,
  };
}

/** The discount as a positive number in the order currency, or `0` when there is none. */
export function effectiveDiscountAmount(discount: OrderDiscountEdit | undefined): number {
  if (discount === undefined) return 0;
  const amount = Number(discount.amount);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

/** Gross value of one line as the buyer was charged for it. */
export function lineGrossTotal(line: DiscountableLine): number {
  return line.quantity * (line.unitPriceGross ?? line.price);
}

/** Σ line gross totals: the goods value a discount is distributed across. */
export function goodsGrossValue(lines: readonly DiscountableLine[]): number {
  return lines.reduce((sum, line) => sum + lineGrossTotal(line), 0);
}

export interface PlannedOrderDiscount {
  /** The discount actually applied, as a number at the minor unit. */
  readonly amount: number;
  readonly perLine: ReadonlyArray<{
    readonly orderItemId: string;
    /** This line's share. */
    readonly share: number;
    /** What the line's gross total is after its share. */
    readonly grossTotalAfter: number;
    /** `grossTotalAfter / quantity` at the minor unit. */
    readonly unitPriceGrossAfter: number;
  }>;
}

/**
 * Cut `amount` across the lines. `null` when it cannot be done soundly - not a
 * positive amount, no goods value, or an amount at least as large as the goods
 * (which would make a line free or negative). Callers refuse in that case.
 */
export function planOrderDiscount(
  lines: readonly DiscountableLine[],
  amount: number,
  currency: string
): PlannedOrderDiscount | null {
  const exponent = exponentOf(currency);
  const split = distributeOrderDiscount(lines.map(lineGrossTotal), amount, exponent);
  if (split === null) return null;
  return {
    amount: fromMinor(toMinor(amount, exponent), exponent),
    perLine: lines.map((line, index) => {
      const after = split[index].grossTotalAfterDiscount;
      const share = fromMinor(
        toMinor(split[index].grossTotal, exponent) - toMinor(after, exponent),
        exponent
      );
      return {
        orderItemId: line.id,
        share,
        grossTotalAfter: after,
        unitPriceGrossAfter: fromMinor(toMinor(after / line.quantity, exponent), exponent),
      };
    }),
  };
}

export interface DiscountApplication<T extends DiscountableLine> {
  readonly items: T[];
  /** The discount applied to the lines; `0` when none (or one that cannot be distributed). */
  readonly amount: number;
}

/**
 * Reduce the lines by the discount. `inclusive` is whether `price` is the gross
 * figure: only then is `price` moved, because on a net-priced source it is net and
 * moving it would put a gross reduction into a net field.
 *
 * An undistributable discount is IGNORED here (`amount: 0`, items untouched)
 * rather than thrown: this runs on every read of an order, and a read must not
 * fail. The write path refuses such a discount, so it is reachable only through a
 * later quantity edit, which the edit service also refuses.
 */
export function applyDiscountToLines<T extends DiscountableLine>(
  items: readonly T[],
  discount: OrderDiscountEdit | undefined,
  currency: string,
  inclusive: boolean
): DiscountApplication<T> {
  const amount = effectiveDiscountAmount(discount);
  if (amount === 0) return { items: [...items], amount: 0 };
  const plan = planOrderDiscount(items, amount, currency);
  if (plan === null) return { items: [...items], amount: 0 };
  const byId = new Map(plan.perLine.map((line) => [line.orderItemId, line]));
  const out = items.map((item) => {
    const share = byId.get(item.id);
    if (share === undefined || share.share === 0) return item;
    const next: T = { ...item };
    if (item.unitPriceGross !== undefined) {
      (next as { unitPriceGross?: number }).unitPriceGross = share.unitPriceGrossAfter;
    }
    if (inclusive) {
      (next as { price: number }).price = share.unitPriceGrossAfter;
    }
    return next;
  });
  return { items: out, amount: plan.amount };
}

/** Totals restated for the discount: `total`, `subtotal` (gross-priced only) and `discountTotal`. */
export function restateTotalsForDiscount<
  T extends { total: number; subtotal: number; currency: string; discountTotal?: number },
>(totals: T, discountAmount: number, inclusive: boolean): T {
  if (discountAmount === 0) return totals;
  const exponent = exponentOf(totals.currency);
  const round = (value: number): number => Number(value.toFixed(exponent));
  return {
    ...totals,
    total: Math.max(0, round(totals.total - discountAmount)),
    subtotal: inclusive ? Math.max(0, round(totals.subtotal - discountAmount)) : totals.subtotal,
    discountTotal: round((totals.discountTotal ?? 0) + discountAmount),
  };
}

/**
 * The gross unit price a document line should carry for this discount, from the
 * CHANNEL line it descends from. Absolute (never a delta against the document's
 * current price), so a replaced discount converges and a removed one returns the
 * channel price.
 */
export function discountedUnitPriceGross(
  channelLine: DiscountableLine,
  lineShare: number,
  currency: string
): number {
  const exponent = exponentOf(currency);
  const after = toMinor(lineGrossTotal(channelLine), exponent) - toMinor(lineShare, exponent);
  return fromMinor(toMinor(Math.max(0, after) / 10 ** exponent / channelLine.quantity, exponent), exponent);
}
