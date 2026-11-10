/**
 * PromotionSentence (#3935)
 *
 * The promotion read back in one sentence, as it stands: channels as chips,
 * values in bold and what is still missing as a quiet placeholder. The same
 * sentence serves the detail rail, the new-promotion rail and the list peek, so
 * the three cannot describe one promotion differently. Pure view of the form
 * values; the names it needs come in as arguments.
 *
 * @module apps/web/src/features/promotions/components
 */
import { Fragment, type ReactElement, type ReactNode } from 'react';
import { formatAmount } from '../../../shared/format/format-amount';
import { formatAbsoluteDate as formatDate } from '../../../shared/format/format-date';
import { useMessages } from '../../../shared/i18n';
import type { Connection } from '../../connections';
import type { PromotionFormValues } from '../lib/promotion-form';
import { PromotionChannelChip } from './promotion-channel-chip';

/** Replaces `{token}` in a template with nodes, keeping the rest as text. */
function fill(template: string, nodes: Record<string, ReactNode>): ReactNode[] {
  return template.split(/(\{\w+\})/g).map((part, index) => {
    const match = /^\{(\w+)\}$/.exec(part);
    if (match === null) return <Fragment key={index}>{part}</Fragment>;
    return <Fragment key={index}>{nodes[match[1]] ?? ''}</Fragment>;
  });
}

export interface PromotionSentenceProps {
  values: PromotionFormValues;
  /** Every channel the promotion could cover. */
  channels: readonly Connection[];
  /** Names of the promotions this one stacks with when `combineMode` is `selected`. */
  combineNames: readonly string[];
  /** Hide the period and limit clauses (the peek keeps the sentence short). */
  withPeriod?: boolean;
}

export function PromotionSentence({
  values,
  channels,
  combineNames,
  withPeriod = true,
}: PromotionSentenceProps): ReactElement {
  const copy = useMessages('promotions').rb;
  const placeholder = (text: string): ReactElement => <span className="pm-ph">{text}</span>;
  const bold = (text: string): ReactElement => <b>{text}</b>;

  // An empty choice means every channel: said in words, not as a row of chips.
  const allSelected = values.channelIds.length === 0;
  const chosen = allSelected ? [] : channels.filter((channel) => values.channelIds.includes(channel.id));
  const channelNodes: ReactNode =
    chosen.length === 0
      ? allSelected
        ? copy.anyChannel
        : placeholder(copy.channel)
      : chosen.map((channel, index) => (
          <Fragment key={channel.id}>
            {index > 0 ? copy.or : null}
            <PromotionChannelChip connection={channel} />
          </Fragment>
        ));

  const amount = values.basketMin.trim();
  const amountNode: ReactNode =
    amount === ''
      ? placeholder(copy.amount)
      : bold(formatAmount(Number(amount.replace(',', '.')), values.currency));
  const productNode: ReactNode =
    values.when === null ? placeholder(copy.product_ph) : bold(values.when.name);
  const giftNode: ReactNode = values.gift === null ? placeholder(copy.gift_ph) : bold(values.gift.name);
  const qty = values.giftQuantity.trim() === '' ? '1' : values.giftQuantity.trim();
  const template = copy[values.kind];

  const period =
    !withPeriod || values.from === ''
      ? null
      : values.to === ''
        ? fill(copy.from, { from: formatDate(values.from) })
        : fill(copy.fromTo, { from: formatDate(values.from), to: formatDate(values.to) });
  const cap = values.unitCap.trim() === '' ? null : fill(copy.cap, { cap: values.unitCap.trim() });
  const stack =
    values.combineMode === 'all'
      ? copy.stackAll
      : values.combineMode === 'none'
        ? copy.stackNone
        : combineNames.length === 0
          ? copy.stackSelectedNone
          : fill(copy.stackSelected, { names: combineNames.join(', ') });

  return (
    <>
      {fill(template, {
        channels: channelNodes,
        amount: amountNode,
        product: productNode,
        gift: giftNode,
        qty,
        n: values.perN.trim() === '' ? '1' : values.perN.trim(),
      })}
      {period !== null ? <> {period}</> : null}
      {cap !== null ? <> {cap}</> : null} <span data-testid="promotion-sentence-stack">{stack}</span>
    </>
  );
}
