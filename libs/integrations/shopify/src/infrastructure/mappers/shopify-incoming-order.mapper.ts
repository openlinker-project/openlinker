/**
 * Shopify Incoming Order Mapper
 *
 * Shopify `Order` -> the neutral `IncomingOrder`, following the field
 * conventions the Shoper and Allegro sources set.
 *
 * Money: amounts are the SHOP-currency figures (`shopMoney`), which is the
 * currency every other OpenLinker figure for this connection is in. Line
 * prices are what the buyer paid per unit after EVERY discount, the order-level
 * and code-based ones included (`discountedUnitPriceAfterAllDiscountsSet`;
 * `discountedUnitPriceSet` leaves those out, so the lines would not add up to
 * the total). Shipping is `currentShippingPriceSet`, after discounts and
 * refunds, for the same reason. Both are gross when the order's
 * `taxesIncluded` is true. Shopify rounds the per-unit figure, so a line can
 * differ from the exact share by a cent - the tolerance the document mappers
 * already allow.
 *
 * Tax rate: read from the line's own `taxLines` (native on orders, L-T2 says
 * it is the ONLY place a rate exists in the Admin API) and reported as the
 * neutral percent-as-string code (`'23'`). A line with no tax line, or with
 * several distinct rates, reports none - a rate is never guessed (ADR-063).
 *
 * Buyer tax id: only a B2B order placed on a company location carries one
 * (`purchasingEntity: PurchasingCompany`, L-O5). Any other order reports it as
 * NOT ASSERTED (absent), never as "has none" (`null`): a Shopify order has no
 * other home for a tax id, so silence is not a statement.
 *
 * Payment method: Shopify exposes gateway NAMES, not a closed vocabulary, so
 * only the built-in manual methods are recognised (`Cash on Delivery (COD)`,
 * `Bank Deposit`); everything else, `manual` included, is `unknown` (#3294).
 *
 * @module libs/integrations/shopify/src/infrastructure/mappers
 */
import type {
  IncomingOrder,
  IncomingOrderAddress,
  IncomingOrderItem,
  IncomingOrderItemRef,
  PaymentMethod,
  PaymentStatus,
} from '@openlinker/core/orders';
import {
  PAYMENT_METHOD,
  PAYMENT_STATUS,
  readSourceBuyerTaxId,
  toCodToCollect,
} from '@openlinker/core/orders';

import { SHOPIFY_BANK_DEPOSIT_GATEWAY, SHOPIFY_COD_GATEWAY } from '../../shopify.constants';
import { fromShopifyGid } from '../../domain/policies/shopify-gid.policy';
import type {
  ShopifyLineItem,
  ShopifyMailingAddress,
  ShopifyOrder,
  ShopifyTaxLine,
} from '../../domain/types/shopify-api.types';
import { parseShopifyAmount } from './shopify-product.mapper';

function nonEmpty(raw: string | null | undefined): string | undefined {
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : undefined;
}

function amount(raw: string | undefined): number {
  return parseShopifyAmount(raw) ?? 0;
}

/** `23` -> `'23'`, `8.5` -> `'8.5'`; null when no single rate can be stated. */
export function shopifyTaxRateCode(taxLines: readonly ShopifyTaxLine[]): string | null {
  const rates = [
    ...new Set(
      taxLines
        .map((t) => (t.ratePercentage ?? (t.rate === null ? null : t.rate * 100)))
        .filter((r): r is number => r !== null && Number.isFinite(r))
        .map((r) => Math.round(r * 100) / 100),
    ),
  ];
  return rates.length === 1 ? String(rates[0]) : null;
}

export function mapShopifyOrderStatus(order: ShopifyOrder): string {
  if (order.cancelledAt !== null) {
    return 'cancelled';
  }
  if (order.displayFinancialStatus === 'REFUNDED') {
    return 'refunded';
  }
  if (order.displayFulfillmentStatus === 'FULFILLED') {
    return 'shipped';
  }
  if (order.displayFinancialStatus === 'PAID' || order.displayFulfillmentStatus === 'PARTIALLY_FULFILLED') {
    return 'processing';
  }
  return 'pending';
}

function isCod(order: ShopifyOrder): boolean {
  return order.paymentGatewayNames.includes(SHOPIFY_COD_GATEWAY);
}

export function mapShopifyPaymentMethod(order: ShopifyOrder): PaymentMethod {
  if (isCod(order)) {
    return PAYMENT_METHOD.CashOnDelivery;
  }
  if (order.paymentGatewayNames.includes(SHOPIFY_BANK_DEPOSIT_GATEWAY)) {
    return PAYMENT_METHOD.BankTransfer;
  }
  return PAYMENT_METHOD.Unknown;
}

export function mapShopifyPaymentStatus(order: ShopifyOrder): PaymentStatus | undefined {
  switch (order.displayFinancialStatus) {
    case 'PAID':
    case 'PARTIALLY_REFUNDED':
      return PAYMENT_STATUS.Paid;
    case 'REFUNDED':
      return PAYMENT_STATUS.Refunded;
    case 'PENDING':
    case 'AUTHORIZED':
    case 'PARTIALLY_PAID':
      // A pending COD order is not "awaiting payment" - the courier collects it.
      return isCod(order) ? PAYMENT_STATUS.Cod : PAYMENT_STATUS.Awaiting;
    default:
      return undefined;
  }
}

