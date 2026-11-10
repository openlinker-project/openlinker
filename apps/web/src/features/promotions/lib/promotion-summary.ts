/**
 * The one-sentence description of a promotion (#3935)
 *
 * Built from the form values as they stand, so the operator reads what the
 * promotion does in words while they edit it. Pure: the copy comes in as an
 * argument.
 *
 * @module apps/web/src/features/gifts/lib
 */
import type { GiftRuleFormValues } from './gift-rule-form';

export interface GiftSummaryCopy {
  incomplete: string;
  anyChannel: string;
  or: string;
  basket: string;
  product: string;
  unit: string;
  cap: string;
  noStack: string;
  from: string;
  fromTo: string;
}

const fill = (template: string, vars: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? '');

export interface GiftSummaryInput {
  values: GiftRuleFormValues;
  /** Names of the channels the rule covers; empty means every channel. */
  channelNames: readonly string[];
  /** The basket amount already formatted with its currency. */
  amountText: string;
  formatDate: (yyyyMmDd: string) => string;
}

/** The sentence, or `copy.incomplete` while what it needs is not chosen yet. */
export function describeGiftRule(input: GiftSummaryInput, copy: GiftSummaryCopy): string {
  const { values } = input;
  const needsProduct = values.kind !== 'basket';
  if (values.gift === null || (needsProduct && values.when === null)) return copy.incomplete;
  if (values.kind === 'basket' && values.basketMin.trim() === '') return copy.incomplete;

  const vars = {
    channels: input.channelNames.length === 0 ? copy.anyChannel : input.channelNames.join(copy.or),
    amount: input.amountText,
    product: values.when?.name ?? '',
    gift: values.gift.name,
    qty: values.giftQuantity.trim() === '' ? '1' : values.giftQuantity.trim(),
    n: values.perN.trim() === '' ? '1' : values.perN.trim(),
  };
  const lead = fill(copy[values.kind], vars);
  const cap = values.unitCap.trim() === '' ? '' : fill(copy.cap, { cap: values.unitCap.trim() });
  const stack = values.doNotCombine ? copy.noStack : '';
  const period =
    values.from === ''
      ? ''
      : values.to === ''
        ? fill(copy.from, { date: input.formatDate(values.from) })
        : fill(copy.fromTo, { from: input.formatDate(values.from), to: input.formatDate(values.to) });
  return `${lead}${cap}${stack}${period}`;
}
