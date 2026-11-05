/**
 * Gift rule form model (#3940)
 *
 * The composer's values and the two pure conversions around them: a saved rule
 * into form values, and form values into the write body. Three cards, one form
 * (gifts spec 4.3): a rule is "with a product", "from an order amount" or "for
 * every unit", and the kind is derived from what the rule holds, never stored.
 *
 * `containsProduct` names the VARIANT the operator picked (a bundle is a
 * variant, so naming it matches an order that sold the set); `perUnit` counts
 * units of its PRODUCT.
 *
 * @module apps/web/src/features/gifts/lib
 */
import type { GiftDocumentFormChoice } from '../../gift-documents';
import type {
  GiftDefinition,
  GiftRule,
  GiftRuleCondition,
  GiftRuleWriteInput,
} from '../api/gifts.types';

export const GiftRuleKindValues = ['product', 'basket', 'unit'] as const;
export type GiftRuleKind = (typeof GiftRuleKindValues)[number];

export interface PickedProduct {
  productId: string;
  variantId: string;
  name: string;
}

export interface GiftRuleFormValues {
  kind: GiftRuleKind;
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
  doNotCombine: boolean;
  skipIfPresent: boolean;
  unitCap: string;
  customerLimit: string;
  /** "1 gift per N" (unit rule only). */
  perN: string;
  maxPerOrder: string;
  documentForm: GiftDocumentFormChoice | '';
}

export function emptyGiftRuleForm(kind: GiftRuleKind, today: Date = new Date()): GiftRuleFormValues {
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
    doNotCombine: false,
    skipIfPresent: true,
    unitCap: '',
    customerLimit: '',
    perN: '1',
    maxPerOrder: '',
    documentForm: '',
  };
}

export function toDateInput(iso: string): string {
  return iso.slice(0, 10);
}

export function kindOfRule(rule: Pick<GiftRule, 'gift' | 'conditions'>): GiftRuleKind {
  if (rule.gift?.perUnit) return 'unit';
  return rule.conditions.some((c) => c.field === 'orderTotalGross') ? 'basket' : 'product';
}

function positive(value: string): number | null {
  const n = Number(value);
  return value.trim() !== '' && Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * A saved rule as form values. Product names are not on the rule, so the caller
 * passes what it resolved; an id it could not resolve shows as the id.
 */
export function ruleToForm(
  rule: GiftRule,
  names: ReadonlyMap<string, string> = new Map(),
): GiftRuleFormValues {
  const kind = kindOfRule(rule);
  const contains = rule.conditions.find((c) => c.field === 'containsProduct');
  const amount = rule.conditions.find((c) => c.field === 'orderTotalGross');
  const channels = rule.conditions.find((c) => c.field === 'sourceConnectionIn');
  const gift = rule.gift;
  const nameOf = (id: string): string => names.get(id) ?? id;
  return {
    kind,
    name: rule.name,
    when:
      contains && contains.field === 'containsProduct'
        ? {
            productId: gift?.perUnit?.productId ?? contains.value,
            variantId: contains.value,
            name: nameOf(contains.value),
          }
        : null,
    basketMin: amount && amount.field === 'orderTotalGross' ? amount.amount : '',
    currency: amount && amount.field === 'orderTotalGross' ? amount.currency : 'PLN',
    gift: gift ? { productId: gift.productId, variantId: gift.variantId, name: nameOf(gift.variantId) } : null,
    giftQuantity: String(gift?.quantity ?? 1),
    channelIds: channels && channels.field === 'sourceConnectionIn' ? [...channels.values] : [],
    from: toDateInput(rule.effectiveFrom),
    to: rule.effectiveTo ? toDateInput(rule.effectiveTo) : '',
    doNotCombine: gift?.doNotCombine ?? false,
    skipIfPresent: gift?.skipIfPresent ?? true,
    unitCap: gift?.unitCap ? String(gift.unitCap) : '',
    customerLimit: gift?.customerLimit ? String(gift.customerLimit) : '',
    perN: String(gift?.perUnit?.per ?? 1),
    maxPerOrder: gift?.perUnit?.maxPerOrder ? String(gift.perUnit.maxPerOrder) : '',
    documentForm: gift?.documentForm ?? '',
  };
}

export type GiftRuleFormProblem =
  | 'name'
  | 'when'
  | 'basket'
  | 'gift'
  | 'quantity'
  | 'period'
  | 'unit-cap'
  | 'per-n';

/** What is missing, in the order the operator reads the form. Empty means it can be saved. */
export function validateGiftRuleForm(values: GiftRuleFormValues): GiftRuleFormProblem[] {
  const problems: GiftRuleFormProblem[] = [];
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
  return problems;
}

/** The write body. Call only when {@link validateGiftRuleForm} found nothing. */
export function formToWriteInput(values: GiftRuleFormValues, isActive: boolean): GiftRuleWriteInput {
  const conditions: GiftRuleCondition[] = [];
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
  const gift: GiftDefinition = {
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
    unitCap: positive(values.unitCap),
    skipIfPresent: values.skipIfPresent,
    doNotCombine: values.doNotCombine,
    customerLimit: positive(values.customerLimit),
    ...(values.documentForm !== '' && { documentForm: values.documentForm }),
  };
  return {
    name: values.name.trim(),
    conditions,
    gift,
    isActive,
    effectiveFrom: new Date(`${values.from}T00:00:00.000Z`).toISOString(),
    effectiveTo: values.to === '' ? null : new Date(`${values.to}T23:59:59.999Z`).toISOString(),
  };
}

/** The suggested name, from the gift and what triggers it. */
export function suggestRuleName(values: GiftRuleFormValues, template: {
  product: string;
  basket: string;
  unit: string;
}): string {
  const gift = values.gift?.name ?? '';
  if (gift === '') return '';
  const fill = (text: string): string =>
    text
      .replace('{gift}', gift)
      .replace('{product}', values.when?.name ?? '')
      .replace('{amount}', values.basketMin.trim());
  return fill(template[values.kind]);
}
