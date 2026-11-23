/**
 * Mirakl Order → IncomingOrder Mapper
 *
 * Pure translation of a Mirakl OR11 order onto the neutral `IncomingOrder`
 * returned by `OrderSourcePort.getOrder`. It logs nothing and does no I/O, so
 * buyer data never reaches a log line from here.
 *
 * Sources of the less obvious fields (SPIKE-4268, Empik staging):
 *
 * - Buyer tax number: the order additional field `nip`, then the B2B
 *   `organization.tax_identification_number`.
 * - Buyer email: the additional field `customer-email` (the real address),
 *   then `customer_notification_email` (Mirakl's anonymised relay address).
 * - Pickup point: `shipping_pudo_id`, labelled with the additional field
 *   `delivery-point-name`.
 * - Cash on delivery: Empik encodes it in the shipping type, as a `_POD`
 *   suffix (`COURIER_POD`, `PACKSTATION_POD`, ...). Everything else is paid
 *   online to Empik, which settles with the seller.
 *
 * The shape follows the Mirakl spec; it has not yet been checked against a real
 * Empik order, so every field is read as optional.
 *
 * Order lines resolve through `Offer` identifier mappings keyed by the shop SKU
 * (`offer_sku`), the identifier the seller controls on Mirakl.
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters
 */
import type {
  IncomingOrder,
  IncomingOrderAddress,
  IncomingOrderItem,
  IncomingOrderTotals,
  OrderDispatchWindow,
  OrderPickupPoint,
  OrderShipping,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  PriceTaxTreatment,
} from '@openlinker/core/orders';
import { PAYMENT_METHOD, readSourceBuyerTaxId, toCodToCollect } from '@openlinker/core/orders';
import { toAlpha2Country } from '../../domain/policies/mirakl-country.policy';
import { isCancelledOrderState } from '../../domain/policies/mirakl-order-feed.policy';
import type {
  MiraklAdditionalField,
  MiraklAddress,
  MiraklOrder,
  MiraklOrderLine,
  MiraklTax,
} from '../../domain/types/mirakl-order.types';

/** Order additional field codes Empik defines (`AF01`, entity `ORDER`). */
export const MIRAKL_ORDER_FIELD = {
  BuyerTaxId: 'nip',
  CustomerEmail: 'customer-email',
  DeliveryPointName: 'delivery-point-name',
  OrderType: 'order-type',
} as const;

const COD_SHIPPING_SUFFIX = '_POD';
const LOCKER_SHIPPING_PREFIX = 'PACKSTATION';
const AWAITING_PAYMENT_STATES: readonly string[] = [
  'STAGING',
  'WAITING_ACCEPTANCE',
  'WAITING_DEBIT',
  'WAITING_DEBIT_PAYMENT',
];
const PAID_STATES: readonly string[] = ['SHIPPING', 'SHIPPED', 'TO_COLLECT', 'RECEIVED', 'CLOSED'];

export function mapMiraklOrderToIncomingOrder(order: MiraklOrder): IncomingOrder {
  const orderId = order.order_id ?? '';
  const state = order.order_state;
  const fields = order.order_additional_fields ?? [];
  const taxTreatment = mapTaxTreatment(order.order_tax_mode);
  const cod = isCashOnDelivery(order.shipping_type_code);
  const lines = selectActiveLines(order.order_lines ?? []);
  const totals = mapTotals(order, lines, taxTreatment);
  const paymentStatus = derivePaymentStatus(order, cod);
  const codToCollect =
    paymentStatus === 'cod' ? toCodToCollect(totals.total, totals.currency) : undefined;
  const buyerTaxId = readSourceBuyerTaxId(
    readField(fields, MIRAKL_ORDER_FIELD.BuyerTaxId) ??
      order.customer?.organization?.tax_identification_number,
  );
  const shippingAddress = mapAddress(order.customer?.shipping_address);
  const billingAddress = mapAddress(order.customer?.billing_address);
  const createdAt = order.created_date ?? order.last_updated_date ?? '';
  const orderType = readField(fields, MIRAKL_ORDER_FIELD.OrderType);

  return {
    externalOrderId: orderId,
    orderNumber: orderId,
    status: mapStatus(state),
    ...(order.customer?.customer_id ? { customerExternalId: order.customer.customer_id } : {}),
    ...readCustomerEmail(order, fields),
    items: lines.map((line) => mapLine(line, taxTreatment)),
    totals,
    ...withTaxId(shippingAddress, billingAddress, buyerTaxId),
    ...optional('shipping', mapShipping(order)),
    ...optional('pickupPoint', mapPickupPoint(order, fields)),
    ...optional('dispatchTime', mapDispatchTime(order.shipping_deadline)),
    ...optional('paymentStatus', paymentStatus),
    paymentMethod: derivePaymentMethod(cod),
    ...optional('codToCollect', codToCollect),
    ...optional('placedAt', order.created_date),
    createdAt,
    updatedAt: order.last_updated_date ?? createdAt,
    metadata: {
      ...(state ? { orderState: state } : {}),
      ...(orderType ? { orderType } : {}),
    },
  };
}

