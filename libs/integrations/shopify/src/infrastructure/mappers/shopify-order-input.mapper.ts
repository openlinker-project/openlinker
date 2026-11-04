/**
 * Shopify Order Input Mapper
 *
 * The neutral `OrderCreate` -> `orderCreate`'s `OrderCreateOrderInput`.
 *
 * Price (ADR-014): every line carries the price the BUYER paid on the source
 * (`priceSet`), never the shop's catalogue price - an imported order must
 * charge what was charged. When the source states its prices gross, the order
 * is created `taxesIncluded: true` with the gross unit price; otherwise net.
 *
 * Tax: a line whose rate the order states gets a tax line with that rate and
 * the tax contained in the line, computed here because Shopify requires an
 * amount and rounding belongs to the adapter (ADR-063 § 5). A line without a
 * stated rate gets no tax line rather than a guessed one.
 *
 * Payment: a paid order gets a successful `manual` sale transaction, a COD
 * order a PENDING transaction on Shopify's `Cash on Delivery (COD)` gateway
 * (accepted live, L-O2), anything else none and `PENDING`.
 *
 * @module libs/integrations/shopify/src/infrastructure/mappers
 */
import type { Address, OrderCreate, OrderItem } from '@openlinker/core/orders';
import { PAYMENT_METHOD, PAYMENT_STATUS } from '@openlinker/core/orders';

import { SHOPIFY_COD_GATEWAY } from '../../shopify.constants';

/** A line with the Shopify variant it resolved to, or null for a custom line. */
export interface ShopifyResolvedLine {
  readonly item: OrderItem;
  readonly variantGid: string | null;
}

// A type alias, not an interface: only a type literal is assignable to the
// client's `Record<string, unknown>` variables parameter.
export type ShopifyOrderCreateVariables = {
  readonly order: Record<string, unknown>;
  readonly options: Record<string, unknown>;
};

const NUMERIC_RATE = /^\d+(\.\d+)?$/;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function money(value: number, currencyCode: string): { shopMoney: { amount: string; currencyCode: string } } {
  return { shopMoney: { amount: round2(value).toFixed(2), currencyCode } };
}

function taxLines(
  rateCode: string | undefined,
  lineTotal: number,
  taxesIncluded: boolean,
  currencyCode: string,
): Array<Record<string, unknown>> {
  if (rateCode === undefined || !NUMERIC_RATE.test(rateCode)) {
    return [];
  }
  const percent = Number(rateCode);
  const rate = percent / 100;
  const tax = taxesIncluded ? lineTotal - lineTotal / (1 + rate) : lineTotal * rate;
  return [{ title: `VAT ${rateCode}%`, rate: rate.toFixed(4), priceSet: money(tax, currencyCode) }];
}

function mailingAddress(address: Address | undefined): Record<string, string> | undefined {
  if (address === undefined) {
    return undefined;
  }
  const entries: Array<[string, string | undefined]> = [
    ['firstName', address.firstName],
    ['lastName', address.lastName],
    ['company', address.company],
    ['address1', address.address1],
    ['address2', address.address2],
    ['city', address.city],
    ['zip', address.postalCode],
    ['countryCode', address.country?.toUpperCase()],
    ['phone', address.phone],
  ];
  return Object.fromEntries(
    entries.filter((e): e is [string, string] => typeof e[1] === 'string' && e[1].trim().length > 0),
  );
}

export function buildShopifyOrderCreateVariables(
  order: OrderCreate,
  lines: readonly ShopifyResolvedLine[],
  sourceIdentifier: string | undefined,
): ShopifyOrderCreateVariables {
  const currencyCode = order.totals.currency;
  const taxesIncluded = order.totals.taxTreatment !== 'exclusive';

  const lineItems = lines.map(({ item, variantGid }) => {
    const unit = taxesIncluded ? (item.unitPriceGross ?? item.price) : item.price;
    const identity =
      variantGid === null
        ? { title: item.name ?? item.sku ?? `Item ${item.id}`, ...(item.sku ? { sku: item.sku } : {}) }
        : { variantId: variantGid };
    const tax = taxLines(item.taxRate, unit * item.quantity, taxesIncluded, currencyCode);
    return {
      ...identity,
      quantity: item.quantity,
      priceSet: money(unit, currencyCode),
      ...(tax.length === 0 ? {} : { taxLines: tax }),
    };
  });

  const shippingAmount = taxesIncluded
    ? (order.totals.shippingGross ?? order.totals.shipping)
    : order.totals.shipping;
  const shippingTax = taxLines(order.totals.shippingTaxRate, shippingAmount, taxesIncluded, currencyCode);
  const shippingLines =
    order.shipping === undefined && !(shippingAmount > 0)
      ? []
      : [
          {
            title: order.shipping?.methodName ?? order.shipping?.methodId ?? 'Shipping',
            ...(order.shipping?.methodId ? { code: order.shipping.methodId } : {}),
            priceSet: money(shippingAmount, currencyCode),
            ...(shippingTax.length === 0 ? {} : { taxLines: shippingTax }),
          },
        ];

  const isCod =
    order.paymentStatus === PAYMENT_STATUS.Cod || order.paymentMethod === PAYMENT_METHOD.CashOnDelivery;
  const isPaid = order.paymentStatus === PAYMENT_STATUS.Paid;
  const transactions = isPaid
    ? [{ kind: 'SALE', status: 'SUCCESS', gateway: 'manual', amountSet: money(order.totals.total, currencyCode) }]
    : isCod
      ? [{ kind: 'SALE', status: 'PENDING', gateway: SHOPIFY_COD_GATEWAY, amountSet: money(order.totals.total, currencyCode) }]
      : [];

  const buyerEmail = order.metadata?.buyerEmail;
  const shippingAddress = mailingAddress(order.shippingAddress);
  const billingAddress = mailingAddress(order.billingAddress);
  const phone = order.shippingAddress?.phone ?? order.billingAddress?.phone;

  return {
    order: {
      lineItems,
      ...(shippingLines.length === 0 ? {} : { shippingLines }),
      ...(shippingAddress === undefined ? {} : { shippingAddress }),
      ...(billingAddress === undefined ? {} : { billingAddress }),
      ...(typeof buyerEmail === 'string' && buyerEmail.length > 0 ? { email: buyerEmail } : {}),
      ...(phone ? { phone } : {}),
      currency: currencyCode,
      taxesIncluded,
      financialStatus: isPaid ? 'PAID' : 'PENDING',
      ...(transactions.length === 0 ? {} : { transactions }),
      // Shopify does not deduplicate on it (L-O4), but it is what a crash
      // between create and mapping write is recovered by.
      ...(sourceIdentifier === undefined ? {} : { sourceIdentifier }),
      tags: ['openlinker'],
      ...(order.orderNumber ? { note: `OpenLinker order ${order.orderNumber}` } : {}),
    },
    options: {
      // Commits stock at a location Shopify's routing picks (L-O1); the
      // adapter moves the fulfillment order to the configured location after.
      inventoryBehaviour: 'DECREMENT_OBEYING_POLICY',
      sendReceipt: false,
      sendFulfillmentReceipt: false,
    },
  };
}
