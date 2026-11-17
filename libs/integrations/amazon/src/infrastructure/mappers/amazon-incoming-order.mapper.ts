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
 *   - **Prices are what the buyer paid**: the line price is the item's unit
 *     price, the total Amazon's `grandTotal`. The total is stated as tax
 *     inclusive; the line treatment is NOT asserted, because the model does not
 *     say whether `unitPrice` carries tax in every marketplace. No tax rate is
 *     read: Amazon reports tax amounts, never a rate, and OpenLinker never
 *     derives one (ADR-063).
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

import type { AmazonCustomerAddress, AmazonMoney, AmazonOrder } from '../../domain/types/amazon-order.types';

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

  const items = order.orderItems.map((item): IncomingOrderItem => {
    const unitPrice = toNumber(item.product.price?.unitPrice);
    return {
      id: item.orderItemId,
      productRef: item.product.sellerSku
        ? { type: 'sku', externalId: item.product.sellerSku }
        : { type: 'offer', externalId: item.product.asin ?? item.orderItemId },
      quantity: item.quantityOrdered,
      price: unitPrice,
      unitPriceGross: unitPrice,
      ...(item.product.sellerSku ? { sku: item.product.sellerSku } : {}),
      ...(item.product.title ? { name: item.product.title } : {}),
    };
  });

  const itemsTotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const breakdown = (type: string): number =>
    (order.proceeds?.breakdowns ?? [])
      .filter((entry) => entry.type === type)
      .reduce((sum, entry) => sum + toNumber(entry.subtotal), 0);
  const shipping = breakdown('SHIPPING');
  const tax = breakdown('TAX');
  const grandTotal = order.proceeds?.grandTotal ? toNumber(order.proceeds.grandTotal) : itemsTotal + shipping;
  const codToCollect = paymentMethod === 'cash_on_delivery' ? toCodToCollect(grandTotal, currency) : undefined;

  return {
    externalOrderId: order.orderId,
    orderNumber: order.orderId,
    status: toOrderStatus(fulfillmentStatus, order),
    ...(order.buyer?.buyerEmail ? { customerEmail: order.buyer.buyerEmail } : {}),
    items,
    totals: {
      subtotal: itemsTotal,
      tax,
      shipping,
      total: grandTotal,
      currency,
      totalTaxTreatment: 'inclusive',
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
