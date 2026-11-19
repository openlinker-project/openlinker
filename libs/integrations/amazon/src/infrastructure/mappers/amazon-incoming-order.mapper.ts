/**
 * Amazon Incoming Order Mapper
 *
 * Maps an Orders API v2026-01-01 `Order` onto the neutral `IncomingOrder`.
 * Pure: no I/O, no clock.
 *
 * Rules worth knowing:
 *   - **Lines are keyed by seller SKU** (`productRef: sku`), which is what an
 *     FBM seller shares with their master catalogue. A line without a SKU
 *     falls back to the ASIN as an offer reference.
 *   - **Money comes from the item proceeds.** Amazon reports `ITEM`,
 *     `SHIPPING`, `TAX`, `DISCOUNT` and the smaller charges per order item
 *     (`orderItems[].proceeds.breakdowns`); the order-level breakdowns, when
 *     present, are only their aggregate. Each line is what the buyer paid for
 *     it after discounts. `GIFT_WRAP`, `COD_FEE`, `OTHER` and `DELIVERY_TIP`
 *     are carried in `shipping`, so lines plus shipping add up to the total.
 *   - **Whether prices include tax is read from the numbers, never assumed.**
 *     In European marketplaces the `ITEM` amount already contains VAT and
 *     `TAX` is the part of it that is tax; in the US, Canada and other
 *     sales-tax marketplaces `TAX` is added on top. When lines plus shipping
 *     plus tax equal `grandTotal` the prices are net (`exclusive`), and the
 *     gross unit price and gross shipping are reported beside them; when lines
 *     plus shipping alone equal it they are gross (`inclusive`). With no tax,
 *     or amounts that agree with neither, nothing is asserted. The total is
 *     always what the buyer paid, so `totalTaxTreatment` is `inclusive`.
 *   - **No tax rate is read**: Amazon reports tax amounts, never a rate, and
 *     OpenLinker never derives one (ADR-063).
 *   - **The shipping address is absent without the Direct-to-Consumer Shipping
 *     role**, and `metadata.amazonShippingAddressWithheld` says so; nothing is
 *     guessed.
 *   - **An order Amazon ships itself (`fulfilledBy: AMAZON`, FBA)** is
 *     `fulfilledBySource`, so routing never sends it to the pack bench (#3636).
 *   - **Cash on delivery** is the `CashOnDelivery` payment method; everything
 *     else is an online payment, paid unless Amazon still holds the order as
 *     `PENDING` (payment not yet authorized).
 *
 * @module libs/integrations/amazon/src/infrastructure/mappers
 */
import {
  readSourceBuyerTaxId,
  toCodToCollect,
  type IncomingOrder,
  type IncomingOrderAddress,
  type IncomingOrderItem,
  type OrderStatus,
  type PaymentMethod,
  type PaymentStatus,
} from '@openlinker/core/orders';

import type {
  AmazonCustomerAddress,
  AmazonMoney,
  AmazonOrder,
  AmazonOrderItem,
  AmazonProceedsBreakdown,
} from '../../domain/types/amazon-order.types';

const COD_PAYMENT_METHOD = 'CashOnDelivery';