function optional<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

function mapStatus(state: string | undefined): OrderStatus {
  switch (state) {
    case 'SHIPPING':
      return 'processing';
    case 'SHIPPED':
    case 'TO_COLLECT':
      return 'shipped';
    case 'RECEIVED':
    case 'CLOSED':
      return 'delivered';
    case 'REFUSED':
    case 'CANCELED':
      return 'cancelled';
    default:
      return 'pending';
  }
}

export function isCashOnDelivery(shippingTypeCode: string | undefined): boolean {
  return shippingTypeCode?.toUpperCase().endsWith(COD_SHIPPING_SUFFIX) ?? false;
}

function derivePaymentMethod(cod: boolean): PaymentMethod {
  return cod ? PAYMENT_METHOD.CashOnDelivery : PAYMENT_METHOD.Online;
}

/**
 * A cancelled order carries no payment signal; a cash-on-delivery order stays
 * `cod` (the courier collects), which keeps an automatic invoice from treating
 * it as already paid.
 */
function derivePaymentStatus(order: MiraklOrder, cod: boolean): PaymentStatus | undefined {
  if (order.fully_refunded) {
    return 'refunded';
  }
  const state = order.order_state;
  if (isCancelledOrderState(state)) {
    return undefined;
  }
  if (cod) {
    return 'cod';
  }
  if (state !== undefined && AWAITING_PAYMENT_STATES.includes(state)) {
    return 'awaiting';
  }
  if (state !== undefined && PAID_STATES.includes(state)) {
    return 'paid';
  }
  return undefined;
}

function mapTaxTreatment(orderTaxMode: string | undefined): PriceTaxTreatment {
  return orderTaxMode === 'TAX_EXCLUDED' ? 'exclusive' : 'inclusive';
}

/**
 * A refused or cancelled line is not part of the order any more. If every line
 * is, the order itself is cancelled and all lines are kept, so the cancelled
 * order still says what it was.
 */
function selectActiveLines(lines: readonly MiraklOrderLine[]): readonly MiraklOrderLine[] {
  const active = lines.filter((line) => !isCancelledOrderState(line.order_line_state));
  return active.length > 0 ? active : lines;
}

function mapLine(line: MiraklOrderLine, taxTreatment: PriceTaxTreatment): IncomingOrderItem {
  const quantity = line.quantity ?? 0;
  const unitPrice =
    line.price_unit ?? (line.price !== undefined && quantity > 0 ? line.price / quantity : 0);
  const taxRate = singleTaxRate(line.taxes);
  const imageUrl = line.product_medias?.find((media) => media.media_url)?.media_url;
  return {
    id: line.order_line_id ?? '',
    productRef: { type: 'offer', externalId: line.offer_sku ?? '' },
    quantity,
    price: unitPrice,
    ...(taxTreatment === 'inclusive' ? { unitPriceGross: unitPrice } : {}),
    ...optional('sku', line.offer_sku),
    ...optional('name', line.product_title),
    ...optional('imageUrl', imageUrl),
    ...(taxRate ? { taxRate, taxRateCountry: 'PL' } : {}),
  };
}

/**
 * The line's VAT rate as a percent string (`23`, `8`, `5.5`), only when the
 * line carries exactly one rate. Several rates, or none, leave the rate
 * unknown rather than picking one.
 */
export function singleTaxRate(taxes: readonly MiraklTax[] | undefined): string | undefined {
  const rates = new Set(
    (taxes ?? [])
      .map((tax) => tax.rate)
      .filter((rate): rate is number => typeof rate === 'number' && Number.isFinite(rate))
      .map((rate) => String(Math.round(rate * 100) / 100)),
  );
  return rates.size === 1 ? [...rates][0] : undefined;
}