function mapAddress(
  raw: ShopifyMailingAddress | null,
  taxId: string | undefined,
): IncomingOrderAddress | undefined {
  if (raw === null) {
    return undefined;
  }
  const address1 = nonEmpty(raw.address1);
  const city = nonEmpty(raw.city);
  if (address1 === undefined && city === undefined) {
    return undefined;
  }
  const optional = (key: keyof IncomingOrderAddress, value: string | null): Partial<IncomingOrderAddress> => {
    const text = nonEmpty(value);
    return text === undefined ? {} : { [key]: text };
  };
  return {
    address1: address1 ?? '',
    city: city ?? '',
    postalCode: nonEmpty(raw.zip) ?? '',
    country: nonEmpty(raw.countryCodeV2)?.toUpperCase() ?? '',
    ...optional('firstName', raw.firstName),
    ...optional('lastName', raw.lastName),
    ...optional('company', raw.company),
    ...optional('address2', raw.address2),
    ...optional('state', raw.provinceCode),
    ...optional('phone', raw.phone),
    ...(taxId === undefined ? {} : { taxId }),
  };
}

function lineRef(line: ShopifyLineItem): IncomingOrderItemRef {
  if (line.variant !== null) {
    return { type: 'variant', externalId: fromShopifyGid(line.variant.id) };
  }
  if (line.product !== null) {
    return { type: 'product', externalId: fromShopifyGid(line.product.id) };
  }
  const sku = nonEmpty(line.sku);
  return { type: 'sku', externalId: sku ?? fromShopifyGid(line.id) };
}

function mapLine(line: ShopifyLineItem, taxesIncluded: boolean): IncomingOrderItem {
  const unit = amount(line.discountedUnitPriceAfterAllDiscountsSet.shopMoney.amount);
  const taxRate = shopifyTaxRateCode(line.taxLines);
  const sku = nonEmpty(line.sku);
  const name = nonEmpty(line.name);
  return {
    id: fromShopifyGid(line.id),
    productRef: lineRef(line),
    // `currentQuantity` follows order edits; `quantity` stays the original count.
    quantity: line.currentQuantity,
    price: unit,
    ...(taxesIncluded ? { unitPriceGross: unit } : {}),
    ...(sku === undefined ? {} : { sku }),
    ...(name === undefined ? {} : { name }),
    ...(taxRate === null ? {} : { taxRate }),
  };
}

function buyerTaxId(order: ShopifyOrder): string | undefined {
  const entity = order.purchasingEntity;
  if (entity === null || entity.__typename !== 'PurchasingCompany') {
    return undefined;
  }
  const id = readSourceBuyerTaxId(entity.location?.taxSettings?.taxRegistrationId);
  return id === null ? undefined : id;
}

export interface ShopifyIncomingOrderContext {
  /** The admin URL of the order, built from the shop handle. */
  readonly adminOrderUrl: string;
}

export function mapShopifyOrderToIncoming(
  order: ShopifyOrder,
  ctx: ShopifyIncomingOrderContext,
): IncomingOrder {
  const currency = order.currentTotalPriceSet.shopMoney.currencyCode ?? order.currencyCode;
  const total = amount(order.currentTotalPriceSet.shopMoney.amount);
  const shipping = amount(order.currentShippingPriceSet.shopMoney.amount);
  const paymentStatus = mapShopifyPaymentStatus(order);
  const taxId = buyerTaxId(order);
  // The tax id belongs to the invoicing party; with no billing address it rides
  // on the shipping one so the fact is not lost.
  const billingAddress = mapAddress(order.billingAddress, taxId);
  const shippingAddress = mapAddress(order.shippingAddress, billingAddress === undefined ? taxId : undefined);
  const shippingLine = order.shippingLines.nodes[0];
  const shippingTaxRate = shippingLine === undefined ? null : shopifyTaxRateCode(shippingLine.taxLines);
  const email = nonEmpty(order.email);
  const codToCollect = isCod(order) ? toCodToCollect(total, currency) : undefined;
  const gateway = nonEmpty(order.paymentGatewayNames[0]);
  const placedAt = order.processedAt ?? order.createdAt;

  return {
    externalOrderId: fromShopifyGid(order.id),
    orderNumber: order.name.replace(/^#/, ''),
    externalUrl: ctx.adminOrderUrl,
    status: mapShopifyOrderStatus(order),
    ...(paymentStatus === undefined ? {} : { paymentStatus }),
    paymentMethod: mapShopifyPaymentMethod(order),
    ...(gateway === undefined ? {} : { sourcePaymentMethod: gateway }),
    ...(order.customer === null ? {} : { customerExternalId: fromShopifyGid(order.customer.id) }),
    ...(email === undefined ? {} : { customerEmail: email }),
    items: order.lineItems.nodes
      .filter((line) => line.currentQuantity > 0)
      .map((line) => mapLine(line, order.taxesIncluded)),
    totals: {
      subtotal: amount(order.currentSubtotalPriceSet.shopMoney.amount),
      tax: amount(order.currentTotalTaxSet.shopMoney.amount),
      shipping,
      total,
      currency,
      taxTreatment: order.taxesIncluded ? 'inclusive' : 'exclusive',
      ...(order.taxesIncluded ? { shippingGross: shipping } : {}),
      ...(shippingTaxRate === null ? {} : { shippingTaxRate }),
    },
    ...(shippingAddress === undefined ? {} : { shippingAddress }),
    ...(billingAddress === undefined ? {} : { billingAddress }),
    ...(shippingLine === undefined
      ? {}
      : {
          shipping: {
            methodId: nonEmpty(shippingLine.code) ?? shippingLine.title,
            methodName: shippingLine.title,
          },
        }),
    // `note` is part of the complete order resource, so an empty one is the
    // buyer leaving none, not the field being unreadable.
    buyerNote: nonEmpty(order.note) ?? null,
    ...(codToCollect === undefined ? {} : { codToCollect }),
    placedAt,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    metadata: { shopifyOrderGid: order.id, shopifyOrderName: order.name },
  };
}