export function mapAmazonOrderToIncomingOrder(order: AmazonOrder): IncomingOrder {
  const currency = findCurrency(order);
  const fulfillmentStatus = order.fulfillment?.fulfillmentStatus;
  const paymentMethod = readPaymentMethod(order);
  const shippingAddress = order.recipient?.deliveryAddress
    ? toAddress(order.recipient.deliveryAddress)
    : undefined;
  const taxId = readSourceBuyerTaxId(order.tax?.taxRegistrations?.[0]?.taxRegistrationNumber);
  const billingSource = order.tax?.taxRegistrations?.[0]?.taxRegistrationAddress;
  const billingAddress = billingSource ? toAddress(billingSource) : undefined;

  const money = readOrderMoney(order);
  const items = order.orderItems.map((item, index): IncomingOrderItem => {
    const line = money.lines[index];
    const quantity = item.quantityOrdered;
    const price = unitPrice(money.taxTreatment === 'exclusive' ? line.net : line.amount, quantity);
    return {
      id: item.orderItemId,
      productRef: item.product.sellerSku
        ? { type: 'sku', externalId: item.product.sellerSku }
        : { type: 'offer', externalId: item.product.asin ?? item.orderItemId },
      quantity,
      price,
      unitPriceGross: unitPrice(line.gross, quantity),
      ...(item.product.sellerSku ? { sku: item.product.sellerSku } : {}),
      ...(item.product.title ? { name: item.product.title } : {}),
    };
  });

  const grandTotal = money.grandTotal;
  const codToCollect = paymentMethod === 'cash_on_delivery' ? toCodToCollect(grandTotal, currency) : undefined;

  return {
    externalOrderId: order.orderId,
    orderNumber: order.orderId,
    status: toOrderStatus(fulfillmentStatus, order),
    ...(order.buyer?.buyerEmail ? { customerEmail: order.buyer.buyerEmail } : {}),
    items,
    totals: {
      subtotal: money.subtotal,
      tax: money.tax,
      shipping: money.shipping,
      total: grandTotal,
      currency,
      ...(money.taxTreatment ? { taxTreatment: money.taxTreatment } : {}),
      totalTaxTreatment: 'inclusive',
      ...(money.taxTreatment === 'exclusive' ? { shippingGross: money.shippingGross } : {}),
    },
    ...(shippingAddress ? { shippingAddress: { ...shippingAddress, ...(taxId ? { taxId } : {}) } } : {}),
    ...(billingAddress ? { billingAddress: { ...billingAddress, ...(taxId ? { taxId } : {}) } } : {}),
    ...(order.fulfillment?.fulfillmentServiceLevel
      ? {
          shipping: {
            methodId: order.fulfillment.fulfillmentServiceLevel,
            methodName: order.fulfillment.fulfillmentServiceLevel,
          },
        }
      : {}),
    ...(order.fulfillment?.fulfilledBy === 'AMAZON' ? { fulfilledBySource: true as const } : {}),
    paymentStatus: toPaymentStatus(fulfillmentStatus, paymentMethod),
    paymentMethod,
    ...(order.payment?.paymentExecutions?.[0]?.paymentMethod
      ? { sourcePaymentMethod: order.payment.paymentExecutions[0].paymentMethod }
      : {}),
    ...(codToCollect ? { codToCollect } : {}),
    ...(order.fulfillment?.shipByWindow
      ? {
          dispatchTime: {
            ...(order.fulfillment.shipByWindow.earliestDateTime ? { from: order.fulfillment.shipByWindow.earliestDateTime } : {}),
            ...(order.fulfillment.shipByWindow.latestDateTime ? { to: order.fulfillment.shipByWindow.latestDateTime } : {}),
          },
        }
      : {}),
    placedAt: order.createdTime,
    createdAt: order.createdTime,
    updatedAt: order.lastUpdatedTime,
    metadata: {
      amazonMarketplaceId: order.salesChannel.marketplaceId ?? null,
      amazonSalesChannel: order.salesChannel.channelName,
      amazonFulfillmentStatus: fulfillmentStatus ?? null,
      amazonShippingAddressWithheld: shippingAddress === undefined,
      amazonDeliverBy: order.fulfillment?.deliverByWindow?.latestDateTime ?? null,
    },
  };
}

/** What the buyer paid for one order item, after its discounts (#4184). */
export interface AmazonItemPayment {
  readonly orderItemId: string;
  readonly sku: string | null;
  readonly quantity: number;
  /** Paid for all units, tax included. */
  readonly gross: number;
  /** The tax part of `gross`; 0 when Amazon reported none or the treatment is unknown. */
  readonly tax: number;
}

/**
 * The order's item payments read the same way the order lines are, so a
 * refund is bounded by what the order says the buyer paid. `taxTreatment` is
 * `exclusive` where tax is added on top of the item price (US, Canada).
 */
export function readAmazonItemPayments(order: AmazonOrder): {
  readonly currency: string;
  readonly taxTreatment: 'inclusive' | 'exclusive' | undefined;
  readonly items: readonly AmazonItemPayment[];
} {
  const money = readOrderMoney(order);
  return {
    currency: findCurrency(order),
    taxTreatment: money.taxTreatment,
    items: order.orderItems.map((item, index) => {
      const line = money.lines[index];
      return {
        orderItemId: item.orderItemId,
        sku: item.product.sellerSku ?? null,
        quantity: item.quantityOrdered,
        gross: round2(line.gross),
        tax: money.taxTreatment === undefined ? 0 : round2(line.gross - line.net),
      };
    }),
  };
}

/** One line's money: `amount` as Amazon states it, `net` without tax, `gross` with it. */
interface LineMoney {
  readonly amount: number;
  readonly net: number;
  readonly gross: number;
}

interface OrderMoney {
  readonly lines: readonly LineMoney[];
  readonly subtotal: number;
  readonly shipping: number;
  readonly shippingGross: number;
  readonly tax: number;
  readonly grandTotal: number;
  readonly taxTreatment: 'inclusive' | 'exclusive' | undefined;
}

