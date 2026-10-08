/**
 * Shoper Incoming Order Mapper
 *
 * Pure mapping of a Shoper order row and its `order-products` rows onto the
 * neutral `IncomingOrder`. No I/O: the adapter supplies the shop facts the order
 * only names by id (status type, currency code, shipping method name, time zone).
 *
 * Amounts: a Shoper line's `price` is the GROSS unit price the buyer paid
 * (SPIKE-3638 O4), so it passes through untouched (ADR-014) and the totals are
 * declared `inclusive`. A line's tax rate is read from what Shoper stored on the
 * line and is left ABSENT when it is unreadable - never defaulted (ADR-063).
 * Tax in the totals is derived by DIVISION (`gross - gross / (1 + rate)`), never
 * by `gross * rate`; it is informational and covers only lines with a known rate.
 *
 * @module libs/integrations/shoper/src/infrastructure/mappers
 */
import type {
  IncomingOrder,
  IncomingOrderAddress,
  IncomingOrderItem,
  IncomingOrderItemRef,
  PaymentStatus,
} from '@openlinker/core/orders';
import { PAYMENT_STATUS, readSourceBuyerTaxId } from '@openlinker/core/orders';

import type {
  ShoperOrderLineRow,
  ShoperOrderRow,
  ShoperOrderSourceAddress,
} from '../../domain/types/shoper-api.types';
import type { ShoperOrderStatusInfo } from '../../domain/types/shoper-order-status.types';
import { mapShoperTaxName } from './shoper-tax-rate.mapper';

const EPOCH_ISO = '1970-01-01T00:00:00.000Z';

/** Shoper status `type` -> the neutral order status. Type 4 is split by label, see `mapShoperOrderStatus`. */
const STATUS_BY_TYPE: Readonly<Record<number, string>> = {
  1: 'pending',
  2: 'processing',
  3: 'shipped',
};

/**
 * Refund vocabulary, folded to unaccented lower case, one entry per word family.
 * Shoper's type 4 covers cancelled, rejected AND returned, and the type alone
 * cannot tell a refund from a cancellation; reading the labels is the precedent
 * the PrestaShop source set for the same ambiguity. A shop whose terminal status
 * is named in a language not listed here reads as `cancelled`.
 */
const REFUND_STEMS: readonly string[] = [
  'zwro', // pl: zwrot, zwrócone
  'refund',
  'return',
  'rembours', // fr
  'reembols', // es, pt
  'rimbors', // it
  'ruckerstatt', // de
  'erstatt', // de, da, no
  'terugbetaa', // nl
];

function foldLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .toLowerCase();
}

/** What the order names only by id, resolved by the adapter from the shop's own tables. */
export interface ShoperIncomingOrderContext {
  /** The order's status as `GET /statuses` lists it; null when the shop does not list it. */
  readonly status: ShoperOrderStatusInfo | null;
  /** ISO code of `currency_id`; null when the shop does not list it. */
  readonly currencyCode: string | null;
  readonly shippingName: string | null;
  /** IANA zone of the shop's naive timestamps; null reads them as UTC. */
  readonly timezone: string | null;
}

