/**
 * Gift lines on an order (#3940)
 *
 * What a gift line says about who decided it and who pays for it. The source is
 * the line's `gift.source`; nothing is inferred from the price.
 *
 * @module apps/web/src/features/gifts/lib
 */
export const GiftSourceValues = ['channel', 'cart-rule', 'ol-rule', 'operator'] as const;
export type GiftSource = (typeof GiftSourceValues)[number];

export interface LineGift {
  source: GiftSource;
  ruleRef?: string | null;
  documentForm?: string | null;
}

export function isGiftSource(value: unknown): value is GiftSource {
  return typeof value === 'string' && (GiftSourceValues as readonly string[]).includes(value);
}

/**
 * Who funds the gift: a gift the channel or the shop sent is the seller's
 * promotion in that system; one OpenLinker or an operator added is paid by the
 * seller through OpenLinker. Either way the buyer pays 0.00 and the seller bears
 * the cost - the copy says which system decided.
 */
export function giftSourceKey(source: GiftSource): 'channel' | 'cartRule' | 'rule' | 'operator' {
  switch (source) {
    case 'channel':
      return 'channel';
    case 'cart-rule':
      return 'cartRule';
    case 'ol-rule':
      return 'rule';
    case 'operator':
      return 'operator';
  }
}

/** True for a gift OpenLinker itself added (a rule or a person), which OpenLinker alone knows. */
export function isAddedByOpenLinker(source: GiftSource): boolean {
  return source === 'ol-rule' || source === 'operator';
}
