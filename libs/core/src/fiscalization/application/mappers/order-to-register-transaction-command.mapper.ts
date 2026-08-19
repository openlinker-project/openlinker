/**
 * Order -> RegisterTransactionCommand mapper (command composer)
 *
 * Pure function (no NestJS, no I/O) that composes a `RegisterTransactionCommand`
 * from a core `Order` plus caller-supplied context. The client never sends the
 * lines: an operator asks for an order to be registered, and the sale is derived
 * server-side from the order snapshot.
 *
 * Neutral throughout - no country, regime or vendor vocabulary, and NO tax
 * arithmetic: the amounts are the buyer-paid gross figures the source reported,
 * carried through unchanged (ADR-042 decision 8).
 *
 * @module libs/core/src/fiscalization/application/mappers
 */
import type { Order, OrderItem } from '@openlinker/core/orders';

import type {
  FiscalRecipient,
  FiscalTransactionLine,
  RegisterTransactionCommand,
} from '../../domain/types/fiscalization.types';
import { InvalidFiscalLineError } from './errors/invalid-fiscal-line.error';
import { UnsupportedFiscalPriceTreatmentError } from './errors/unsupported-fiscal-price-treatment.error';

/**
 * Default carrier-neutral label for the shipping line. Core has no locale, so
 * this English default is intentionally untranslated; a caller that has a locale
 * overrides it via {@link OrderToRegisterTransactionCommandInput.shippingLineName}.
 */
const SHIPPING_LINE_NAME = 'Shipping';

/**
 * Minor-unit digits per ISO 4217 currency, for every currency whose exponent is
 * NOT 2. Exhaustive as of ISO 4217:2015 amendments - the vast majority of
 * currencies are 2-digit, so listing the exceptions keeps the table small and
 * makes an unknown code fall through to the safe default below.
 *
 * This is a UNIT COUNT, not a rate and not an amount: it says how finely a
 * currency can express money, which is what "one minor unit of tolerance" needs
 * to mean the same thing in JPY as in PLN.
 */
const CURRENCY_MINOR_UNIT_DIGITS: Readonly<Record<string, number>> = {
  // Exponent 0 - no minor unit at all.
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  ISK: 0,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  PYG: 0,
  RWF: 0,
  UGX: 0,
  UYI: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
  // Exponent 3.
  BHD: 3,
  IQD: 3,
  JOD: 3,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  TND: 3,
  // Exponent 4 - unit-of-account currencies; included for completeness.
  CLF: 4,
  UYW: 4,
};

/**
 * Minor-unit digits assumed for a currency the table doesn't name. Two is both
 * the ISO default and the conservative choice here: an unknown 0-digit currency
 * merely gets a tolerance finer than its own smallest coin (stricter, never
 * laxer), while assuming 0 for an unknown 2-digit currency would reject every
 * ordinary basket carrying a grosz of float dust.
 */
const DEFAULT_MINOR_UNIT_DIGITS = 2;

/**
 * Tolerance, in the currency's own units, when checking that the composed lines
 * sum to the reported total.
 *
 * ONE MINOR UNIT of the order's own currency - `0.01` for PLN/EUR, `1` for JPY,
 * `0.001` for KWD. Wide enough to absorb IEEE-754 accumulation across a normal
 * basket and per-line rounding the source already did; narrow enough that a
 * folded discount, a coupon or a zero-defaulted snapshot field cannot hide
 * inside it.
 *
 * Deriving it rather than fixing it at `0.01` matters in both directions: a
 * 3-decimal currency (KWD) would otherwise tolerate ten of its own minor units
 * of unexplained drift, and a 0-decimal currency (JPY) would reject a whole-yen
 * basket carrying float dust. Neither is reachable from the PL v1 regime, but
 * the constant is in `libs/core` and the next regime is what it exists for.
 *
 * NOT tax arithmetic - it compares two sets of gross figures the source itself
 * reported (ADR-042 decision 8's negative half is about never computing a RATE,
 * which this does not). Nor is it a price conversion: nothing here rewrites an
 * amount, it only decides whether two reported amounts agree.
 */
function totalReconciliationEpsilon(currency: string | undefined): number {
  const digits =
    CURRENCY_MINOR_UNIT_DIGITS[(currency ?? '').trim().toUpperCase()] ??
    DEFAULT_MINOR_UNIT_DIGITS;
  return 10 ** -digits;
}

/** Inputs to {@link toRegisterTransactionCommand}. */
export interface OrderToRegisterTransactionCommandInput {
  order: Order;
  connectionId: string;
  /**
   * MANDATORY exactly-once key (ADR-042 decision 6). There is no keyless mode:
   * the caller must decide what "the same registration" means before core will
   * run one.
   */
  idempotencyKey: string;
  /** Optional locale-specific override for the shipping line label. */
  shippingLineName?: string;
}

/**
 * Compose a `RegisterTransactionCommand` from an `Order`.
 *
 * Throws {@link UnsupportedFiscalPriceTreatmentError} when the order is
 * net-priced, and {@link InvalidFiscalLineError} when an item's quantity is not
 * a positive finite number, or when the composed lines do not sum to the
 * order's reported gross total. All of them fire BEFORE anything is persisted or
 * sent, so a malformed order produces no record and no provider call.
 *
 * Appends a gross shipping line when the buyer paid for shipping, and then
 * VERIFIES that the lines sum to the buyer-paid order total rather than merely
 * intending to - see {@link assertLinesSumToTotal}.
 */
