/**
 * Shopify Order Input Mapper
 *
 * The neutral `OrderCreate` -> `orderCreate`'s `OrderCreateOrderInput` (#3978).
 *
 * Price (ADR-014): every line carries the price the BUYER paid on the source
 * (`priceSet`), never the shop's catalogue price - an imported order must
 * charge what was charged. When the source states its prices gross (or says
 * nothing), the order is created `taxesIncluded: true` with the gross unit
 * price; a net-priced source creates it net.
 *
 * Tax: a line whose rate the order states gets a tax line with that rate and
 * the tax contained in the line, computed here because Shopify requires an
 * amount and rounding belongs to the adapter (ADR-063 § 5). A line without a
 * stated rate, or with an exemption code (`zw`, `np`), gets no tax line
 * rather than a guessed one. Tax lines sit on the line items and the shipping
 * line, never on the order: Shopify takes one or the other, not both.
 *
 * Shipping: `OrderCreateLineItemInput.requiresShipping` defaults to FALSE for
 * every line, a variant line included, and an order whose lines do not require
 * shipping reads "shipping not required" in the admin, so nobody can buy a
 * label for it (D1). Every line therefore states it: a variant line carries its
 * own inventory item's `requiresShipping` (a digital product stays unshipped),
 * read by the adapter, and a custom line - a variant this connection does not
 * know - is created with its own title and SKU and `requiresShipping: true`.
 *
 * Whole-order discount: a source may report a discount it applied to the order
 * but to none of its lines (`totals.discountTotal`, e.g. an Allegro coupon).
 * The lines keep their listed price and the discount becomes a fixed-amount
 * `discountCode` (`OPENLINKER`), so the Shopify order totals to what the buyer
 * paid and the merchant sees it as a discount. The tax lines are computed on
 * each line's share of the discounted amount (`distributeOrderDiscount`, core's
 * one split rule). A discount that cannot be split (at least the line sum) is
 * not sent; the adapter warns.
 *
 * Pickup point: Shopify has no pickup-point field on an order, so a locker
 * the buyer chose rides in three places a packer or an app can read:
 * `customAttributes` (`Pickup point` = the locker id, plus its name and
 * description when stated), one line of the order `note`, and the shipping
 * line title (`<method> (GIT01D)`). The locker's geography is already the
 * shipping address. Nothing parses these back.
 *
 * Payment: a paid order gets a successful sale transaction (`manual`, or the
 * gateway the operator mapped), a cash-on-delivery order a PENDING one on
 * Shopify's `Cash on Delivery (COD)` gateway, an order with a mapped gateway a
 * PENDING one on it, anything else no transaction and `PENDING`.
 *
 * @module libs/integrations/shopify/src/infrastructure/mappers
 */
import type { Address, OrderCreate, OrderItem, OrderPickupPoint } from '@openlinker/core/orders';
import { distributeOrderDiscount, PAYMENT_METHOD, PAYMENT_STATUS } from '@openlinker/core/orders';
import { minorUnitExponentFor } from '@openlinker/core/sales-documents';

import { SHOPIFY_COD_GATEWAY, SHOPIFY_ORDER_DISCOUNT_CODE, SHOPIFY_ORDER_TAG } from '../../shopify.constants';

/** A line with the Shopify variant it resolved to, or null for a custom line. */
export interface ShopifyResolvedLine {
  readonly item: OrderItem;
  readonly variantGid: string | null;
  /** Whether the line ships: the variant's own inventory item, or true for a custom line. */
  readonly requiresShipping: boolean;
}

/** A whole-order discount the Shopify order carries as a fixed-amount code. */
export interface ShopifyOrderDiscount {
  readonly amount: number;
  /** Each line's total after its share of the discount, in line order. */
  readonly lineTotalsAfterDiscount: readonly number[];
}

/**
 * What the operator mapped for this order's source (Mappings tab of the source
 * connection): the Shopify delivery method its delivery method becomes, and
 * the Shopify gateway its payment method becomes. Absent = unmapped, the
 * source's own words are used.
 */
export interface ShopifyOrderMappedOptions {
  readonly deliveryMethod?: string;
  readonly paymentGateway?: string;
}

