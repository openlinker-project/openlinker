/**
 * Promotion form model (#3935)
 *
 * The composer's values and the two pure conversions around them: a saved
 * promotion into form values, and form values into the write body. Three kinds
 * share one form: "with a product", "from an order amount" or "for every unit";
 * the kind is derived from what the promotion holds, never stored.
 *
 * `containsProduct` names the VARIANT the operator picked (a bundle is a
 * variant, so naming it matches an order that sold the set); `perUnit` counts
 * units of its PRODUCT.
 *
 * @module apps/web/src/features/promotions/lib
 */
import { isGiftUnitPriceAmount, type GiftDocumentFormChoice } from '../../gift-documents';
import type {
  Promotion,
  PromotionBenefit,
  PromotionCombinationMode,
  PromotionCondition,
  PromotionWriteInput,
} from '../api/promotions.types';

export const PromotionKindValues = ['product', 'basket', 'unit'] as const;
export type PromotionKind = (typeof PromotionKindValues)[number];

export interface PickedProduct {
  productId: string;
  variantId: string;
  name: string;
}

export interface PromotionFormValues {
  kind: PromotionKind;
  name: string;
  /** The product (variant) the order must contain; `null` for an amount rule. */
  when: PickedProduct | null;
  basketMin: string;
  currency: string;
  gift: PickedProduct | null;
  giftQuantity: string;
  /** Source connection ids; empty means every channel. */
  channelIds: string[];
  /** `yyyy-mm-dd`. */
  from: string;
  to: string;
  /** Which promotions this one stacks with. */
  combineMode: PromotionCombinationMode;
  /** The chosen promotions, only read when `combineMode` is `selected`. */
  combineIds: string[];
  skipIfPresent: boolean;
  unitCap: string;
  customerLimit: string;
  /** "1 gift per N" (unit rule only). */
  perN: string;
  maxPerOrder: string;
  documentForm: GiftDocumentFormChoice | '';
  /** Gross unit price per gift unit, only read with `custom-price`. */
  documentUnitPrice: string;
}

export function emptyPromotionForm(kind: PromotionKind, today: Date = new Date()): PromotionFormValues {
  return {
    kind,
    name: '',
    when: null,
    basketMin: '',
    currency: 'PLN',
    gift: null,
    giftQuantity: '1',
    channelIds: [],
    from: toDateInput(today.toISOString()),
    to: '',
    combineMode: 'all',
    combineIds: [],
    skipIfPresent: true,
    unitCap: '',
    customerLimit: '1',
    perN: '1',
    maxPerOrder: '',
    documentForm: '',
    documentUnitPrice: '',
  };
}

export function toDateInput(iso: string): string {
  return iso.slice(0, 10);
}

export function kindOfPromotion(promotion: Pick<Promotion, 'benefit' | 'conditions'>): PromotionKind {
  if (promotion.benefit.perUnit) return 'unit';
  return promotion.conditions.some((c) => c.field === 'orderTotalGross') ? 'basket' : 'product';
}

