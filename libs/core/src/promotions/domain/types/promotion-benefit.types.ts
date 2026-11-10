/**
 * Promotion Benefit Types (#3935)
 *
 * What a promotion GIVES. A discriminated union keyed on `kind`, today with one
 * member: a free gift line.
 *
 * Price-changing benefits (percentage or amount discounts) are intentionally
 * absent. ADR-014 makes the marketplace's price the buyer-paid truth - a
 * discount applied on top of it would mean a refund on an order OpenLinker does
 * not own the money for. A new kind must arrive with a channel-side design and a
 * `BenefitPolicy` (the policy registry is a mapped type over
 * `PromotionBenefitKindValues`, so a kind without a policy does not compile).
 *
 * @module libs/core/src/promotions/domain/types
 */
export const PromotionBenefitKindValues = ['free-gift'] as const;
export type PromotionBenefitKind = (typeof PromotionBenefitKindValues)[number];

/** How a sales document shows a gift; same values as the order line's gift form. */
export const PromotionGiftDocumentFormValues = [
  'technical-cent',
  'priced-in',
  'show-zero',
  'omit',
] as const;
export type PromotionGiftDocumentForm = (typeof PromotionGiftDocumentFormValues)[number];

/** "For every unit bought" mode: the gift quantity is `quantity x min(floor(units / per), maxPerOrder)`. */
export interface PromotionGiftPerUnit {
  readonly productId: string;
  readonly per: number;
  readonly maxPerOrder: number | null;
}

export interface FreeGiftBenefit {
  readonly kind: 'free-gift';
  readonly productId: string;
  readonly variantId: string;
  /** Units per batch. */
  readonly quantity: number;
  readonly perUnit: PromotionGiftPerUnit | null;
  /** Skip when the gift product is already in the order (also inside a bundle's components). */
  readonly skipIfPresent: boolean;
  readonly documentForm?: PromotionGiftDocumentForm;
}

export type PromotionBenefit = FreeGiftBenefit;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function positiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

export function isPromotionBenefitKind(value: unknown): value is PromotionBenefitKind {
  return typeof value === 'string' && (PromotionBenefitKindValues as readonly string[]).includes(value);
}

export function isFreeGiftBenefit(value: unknown): value is FreeGiftBenefit {
  if (!isRecord(value) || value.kind !== 'free-gift') return false;
  if (!nonEmptyString(value.productId) || !nonEmptyString(value.variantId)) return false;
  if (!positiveInt(value.quantity)) return false;
  if (value.perUnit !== null) {
    if (!isRecord(value.perUnit)) return false;
    if (!nonEmptyString(value.perUnit.productId) || !positiveInt(value.perUnit.per)) return false;
    if (value.perUnit.maxPerOrder !== null && !positiveInt(value.perUnit.maxPerOrder)) return false;
  }
  if (typeof value.skipIfPresent !== 'boolean') return false;
  return (
    value.documentForm === undefined ||
    (PromotionGiftDocumentFormValues as readonly unknown[]).includes(value.documentForm)
  );
}

/** Narrow an untrusted value to a well-formed benefit of any kind. */
export function isPromotionBenefit(value: unknown): value is PromotionBenefit {
  if (!isRecord(value) || !isPromotionBenefitKind(value.kind)) return false;
  return isFreeGiftBenefit(value);
}