function mapTotals(
  order: MiraklOrder,
  lines: readonly MiraklOrderLine[],
  taxTreatment: PriceTaxTreatment,
): IncomingOrderTotals {
  const shipping = round2(order.shipping_price ?? sum(lines.map((line) => line.shipping_price)));
  const productTotal = order.price ?? sum(lines.map((line) => line.price));
  const orderTotal = round2(order.total_price ?? productTotal + shipping);
  const currency = order.currency_iso_code ?? 'PLN';
  const shippingRate = commonShippingTaxRate(lines);

  if (taxTreatment === 'exclusive') {
    // Mirakl's `price` and `total_price` are net under TAX_EXCLUDED; the buyer
    // paid them plus the stated taxes, so `total` is that gross sum and the
    // components still add up to it.
    const tax = round2(
      sum(
        lines
          .flatMap((line) => [...(line.taxes ?? []), ...(line.shipping_taxes ?? [])])
          .map((entry) => entry.amount),
      ),
    );
    return {
      subtotal: round2(Math.max(0, orderTotal - shipping)),
      tax,
      shipping,
      total: round2(orderTotal + tax),
      currency,
      taxTreatment,
      totalTaxTreatment: 'inclusive',
      ...optional('shippingTaxRate', shippingRate),
    };
  }

  return {
    subtotal: round2(Math.max(0, orderTotal - shipping)),
    tax: 0,
    shipping,
    total: orderTotal,
    currency,
    taxTreatment,
    shippingGross: shipping,
    ...optional('shippingTaxRate', shippingRate),
  };
}

/** The delivery rate, only when every line that charges shipping states the same one. */
function commonShippingTaxRate(lines: readonly MiraklOrderLine[]): string | undefined {
  const rates = new Set<string>();
  for (const line of lines) {
    if ((line.shipping_taxes ?? []).length === 0) {
      continue;
    }
    const rate = singleTaxRate(line.shipping_taxes);
    if (rate === undefined) {
      return undefined;
    }
    rates.add(rate);
  }
  return rates.size === 1 ? [...rates][0] : undefined;
}

function mapAddress(address: MiraklAddress | undefined): IncomingOrderAddress | undefined {
  if (!address || (!address.street_1 && !address.city)) {
    return undefined;
  }
  return {
    ...optional('firstName', address.firstname),
    ...optional('lastName', address.lastname),
    ...optional('company', address.company),
    address1: address.street_1 ?? '',
    ...optional('address2', address.street_2),
    city: address.city ?? '',
    ...optional('state', address.state),
    postalCode: address.zip_code ?? '',
    country: toAlpha2Country(address.country_iso_code) ?? address.country ?? '',
    ...optional('phone', address.phone ?? address.phone_secondary),
  };
}

/**
 * The tax number belongs on the billing address; an order with no billing
 * address carries it on the shipping address, where `readBuyerTaxId` looks
 * next.
 */
function withTaxId(
  shippingAddress: IncomingOrderAddress | undefined,
  billingAddress: IncomingOrderAddress | undefined,
  taxId: string | null | undefined,
): Pick<IncomingOrder, 'shippingAddress' | 'billingAddress'> {
  if (taxId === undefined) {
    return {
      ...optional('shippingAddress', shippingAddress),
      ...optional('billingAddress', billingAddress),
    };
  }
  if (billingAddress) {
    return {
      ...optional('shippingAddress', shippingAddress),
      billingAddress: { ...billingAddress, taxId },
    };
  }
  return shippingAddress ? { shippingAddress: { ...shippingAddress, taxId } } : {};
}

function readCustomerEmail(
  order: MiraklOrder,
  fields: readonly MiraklAdditionalField[],
): Pick<IncomingOrder, 'customerEmail'> {
  const email = readField(fields, MIRAKL_ORDER_FIELD.CustomerEmail) ?? order.customer_notification_email;
  return email ? { customerEmail: email } : {};
}

function mapShipping(order: MiraklOrder): OrderShipping | undefined {
  if (!order.shipping_type_code) {
    return undefined;
  }
  return {
    methodId: order.shipping_type_code,
    ...optional('methodName', order.shipping_type_label),
  };
}

function mapPickupPoint(
  order: MiraklOrder,
  fields: readonly MiraklAdditionalField[],
): OrderPickupPoint | undefined {
  const name = readField(fields, MIRAKL_ORDER_FIELD.DeliveryPointName);
  const id = order.shipping_pudo_id?.trim() || name;
  if (!id) {
    return undefined;
  }
  const isLocker = order.shipping_type_code?.toUpperCase().startsWith(LOCKER_SHIPPING_PREFIX);
  return {
    id,
    ...optional('name', name),
    ...(isLocker ? { pointType: 'apm' as const } : {}),
  };
}

function mapDispatchTime(shippingDeadline: string | undefined): OrderDispatchWindow | undefined {
  return shippingDeadline ? { to: shippingDeadline } : undefined;
}

/** An additional field's value as trimmed text; blank or absent is undefined. */
export function readField(
  fields: readonly MiraklAdditionalField[],
  code: string,
): string | undefined {
  const value = fields.find((field) => field.code === code)?.value;
  if (typeof value === 'string') {
    return value.trim() || undefined;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}

function sum(values: ReadonlyArray<number | undefined>): number {
  return values.reduce<number>((acc, value) => acc + (value ?? 0), 0);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
