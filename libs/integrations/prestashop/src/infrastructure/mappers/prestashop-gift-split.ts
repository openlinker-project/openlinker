/**
 * PrestaShop gift cart-rule split (#3937)
 *
 * A cart rule with `gift_product` makes PrestaShop add one unit of that product
 * to the order at its FULL price and book a discount of the same amount on
 * `order_cart_rule`. The webservice therefore reports the gift merged into the
 * ordinary `order_detail` row, and the order's discount carries its price. Core
 * wants the gift as its own 0.00 line (`gift.source = 'cart-rule'`) so nobody
 * has to guess which unit was free, so this splits it out and lowers the
 * discount by the same amount: the order total is unchanged by construction.
 *
 * Pure and deterministic. A split needs the rule's own booked value to cover the unit. The split line's id is derived from the row id and the
 * cart rule id, so a re-poll produces identical ids and the amendment diff
 * (which keys lines by id and compares quantity) reports nothing.
 *
 * @module libs/integrations/prestashop/src/infrastructure/mappers
 */
import type { OrderItem } from '@openlinker/core/orders';
import type { PrestashopOrderRow } from './prestashop.mapper.interface';

/** A cart rule applied to an order that hands out a free product. */
export interface PrestashopGiftCartRule {
  /** `ps_cart_rule.id_cart_rule`. */
  readonly idCartRule: string;
  /** `ps_cart_rule.gift_product`. */
  readonly giftProductId: string;
  /** `ps_cart_rule.gift_product_attribute`, `'0'` when the gift has no combination. */
  readonly giftProductAttributeId: string;
  /**
   * `order_cart_rules.value`: what the buyer was credited by this rule, tax
   * included, at order time. Without it the gift cannot be verified as free and
   * stays merged.
   */
  readonly valueTaxIncl?: number;
  /** `order_cart_rules.free_shipping`: the booked value then also carries the shipping. */
  readonly freeShipping?: boolean;
  /** The order's gross shipping, subtracted from the booked value of a free-shipping rule. */
  readonly shippingGross?: number;
}

const GIFT_ID_MARKER = '~gift:';

/** The `order_detail` row id a (possibly split) line id was derived from. */
export function sourceRowIdOfLineId(lineId: string): string {
  const at = lineId.indexOf(GIFT_ID_MARKER);
  return at === -1 ? lineId : lineId.slice(0, at);
}

function sameAttribute(rowAttribute: unknown, ruleAttribute: string): boolean {
  const normalise = (value: unknown): string => {
    const text = value === null || value === undefined ? '' : String(value).trim();
    return text === '' ? '0' : text;
  };
  return normalise(rowAttribute) === normalise(ruleAttribute);
}

export interface GiftSplitResult {
  readonly items: OrderItem[];
  /** Tax-included price of the units moved onto gift lines; what the discount must drop by. */
  readonly giftValueTaxIncl: number;
}

/**
 * Split one free unit per gift cart rule out of the matching line.
 *
 * Rules that match no line, or whose line carries no readable gross unit price,
 * are skipped: a gift we cannot price is left merged rather than invented.
 * `rows[i]` must describe `items[i]`.
 */
export function splitGiftLines(
  items: readonly OrderItem[],
  rows: readonly PrestashopOrderRow[],
  rules: readonly PrestashopGiftCartRule[],
  minorUnitExponent = 2
): GiftSplitResult {
  const minorUnit = 1 / 10 ** minorUnitExponent;
  const result: OrderItem[] = [...items];
  let giftValueTaxIncl = 0;
  const used = new Set<number>();

  for (const rule of rules) {
    const index = rows.findIndex(
      (row, i) =>
        !used.has(i) &&
        String(row.product_id ?? '') === rule.giftProductId &&
        sameAttribute(row.product_attribute_id, rule.giftProductAttributeId)
    );
    if (index === -1) continue;
    const base = items[index];
    const unitGross = base.unitPriceGross;
    if (unitGross === undefined || !Number.isFinite(unitGross) || base.quantity < 1) continue;
    // The gift is free only if THIS rule credited the buyer for the unit: a rule
    // that booked less (free shipping beside a gift that was paid for) proves
    // nothing about the line, so it stays merged rather than being clamped.
    if (rule.valueTaxIncl === undefined || !Number.isFinite(rule.valueTaxIncl)) continue;
    const credited =
      rule.freeShipping === true && rule.shippingGross !== undefined
        ? rule.valueTaxIncl - rule.shippingGross
        : rule.valueTaxIncl;
    if (credited < unitGross - minorUnit / 2) continue;
    used.add(index);

    const gift: OrderItem = {
      ...base,
      id: `${base.id}${GIFT_ID_MARKER}${rule.idCartRule}`,
      quantity: 1,
      price: 0,
      unitPriceGross: 0,
      gift: { source: 'cart-rule', ruleRef: rule.idCartRule },
    };
    giftValueTaxIncl += unitGross;

    const current = result.findIndex((candidate) => candidate.id === base.id);
    if (base.quantity === 1) {
      // The whole line IS the free unit: mark it in place instead of leaving a
      // zero-quantity remainder behind.
      result[current] = gift;
    } else {
      result[current] = { ...base, quantity: base.quantity - 1 };
      result.splice(current + 1, 0, gift);
    }
  }

  return { items: result, giftValueTaxIncl };
}
