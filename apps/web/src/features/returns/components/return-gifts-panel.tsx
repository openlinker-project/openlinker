/**
 * Return Gifts Panel (#3943, mockup state `returns/gift`, gifts spec section 9)
 *
 * A return of a line that has a gift does not change the gift. Each gift on the
 * order is listed with three choices: keep with the customer, ask for it back,
 * deduct its value. **OpenLinker never decides this**: until the operator picks,
 * the gift is shown as "not decided yet", nothing is deducted, and even a
 * recorded deduction only appears here as a hint the operator may apply to the
 * refund themselves. Renders nothing when the order carries no gift.
 *
 * @module apps/web/src/features/returns/components
 */
import type { ReactElement } from 'react';
import { SegmentedControl } from '../../../shared/ui/segmented-control';
import { Alert } from '../../../shared/ui/alert';
import { useToast } from '../../../shared/ui/toast-provider';
import { interpolate, useFormat, useMessages } from '../../../shared/i18n';
import {
  RETURN_GIFT_DECISION_VALUES,
  type ReturnGift,
  type ReturnGiftDecision,
} from '../api/return-gifts.api';
import { useDecideReturnGiftMutation, useReturnGiftsQuery } from '../hooks/use-return-gifts';

interface ReturnGiftsPanelProps {
  returnId: string;
  writeAccess: { canWrite: boolean; demoReadOnly: boolean; visible: boolean };
}

export function ReturnGiftsPanel({ returnId, writeAccess }: ReturnGiftsPanelProps): ReactElement | null {
  const copy = useMessages('return-gifts');
  const format = useFormat();
  const { showToast } = useToast();
  const query = useReturnGiftsQuery(returnId);
  const decide = useDecideReturnGiftMutation(returnId);

  if (query.isError) {
    return (
      <section id="gifts" data-testid="return-gift-error">
        <p className="text-muted">{copy.loadFailed}</p>
      </section>
    );
  }
  if (query.data === undefined || query.data.gifts.length === 0) {
    return null;
  }
  const { gifts, currency, refundDeductionGross } = query.data;
  const money = (amount: number): string => format.money(amount, currency ?? undefined);
  const canDecide = writeAccess.canWrite && !writeAccess.demoReadOnly;

  function choose(gift: ReturnGift, decision: ReturnGiftDecision): void {
    decide.mutate(
      { giftLineId: gift.giftLineId, decision },
      {
        onSuccess: () => showToast({ tone: 'success', title: copy.saved, description: gift.name ?? gift.sku ?? gift.giftLineId }),
        onError: () => showToast({ tone: 'error', title: copy.failed, description: gift.name ?? gift.sku ?? gift.giftLineId }),
      }
    );
  }

  return (
    <section id="gifts" data-testid="return-gift-lines">
      <h2 className="section-title" data-testid="return-gift-title">
        {copy.title}
      </h2>
      <Alert tone="info" data-testid="return-gift-banner">
        {copy.body}
      </Alert>
      {gifts.map((gift) => {
        const noPrice = gift.standalonePriceGross === null;
        return (
          <div key={gift.giftLineId} className="return-gift" data-testid={`return-gift-line-${gift.giftLineId}`}>
            <p>
              <strong>{gift.name ?? gift.sku ?? gift.giftLineId}</strong>
              {gift.sku !== null && gift.name !== null ? <span className="text-muted"> {gift.sku}</span> : null}
              <span className="text-muted">
                {' '}
                {copy.qty}: {gift.quantity}
                {gift.standalonePriceGross !== null
                  ? `, ${copy.worth}: ${money(gift.standalonePriceGross)}`
                  : ''}
              </span>
            </p>
            <SegmentedControl<ReturnGiftDecision>
              aria-label={copy.decision}
              value={gift.decision}
              onChange={(decision) => choose(gift, decision)}
              options={RETURN_GIFT_DECISION_VALUES.map((value) => ({
                value,
                label: copy.choice[value],
                disabled: !canDecide || (value === 'deduct' && noPrice),
                'data-testid': `return-gift-choice-${value}`,
              }))}
            />
            {gift.decision === null ? (
              <p className="text-muted" data-testid={`return-gift-state-${gift.giftLineId}`}>
                {copy.undecided}
              </p>
            ) : (
              <p className="text-muted" data-testid={`return-gift-note-${gift.decision}`}>
                {gift.decision === 'deduct'
                  ? interpolate(copy.note.deduct, { amount: money(gift.deductionGross ?? 0) })
                  : copy.note[gift.decision]}
              </p>
            )}
            {noPrice ? <p className="text-muted">{copy.deductUnknown}</p> : null}
          </div>
        );
      })}
      {refundDeductionGross > 0 ? (
        <p data-testid="return-gift-refund-amount">
          {interpolate(copy.refundHint, { amount: money(refundDeductionGross) })}
        </p>
      ) : null}
    </section>
  );
}