function num(raw: string | number | null | undefined): number | undefined {
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
    return undefined;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function nonEmpty(raw: string | null | undefined): string | undefined {
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : undefined;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Offset (ms) of `timeZone` from UTC at the instant `utcMs`. */
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  const asIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asIfUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * Shoper writes order timestamps as a naive `YYYY-MM-DD HH:MM:SS` in the shop's
 * own zone. Returns the ISO instant, or null when the value is unreadable. A null
 * or unknown zone reads the value as UTC.
 */
export function shopLocalToIso(local: string | null | undefined, timeZone: string | null): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec((local ?? '').trim());
  if (match === null) {
    return null;
  }
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(naive);
  // Date.UTC rolls an impossible reading (month 13, hour 99) over instead of
  // refusing it; a value that does not survive the round trip is not a timestamp.
  if (
    Number.isNaN(naive) ||
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute ||
    check.getUTCSeconds() !== second
  ) {
    return null;
  }
  if (timeZone === null) {
    return new Date(naive).toISOString();
  }
  try {
    // Two passes: the offset at the wall-clock reading can differ from the offset
    // at the instant it denotes when a DST boundary lies between them.
    const first = naive - zoneOffsetMs(naive, timeZone);
    return new Date(naive - zoneOffsetMs(first, timeZone)).toISOString();
  } catch {
    return new Date(naive).toISOString();
  }
}

export function mapShoperOrderStatus(status: ShoperOrderStatusInfo | null): string {
  if (status === null) {
    return 'pending';
  }
  if (status.type === 4) {
    const refunded = status.labels.some((label) => {
      const folded = foldLabel(label);
      return REFUND_STEMS.some((stem) => folded.includes(stem));
    });
    return refunded ? 'refunded' : 'cancelled';
  }
  return STATUS_BY_TYPE[status.type] ?? 'pending';
}

/**
 * Reports `cod` or `paid`, and otherwise NOTHING - the silence is load-bearing.
 *
 * `awaiting` is deliberately never reported. `DISPATCH_BLOCKING_PAYMENT_STATUSES`
 * holds `awaiting` and `refunded`, so either one makes OpenLinker refuse a
 * shipping label with a 422, and Shoper cannot tell "unpaid, the buyer will pay
 * before dispatch" from "unpaid, pays at pickup or the courier": only the
 * "Pobranie" method sets `is_cash_on_delivery`, while a cash-at-pickup or bank
 * transfer order is also `paid = 0`. Reporting `awaiting` would block shipping
 * orders that are legitimately unpaid. PrestaShop and WooCommerce follow the same
 * rule: a source that cannot distinguish the two must not assume the first.
 * A terminal status says nothing about money either, so it reports nothing.
 */
export function mapShoperPaymentStatus(
  row: ShoperOrderRow,
  status: ShoperOrderStatusInfo | null,
): PaymentStatus | undefined {
  if (status?.type === 4) {
    return undefined;
  }
  if (row.is_cash_on_delivery === true) {
    return PAYMENT_STATUS.Cod;
  }
  if (row.is_paid === true) {
    return PAYMENT_STATUS.Paid;
  }
  return undefined;
}

function mapAddress(raw: ShoperOrderSourceAddress | null | undefined): IncomingOrderAddress | undefined {
  if (raw === null || raw === undefined) {
    return undefined;
  }
  const address1 = nonEmpty(raw.street1);
  const city = nonEmpty(raw.city);
  if (address1 === undefined && city === undefined) {
    return undefined;
  }
  const taxId = readSourceBuyerTaxId(raw.tax_identification_number);
  return {
    address1: address1 ?? '',
    city: city ?? '',
    postalCode: nonEmpty(raw.postcode) ?? '',
    country: nonEmpty(raw.country_code)?.toUpperCase() ?? '',
    ...(nonEmpty(raw.firstname) === undefined ? {} : { firstName: nonEmpty(raw.firstname) as string }),
    ...(nonEmpty(raw.lastname) === undefined ? {} : { lastName: nonEmpty(raw.lastname) as string }),
    ...(nonEmpty(raw.company) === undefined ? {} : { company: nonEmpty(raw.company) as string }),
    ...(nonEmpty(raw.street2) === undefined ? {} : { address2: nonEmpty(raw.street2) as string }),
    ...(nonEmpty(raw.state) === undefined ? {} : { state: nonEmpty(raw.state) as string }),
    ...(nonEmpty(raw.phone) === undefined ? {} : { phone: nonEmpty(raw.phone) as string }),
    ...(taxId === undefined ? {} : { taxId }),
  };
}

function lineRef(line: ShoperOrderLineRow): IncomingOrderItemRef {
  const stockId = num(line.stock_id);
  if (stockId !== undefined && stockId > 0) {
    return { type: 'variant', externalId: String(line.stock_id) };
  }
  const productId = num(line.product_id);
  if (productId !== undefined && productId > 0) {
    return { type: 'product', externalId: String(line.product_id) };
  }
  const code = nonEmpty(line.code);
  return code === undefined
    ? { type: 'sku', externalId: String(line.id) }
    : { type: 'sku', externalId: code };
}

function mapLine(line: ShoperOrderLineRow): IncomingOrderItem {
  const gross = num(line.price) ?? 0;
  const taxRate = mapShoperTaxName(line.tax);
  const sku = nonEmpty(line.code);
  const name = nonEmpty(line.name);
  return {
    id: String(line.id),
    productRef: lineRef(line),
    quantity: num(line.quantity) ?? 0,
    price: gross,
    unitPriceGross: gross,
    ...(sku === undefined ? {} : { sku }),
    ...(name === undefined ? {} : { name }),
    ...(taxRate === null ? {} : { taxRate }),
  };
}

/** Tax contained in a gross amount at `percent`, by division. */
function taxIn(gross: number, percent: number): number {
  return gross - gross / (1 + percent / 100);
}

function containedTax(
  lines: readonly ShoperOrderLineRow[],
  shippingCost: number,
  shippingTaxPercent: number | undefined,
): number {
  let tax = 0;
  for (const line of lines) {
    const percent = num(line.tax_value);
    const gross = (num(line.price) ?? 0) * (num(line.quantity) ?? 0);
    if (percent !== undefined && percent > 0) {
      tax += taxIn(gross, percent);
    }
  }
  if (shippingTaxPercent !== undefined && shippingTaxPercent > 0) {
    tax += taxIn(shippingCost, shippingTaxPercent);
  }
  return round2(tax);
}

export function mapShoperOrderToIncoming(
  row: ShoperOrderRow,
  lines: readonly ShoperOrderLineRow[],
  ctx: ShoperIncomingOrderContext,
): IncomingOrder {
  const total = num(row.sum) ?? 0;
  const shipping = num(row.shipping_cost) ?? 0;
  const placedAt = shopLocalToIso(row.date, ctx.timezone);
  const createdAt = placedAt ?? EPOCH_ISO;
  const updatedAt = shopLocalToIso(row.status_date, ctx.timezone) ?? createdAt;
  const paymentStatus = mapShoperPaymentStatus(row, ctx.status);
  const userId = num(row.user_id);
  const email = nonEmpty(row.email);
  const shippingAddress = mapAddress(row.delivery_address);
  const billingAddress = mapAddress(row.billing_address);
  const currency = ctx.currencyCode ?? '';
  const orderUrl = nonEmpty(row.order_url);
  const shippingId = nonEmpty(row.shipping_id === null || row.shipping_id === undefined ? undefined : String(row.shipping_id));

  return {
    externalOrderId: String(row.order_id),
    orderNumber: String(row.order_id),
    ...(orderUrl === undefined ? {} : { externalUrl: orderUrl }),
    status: mapShoperOrderStatus(ctx.status),
    ...(paymentStatus === undefined ? {} : { paymentStatus }),
    ...(userId !== undefined && userId > 0 ? { customerExternalId: String(row.user_id) } : {}),
    ...(email === undefined ? {} : { customerEmail: email }),
    items: lines.map(mapLine),
    totals: {
      subtotal: round2(total - shipping),
      tax: containedTax(lines, shipping, num(row.shipping_tax_value)),
      shipping,
      total,
      currency,
      taxTreatment: 'inclusive',
      shippingGross: shipping,
    },
    ...(shippingAddress === undefined ? {} : { shippingAddress }),
    ...(billingAddress === undefined ? {} : { billingAddress }),
    ...(shippingId === undefined
      ? {}
      : {
          shipping: {
            methodId: shippingId,
            ...(ctx.shippingName === null ? {} : { methodName: ctx.shippingName }),
          },
        }),
    ...(row.is_cash_on_delivery === true && total > 0 && currency !== ''
      ? { codToCollect: { amount: total.toFixed(2), currency } }
      : {}),
    ...(placedAt === null ? {} : { placedAt }),
    createdAt,
    updatedAt,
  };
}