// A type alias, not an interface: only a type literal is assignable to the
// client's `Record<string, unknown>` variables parameter.
export type ShopifyOrderCreateVariables = {
  readonly order: Record<string, unknown>;
  readonly options: Record<string, unknown>;
};

type MoneyBag = { shopMoney: { amount: string; currencyCode: string } };

const NUMERIC_RATE = /^\d+(\.\d+)?$/;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function money(value: number, currencyCode: string): MoneyBag {
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
  const rate = Number(rateCode) / 100;
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
  const fields = Object.fromEntries(
    entries.filter((e): e is [string, string] => typeof e[1] === 'string' && e[1].trim().length > 0),
  );
  return Object.keys(fields).length === 0 ? undefined : fields;
}

/** The order's pickup-point attributes, or [] when it has none. */
export function pickupPointAttributes(point: OrderPickupPoint | undefined): Array<{ key: string; value: string }> {
  const id = point?.id.trim();
  if (point === undefined || id === undefined || id.length === 0) {
    return [];
  }
  const name = point.name?.trim();
  const description = point.description?.trim();
  return [
    { key: 'Pickup point', value: id },
    ...(name ? [{ key: 'Pickup point name', value: name }] : []),
    ...(description ? [{ key: 'Pickup point address', value: description }] : []),
  ];
}

/** One readable line for the order note: `Pickup point: GIT01D - <name>, <description>`. */
function pickupPointNote(point: OrderPickupPoint | undefined): string | null {
  const attributes = pickupPointAttributes(point);
  if (attributes.length === 0) {
    return null;
  }
  const details = attributes.slice(1).map((a) => a.value);
  return `Pickup point: ${attributes[0].value}${details.length > 0 ? ` - ${details.join(', ')}` : ''}`;
}

function shippingTitle(order: OrderCreate, mappedMethod: string | undefined): string {
  const base = mappedMethod ?? order.shipping?.methodName ?? order.shipping?.methodId ?? 'Shipping';
  const pointId = order.pickupPoint?.id.trim();
  return pointId && !base.includes(pointId) ? `${base} (${pointId})` : base;
}

function unitPrice(item: OrderItem, taxesIncluded: boolean): number {
  return taxesIncluded ? (item.unitPriceGross ?? item.price) : item.price;
}

/**
 * The order's whole-order discount, split across the lines, or null when the
 * order carries none or it cannot be split (it is at least the line sum).
 */
export function shopifyOrderDiscount(
  order: OrderCreate,
  lines: readonly ShopifyResolvedLine[],
): ShopifyOrderDiscount | null {
  const discount = order.totals.discountTotal;
  if (discount === undefined || !(discount > 0)) {
    return null;
  }
  const taxesIncluded = order.totals.taxTreatment !== 'exclusive';
  const split = distributeOrderDiscount(
    lines.map(({ item }) => unitPrice(item, taxesIncluded) * item.quantity),
    discount,
    minorUnitExponentFor(order.totals.currency),
  );
  return split === null
    ? null
    : { amount: discount, lineTotalsAfterDiscount: split.map((part) => part.grossTotalAfterDiscount) };
}

function lineItem(
  { item, variantGid, requiresShipping }: ShopifyResolvedLine,
  taxesIncluded: boolean,
  currencyCode: string,
  taxedTotal: number,
): Record<string, unknown> {
  const unit = unitPrice(item, taxesIncluded);
  const identity =
    variantGid === null
      ? {
          title: item.name ?? item.sku ?? `Item ${item.id}`,
          ...(item.sku ? { sku: item.sku } : {}),
          requiresShipping: true,
        }
      : { variantId: variantGid, requiresShipping };
  const tax = taxLines(item.taxRate, taxedTotal, taxesIncluded, currencyCode);
  return {
    ...identity,
    quantity: item.quantity,
    priceSet: money(unit, currencyCode),
    ...(tax.length === 0 ? {} : { taxLines: tax }),
  };
}