/** Charges that are neither the item nor tax, carried with shipping. */
const SHIPPING_LIKE_TYPES = ['SHIPPING', 'GIFT_WRAP', 'COD_FEE', 'OTHER', 'DELIVERY_TIP'] as const;
const TOLERANCE = 0.005;

function readOrderMoney(order: AmazonOrder): OrderMoney {
  const itemLevel = order.orderItems.some((item) => (item.proceeds?.breakdowns ?? []).length > 0);
  const parts = itemLevel || (order.proceeds?.breakdowns ?? []).length === 0
    ? order.orderItems.map(readItemMoney)
    : allocateOrderLevel(order);
  // A delivery tip is charged on the order, never on an item.
  const orderLevelOnly = itemLevel ? sumOf(order.proceeds?.breakdowns, 'DELIVERY_TIP') : 0;

  const itemsAmount = parts.reduce((sum, part) => sum + part.itemAmount, 0);
  const itemsTax = parts.reduce((sum, part) => sum + part.itemTax, 0);
  const shippingAmount = parts.reduce((sum, part) => sum + part.shippingAmount, 0) + orderLevelOnly;
  const shippingTax = parts.reduce((sum, part) => sum + part.shippingTax, 0);
  const tax = itemsTax + shippingTax;
  const grandTotal = order.proceeds?.grandTotal
    ? toNumber(order.proceeds.grandTotal)
    : round2(itemsAmount + shippingAmount);

  let taxTreatment: OrderMoney['taxTreatment'];
  if (tax > 0 && closeTo(grandTotal, itemsAmount + shippingAmount + tax)) {
    taxTreatment = 'exclusive';
  } else if (tax > 0 && closeTo(grandTotal, itemsAmount + shippingAmount)) {
    taxTreatment = 'inclusive';
  }

  const lines = parts.map((part): LineMoney => {
    if (taxTreatment === 'exclusive') {
      return { amount: part.itemAmount, net: part.itemAmount, gross: part.itemAmount + part.itemTax };
    }
    if (taxTreatment === 'inclusive') {
      return { amount: part.itemAmount, net: part.itemAmount - part.itemTax, gross: part.itemAmount };
    }
    return { amount: part.itemAmount, net: part.itemAmount, gross: part.itemAmount };
  });

  return {
    lines,
    subtotal: round2(itemsAmount),
    shipping: round2(shippingAmount),
    shippingGross: round2(taxTreatment === 'exclusive' ? shippingAmount + shippingTax : shippingAmount),
    tax: round2(tax),
    grandTotal,
    taxTreatment,
  };
}

/**
 * One item's amounts after its discounts. Tax and discounts go to the charge
 * their detailed breakdown names; without one they belong to the item.
 */
function readItemMoney(item: AmazonOrderItem): {
  itemAmount: number;
  itemTax: number;
  shippingAmount: number;
  shippingTax: number;
} {
  const breakdowns = item.proceeds?.breakdowns;
  const hasItem = (breakdowns ?? []).some((entry) => entry.type === 'ITEM');
  const itemCharge = hasItem
    ? sumOf(breakdowns, 'ITEM')
    : toNumber(item.product.price?.unitPrice) * item.quantityOrdered;
  const shippingCharges = SHIPPING_LIKE_TYPES.reduce((sum, type) => sum + sumOf(breakdowns, type), 0);
  const discount = splitBySubtype(breakdowns, 'DISCOUNT');
  const tax = splitBySubtype(breakdowns, 'TAX');
  return {
    itemAmount: itemCharge - Math.abs(discount.item),
    itemTax: Math.abs(tax.item),
    shippingAmount: shippingCharges - Math.abs(discount.other),
    shippingTax: Math.abs(tax.other),
  };
}

type ItemMoney = ReturnType<typeof readItemMoney>;

/**
 * Item amounts when Amazon reported the breakdown on the order only: each line
 * is its unit price times quantity, and the order's item discount and item tax
 * are split over the lines by their share of the item value (a division, never
 * a rate). Shipping and its tax sit on the first line; only their sums matter.
 */
function allocateOrderLevel(order: AmazonOrder): ItemMoney[] {
  const breakdowns = order.proceeds?.breakdowns;
  const charges = order.orderItems.map((item) => toNumber(item.product.price?.unitPrice) * item.quantityOrdered);
  const value = charges.reduce((sum, charge) => sum + charge, 0);
  const discount = splitBySubtype(breakdowns, 'DISCOUNT');
  const tax = splitBySubtype(breakdowns, 'TAX');
  const shippingCharges = SHIPPING_LIKE_TYPES.reduce((sum, type) => sum + sumOf(breakdowns, type), 0);
  return charges.map((charge, index) => {
    const share = value > 0 ? charge / value : index === 0 ? 1 : 0;
    return {
      itemAmount: charge - Math.abs(discount.item) * share,
      itemTax: Math.abs(tax.item) * share,
      shippingAmount: index === 0 ? shippingCharges - Math.abs(discount.other) : 0,
      shippingTax: index === 0 ? Math.abs(tax.other) : 0,
    };
  });
}