function positive(value: string): number | null {
  const n = Number(value);
  return value.trim() !== '' && Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * A saved promotion as form values. Product names are not on the promotion, so
 * the caller passes what it resolved; an id it could not resolve shows as the id.
 */
export function promotionToForm(
  promotion: Promotion,
  names: ReadonlyMap<string, string> = new Map(),
): PromotionFormValues {
  const kind = kindOfPromotion(promotion);
  const contains = promotion.conditions.find((c) => c.field === 'containsProduct');
  const amount = promotion.conditions.find((c) => c.field === 'orderTotalGross');
  const channels = promotion.conditions.find((c) => c.field === 'sourceConnectionIn');
  const gift = promotion.benefit;
  const nameOf = (id: string): string => names.get(id) ?? id;
  return {
    kind,
    name: promotion.name,
    when:
      contains && contains.field === 'containsProduct'
        ? {
            productId: gift.perUnit?.productId ?? contains.value,
            variantId: contains.value,
            name: nameOf(contains.value),
          }
        : null,
    basketMin: amount && amount.field === 'orderTotalGross' ? amount.amount : '',
    currency: amount && amount.field === 'orderTotalGross' ? amount.currency : 'PLN',
    gift: { productId: gift.productId, variantId: gift.variantId, name: nameOf(gift.variantId) },
    giftQuantity: String(gift.quantity),
    channelIds: channels && channels.field === 'sourceConnectionIn' ? [...channels.values] : [],
    from: toDateInput(promotion.effectiveFrom),
    to: promotion.effectiveTo ? toDateInput(promotion.effectiveTo) : '',
    combineMode: promotion.combinesWith.mode,
    combineIds: promotion.combinesWith.mode === 'selected' ? [...promotion.combinesWith.promotionIds] : [],
    skipIfPresent: gift.skipIfPresent,
    unitCap: promotion.limits.unitCap ? String(promotion.limits.unitCap) : '',
    customerLimit: promotion.limits.customerLimit ? String(promotion.limits.customerLimit) : '',
    perN: String(gift.perUnit?.per ?? 1),
    maxPerOrder: gift.perUnit?.maxPerOrder ? String(gift.perUnit.maxPerOrder) : '',
    documentForm: gift.documentForm ?? '',
    documentUnitPrice: gift.documentUnitPrice ?? '',
  };
}

export type PromotionFormProblem =
  | 'name'
  | 'when'
  | 'basket'
  | 'gift'
  | 'quantity'
  | 'period'
  | 'unit-cap'
  | 'per-n'
  | 'doc-price'
  | 'combine';

/** What is missing, in the order the operator reads the form. Empty means it can be saved. */
export function validatePromotionForm(values: PromotionFormValues): PromotionFormProblem[] {
  const problems: PromotionFormProblem[] = [];
  if (values.name.trim() === '') problems.push('name');
  if (values.kind !== 'basket' && values.when === null) problems.push('when');
  if (values.kind === 'basket' && !/^\d+(\.\d{1,2})?$/.test(values.basketMin.trim())) {
    problems.push('basket');
  }
  if (values.gift === null) problems.push('gift');
  if (positive(values.giftQuantity) === null) problems.push('quantity');
  if (values.to !== '' && values.to < values.from) problems.push('period');
  if (values.unitCap.trim() !== '' && positive(values.unitCap) === null) problems.push('unit-cap');
  if (values.kind === 'unit' && positive(values.perN) === null) problems.push('per-n');
  if (values.documentForm === 'custom-price' && !isGiftUnitPriceAmount(values.documentUnitPrice.trim())) {
    problems.push('doc-price');
  }
  if (values.combineMode === 'selected' && values.combineIds.length === 0) problems.push('combine');
  return problems;
}

/** The write body. Call only when {@link validatePromotionForm} found nothing. */
export function formToWriteInput(values: PromotionFormValues, isActive: boolean): PromotionWriteInput {
  const conditions: PromotionCondition[] = [];
  if (values.kind !== 'basket' && values.when) {
    conditions.push({ field: 'containsProduct', op: 'eq', value: values.when.variantId });
  }
  if (values.kind === 'basket') {
    conditions.push({
      field: 'orderTotalGross',
      op: 'gte',
      amount: values.basketMin.trim(),
      currency: values.currency,
    });
  }
  if (values.channelIds.length > 0) {
    conditions.push({ field: 'sourceConnectionIn', op: 'in', values: [...values.channelIds] });
  }
  const customPrice = values.documentForm === 'custom-price';
  const benefit: PromotionBenefit = {
    kind: 'free-gift',
    productId: values.gift?.productId ?? '',
    variantId: values.gift?.variantId ?? '',
    quantity: positive(values.giftQuantity) ?? 1,
    perUnit:
      values.kind === 'unit' && values.when
        ? {
            productId: values.when.productId,
            per: positive(values.perN) ?? 1,
            maxPerOrder: positive(values.maxPerOrder),
          }
        : null,
    skipIfPresent: values.skipIfPresent,
    ...(values.documentForm !== '' && { documentForm: values.documentForm }),
    ...(customPrice && { documentUnitPrice: values.documentUnitPrice.trim() }),
  };
  return {
    name: values.name.trim(),
    conditions,
    benefit,
    isActive,
    combinesWith:
      values.combineMode === 'selected'
        ? { mode: 'selected', promotionIds: [...values.combineIds] }
        : { mode: values.combineMode },
    limits: { unitCap: positive(values.unitCap), customerLimit: positive(values.customerLimit) },
    effectiveFrom: new Date(`${values.from}T00:00:00.000Z`).toISOString(),
    effectiveTo: values.to === '' ? null : new Date(`${values.to}T23:59:59.999Z`).toISOString(),
  };
}

/** The suggested name, from the gift and what triggers it. */
export function suggestPromotionName(
  values: PromotionFormValues,
  template: { product: string; basket: string; unit: string },
): string {
  const gift = values.gift?.name ?? '';
  if (gift === '') return '';
  return template[values.kind]
    .replace('{gift}', gift)
    .replace('{product}', values.when?.name ?? '')
    .replace('{amount}', values.basketMin.trim());
}