function transactions(
  order: OrderCreate,
  mapped: ShopifyOrderMappedOptions,
  currencyCode: string,
): Array<Record<string, unknown>> {
  const amountSet = money(order.totals.total, currencyCode);
  const isCod =
    order.paymentStatus === PAYMENT_STATUS.Cod || order.paymentMethod === PAYMENT_METHOD.CashOnDelivery;
  if (order.paymentStatus === PAYMENT_STATUS.Paid) {
    return [{ kind: 'SALE', status: 'SUCCESS', gateway: mapped.paymentGateway ?? 'manual', amountSet }];
  }
  if (isCod) {
    return [{ kind: 'SALE', status: 'PENDING', gateway: mapped.paymentGateway ?? SHOPIFY_COD_GATEWAY, amountSet }];
  }
  if (mapped.paymentGateway) {
    return [{ kind: 'SALE', status: 'PENDING', gateway: mapped.paymentGateway, amountSet }];
  }
  return [];
}

export function buildShopifyOrderCreateVariables(
  order: OrderCreate,
  lines: readonly ShopifyResolvedLine[],
  sourceIdentifier: string | undefined,
  mapped: ShopifyOrderMappedOptions = {},
): ShopifyOrderCreateVariables {
  const currencyCode = order.totals.currency;
  const taxesIncluded = order.totals.taxTreatment !== 'exclusive';

  const shippingAmount = taxesIncluded
    ? (order.totals.shippingGross ?? order.totals.shipping)
    : order.totals.shipping;
  const shippingTax = taxLines(order.totals.shippingTaxRate, shippingAmount, taxesIncluded, currencyCode);
  const shippingCode = mapped.deliveryMethod ?? order.shipping?.methodId;
  const shippingLines =
    order.shipping === undefined && !(shippingAmount > 0)
      ? []
      : [
          {
            title: shippingTitle(order, mapped.deliveryMethod),
            ...(shippingCode ? { code: shippingCode } : {}),
            source: 'openlinker',
            priceSet: money(shippingAmount, currencyCode),
            ...(shippingTax.length === 0 ? {} : { taxLines: shippingTax }),
          },
        ];

  const payment = transactions(order, mapped, currencyCode);
  const discount = shopifyOrderDiscount(order, lines);
  const customAttributes = pickupPointAttributes(order.pickupPoint);
  const noteLines = [
    ...(order.orderNumber ? [`OpenLinker order ${order.orderNumber}`] : []),
    ...[pickupPointNote(order.pickupPoint)].filter((line): line is string => line !== null),
  ];

  const buyerEmail = order.metadata?.buyerEmail;
  const shippingAddress = mailingAddress(order.shippingAddress);
  const billingAddress = mailingAddress(order.billingAddress);
  const phone = order.shippingAddress?.phone ?? order.billingAddress?.phone;

  return {
    order: {
      lineItems: lines.map((line, index) =>
        lineItem(
          line,
          taxesIncluded,
          currencyCode,
          discount?.lineTotalsAfterDiscount[index] ?? unitPrice(line.item, taxesIncluded) * line.item.quantity,
        ),
      ),
      ...(discount === null
        ? {}
        : {
            discountCode: {
              itemFixedDiscountCode: {
                code: SHOPIFY_ORDER_DISCOUNT_CODE,
                amountSet: money(discount.amount, currencyCode),
              },
            },
          }),
      ...(shippingLines.length === 0 ? {} : { shippingLines }),
      ...(shippingAddress === undefined ? {} : { shippingAddress }),
      ...(billingAddress === undefined ? {} : { billingAddress }),
      ...(typeof buyerEmail === 'string' && buyerEmail.length > 0 ? { email: buyerEmail } : {}),
      ...(phone ? { phone } : {}),
      currency: currencyCode,
      taxesIncluded,
      financialStatus: order.paymentStatus === PAYMENT_STATUS.Paid ? 'PAID' : 'PENDING',
      ...(payment.length === 0 ? {} : { transactions: payment }),
      // Shopify does not deduplicate on it; it is what the adapter's lookup
      // before a create (a retry after a lost answer) finds the order by.
      ...(sourceIdentifier === undefined ? {} : { sourceIdentifier }),
      tags: [SHOPIFY_ORDER_TAG],
      ...(noteLines.length === 0 ? {} : { note: noteLines.join('\n') }),
      ...(customAttributes.length === 0 ? {} : { customAttributes }),
    },
    options: {
      // Shopify lowers its own stock for a variant line (the default BYPASS
      // would not); its routing picks the location, which the adapter then
      // moves to the configured one.
      inventoryBehaviour: 'DECREMENT_OBEYING_POLICY',
      sendReceipt: false,
      sendFulfillmentReceipt: false,
    },
  };
}