function splitBySubtype(
  breakdowns: readonly AmazonProceedsBreakdown[] | undefined,
  type: string,
): { item: number; other: number } {
  let item = 0;
  let other = 0;
  for (const entry of breakdowns ?? []) {
    if (entry.type !== type) continue;
    const details = entry.detailedBreakdowns ?? [];
    if (details.length === 0) {
      item += toNumber(entry.subtotal);
      continue;
    }
    for (const detail of details) {
      if (detail.subtype === undefined || detail.subtype === 'ITEM') item += toNumber(detail.value);
      else other += toNumber(detail.value);
    }
  }
  return { item, other };
}

function sumOf(breakdowns: readonly AmazonProceedsBreakdown[] | undefined, type: string): number {
  return (breakdowns ?? []).filter((entry) => entry.type === type).reduce((sum, entry) => sum + toNumber(entry.subtotal), 0);
}

function unitPrice(lineAmount: number, quantity: number): number {
  return quantity > 0 ? Math.round((lineAmount / quantity) * 10000) / 10000 : round2(lineAmount);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function closeTo(a: number, b: number): boolean {
  return Math.abs(a - b) < TOLERANCE;
}

function toOrderStatus(status: string | undefined, order: AmazonOrder): OrderStatus {
  switch (status) {
    case 'CANCELLED':
      return 'cancelled';
    case 'SHIPPED': {
      const packages = order.packages ?? [];
      const allDelivered =
        packages.length > 0 && packages.every((pkg) => pkg.packageStatus?.status === 'DELIVERED');
      return allDelivered ? 'delivered' : 'shipped';
    }
    case 'UNSHIPPED':
    case 'PARTIALLY_SHIPPED':
    case 'UNFULFILLABLE':
      return 'processing';
    default:
      return 'pending';
  }
}

function readPaymentMethod(order: AmazonOrder): PaymentMethod {
  const methods = (order.payment?.paymentExecutions ?? []).map((execution) => execution.paymentMethod);
  if (methods.includes(COD_PAYMENT_METHOD)) {
    return 'cash_on_delivery';
  }
  return 'online';
}

function toPaymentStatus(status: string | undefined, method: PaymentMethod): PaymentStatus {
  if (method === 'cash_on_delivery') {
    return 'cod';
  }
  if (status === 'PENDING' || status === 'PENDING_AVAILABILITY') {
    return 'awaiting';
  }
  return 'paid';
}

function toAddress(source: AmazonCustomerAddress): IncomingOrderAddress {
  const { firstName, lastName } = splitName(source.name);
  const address2 = [source.addressLine2, source.addressLine3].filter((part) => part && part.length > 0).join(', ');
  return {
    ...(firstName ? { firstName } : {}),
    ...(lastName ? { lastName } : {}),
    ...(source.companyName ? { company: source.companyName } : {}),
    address1: source.addressLine1 ?? '',
    ...(address2.length > 0 ? { address2 } : {}),
    city: source.city ?? '',
    ...(source.stateOrRegion ? { state: source.stateOrRegion } : {}),
    postalCode: source.postalCode ?? '',
    country: source.countryCode ?? '',
    ...(source.phone ? { phone: source.phone } : {}),
  };
}

/** Amazon sends one `name`; the last word is taken as the last name. */
function splitName(name: string | undefined): { firstName?: string; lastName?: string } {
  const trimmed = name?.trim() ?? '';
  if (trimmed.length === 0) {
    return {};
  }
  const cut = trimmed.lastIndexOf(' ');
  return cut === -1
    ? { lastName: trimmed }
    : { firstName: trimmed.slice(0, cut).trim(), lastName: trimmed.slice(cut + 1) };
}

function findCurrency(order: AmazonOrder): string {
  return (
    order.proceeds?.grandTotal?.currencyCode ??
    order.orderItems.find((item) => item.product.price?.unitPrice)?.product.price?.unitPrice?.currencyCode ??
    ''
  );
}

function toNumber(money: AmazonMoney | undefined): number {
  if (money === undefined) {
    return 0;
  }
  const value = Number(money.amount);
  return Number.isFinite(value) ? value : 0;
}