export function toRegisterTransactionCommand(
  input: OrderToRegisterTransactionCommandInput,
): RegisterTransactionCommand {
  const { order, connectionId, idempotencyKey, shippingLineName } = input;

  // GROSS-only: a net-priced order would register net amounts labelled as gross,
  // and core may not convert (it never computes or defaults a tax rate). Fail
  // loud. An ABSENT treatment is the documented gross assumption - marketplaces
  // report buyer-paid gross - so it is accepted.
  if (order.totals.taxTreatment === 'exclusive') {
    throw new UnsupportedFiscalPriceTreatmentError(
      `Order ${order.id} is net-priced (taxTreatment "exclusive"); ` +
        `only gross-priced orders can be registered`,
    );
  }

  const lines = order.items.map((item) => toFiscalLine(item, order.id));

  const shippingLine = toShippingLine(order.totals.shipping, shippingLineName);
  if (shippingLine) {
    lines.push(shippingLine);
  }

  assertLinesSumToTotal(lines, order.totals.total, order.id, order.totals.currency);

  const command: RegisterTransactionCommand = {
    connectionId,
    orderId: order.id,
    idempotencyKey,
    currency: order.totals.currency,
    lines,
    totalGross: order.totals.total,
  };

  // The sale time is the SOURCE's placement timestamp only. `createdAt` is OL's
  // ingestion clock and must never substitute for when the sale happened.
  if (order.placedAt !== undefined) {
    command.occurredAt = order.placedAt;
  }

  const recipient = toRecipient(order);
  if (recipient) {
    command.recipient = recipient;
  }

  return command;
}

/**
 * Refuse a sale whose lines contradict its own total.
 *
 * A fiscal registration transmits amounts it must not silently distort, so
 * "the lines sum to the total" has to be CHECKED, not asserted in a comment.
 * Three real ways it breaks today, none of them exotic:
 *
 *   - `OrderTotals` carries no discount field, so a source that folds a coupon
 *     or an order-level discount into `total` reports lines that sum higher;
 *   - `orderFromReadySnapshot`'s `readTotals` / `readItems` zero-default every
 *     missing numeric, so a partially malformed snapshot composes zero-priced
 *     lines under a non-zero total (or the reverse);
 *   - a source reporting `total` net of something it never itemised.
 *
 * Blocking with an operator-facing 422 is the fiscally correct answer: the
 * alternative is a receipt whose printed lines do not add up to the amount the
 * buyer paid, which no downstream surface can detect or repair.
 *
 * This is arithmetic on figures the SOURCE reported - a sum and a comparison. It
 * neither computes nor infers a tax rate, so it stays clear of ADR-042 decision
 * 8's negative half.
 */
function assertLinesSumToTotal(
  lines: FiscalTransactionLine[],
  totalGross: number,
  orderId: string,
  currency: string | undefined,
): void {
  if (!Number.isFinite(totalGross)) {
    throw new InvalidFiscalLineError(
      `Order ${orderId} reports a non-finite gross total; cannot compose a registrable sale`,
    );
  }

  const summed = lines.reduce((sum, line) => sum + line.quantity * line.unitPriceGross, 0);
  if (!Number.isFinite(summed)) {
    throw new InvalidFiscalLineError(
      `Order ${orderId} has a line with a non-finite amount; cannot compose a registrable sale`,
    );
  }

  if (Math.abs(summed - totalGross) > totalReconciliationEpsilon(currency)) {
    throw new InvalidFiscalLineError(
      `Order ${orderId} lines sum to ${summed.toFixed(2)} but the order reports a gross total of ` +
        `${totalGross.toFixed(2)}; a fiscal registration may not transmit lines that contradict ` +
        `their own total`,
    );
  }
}

/**
 * Map an {@link OrderItem} onto a {@link FiscalTransactionLine}. `name` falls
 * back to `sku` then `productId` when the source omitted a label. `taxRate` is
 * left EMPTY - the adapter's regime mapping resolves it; core never names a rate.
 */
function toFiscalLine(item: OrderItem, orderId: string): FiscalTransactionLine {
  if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
    throw new InvalidFiscalLineError(
      `Order ${orderId} has an item with a non-positive quantity; ` +
        `cannot compose a registrable line`,
    );
  }
  return {
    name: item.name?.trim() || item.sku || item.productId,
    quantity: item.quantity,
    unitPriceGross: item.price,
    taxRate: '',
    sku: item.sku ?? null,
  };
}

/**
 * Compose the shipping line from the order's gross shipping cost, or `null` when
 * the buyer paid nothing for shipping (no phantom line). Non-positive or
 * non-finite shipping yields no line.
 */
function toShippingLine(
  shipping: number,
  name?: string,
): FiscalTransactionLine | null {
  if (!Number.isFinite(shipping) || shipping <= 0) {
    return null;
  }
  return {
    name: name?.trim() || SHIPPING_LINE_NAME,
    quantity: 1,
    unitPriceGross: shipping,
    taxRate: '',
    sku: null,
  };
}

/**
 * Derive the optional delivery target from the order snapshot. Returns `null`
 * when the snapshot carries neither channel - which is normal under a
 * hash-only PII configuration, and is not an error: an adapter whose provider
 * returns the artefact inline needs no target at all.
 */
function toRecipient(order: Order): FiscalRecipient | null {
  const email = order.customerEmail?.trim() || null;
  const phone = order.shippingAddress?.phone?.trim() || null;
  if (email === null && phone === null) {
    return null;
  }
  return { email, phone };
}
