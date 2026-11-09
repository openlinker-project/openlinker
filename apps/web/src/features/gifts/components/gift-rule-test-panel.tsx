/**
 * GiftRuleTestPanel (#3940, mockup M31 `gift-composer-test-*`)
 *
 * "Test on a sample order": the operator names an order and sees, for every gift
 * promotion in check order, whether it would add its gift and, when it would not,
 * the reason in plain words. Nothing is written (the dry run reuses the
 * automation evaluator). The unsaved draft in the form is tested beside the
 * saved promotions, so a rule can be checked before it is turned on.
 *
 * @module apps/web/src/features/gifts/components
 */
import { useState, type ReactElement } from 'react';
import { interpolate, useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { Input } from '../../../shared/ui/input';
import { StatusBadge } from '../../../shared/ui/status-badge';
import type { GiftDryRunVerdict, GiftRuleWriteInput } from '../api/gifts.types';
import { useEvaluateGiftRulesMutation } from '../hooks/use-gift-rules';

export interface GiftRuleTestPanelProps {
  /** The rule being edited, when it is saved. Marks its row as the subject. */
  ruleId: string | null;
  /** The draft as a write body, or `null` while the form is not complete enough to test. */
  draft: GiftRuleWriteInput | null;
  /** False when the surrounding tab already carries the title. */
  showTitle?: boolean;
}

const REASON_KEYS = {
  'paused-unit-cap': 'limit',
  'unit-cap-reached': 'limit',
  'below-per-unit-threshold': 'belowThreshold',
  'gift-already-in-order': 'alreadyInOrder',
  'customer-limit-reached': 'customerLimit',
  'customer-unknown': 'customerUnknown',
  'gift-out-of-stock': 'outOfStock',
  'gift-stock-unknown': 'stockUnknown',
  'superseded-by-earlier-rule': 'superseded',
  'rule-not-matching': 'notMatching',
} as const;

function reasonText(
  copy: ReturnType<typeof useMessages<'gifts'>>,
  verdict: GiftDryRunVerdict,
): string {
  const key = verdict.reason === null ? null : REASON_KEYS[verdict.reason as keyof typeof REASON_KEYS];
  return key === null || key === undefined ? (verdict.reason ?? '') : copy.test.reasons[key];
}

export function GiftRuleTestPanel({
  ruleId,
  draft,
  showTitle = true,
}: GiftRuleTestPanelProps): ReactElement {
  const copy = useMessages('gifts');
  const [orderId, setOrderId] = useState('');
  const evaluate = useEvaluateGiftRulesMutation();
  const verdicts = evaluate.data?.verdicts ?? [];
  const matched = verdicts.filter((v) => v.wouldApply).length;

  return (
    <section className="gift-test" aria-label={copy.test.title} data-testid="gift-composer-test-order">
      {showTitle ? <h3>{copy.test.title}</h3> : null}
      <p className="text-muted">{copy.test.help}</p>
      <div className="gift-test__row">
        <Input
          aria-label={copy.test.orderLabel}
          placeholder={copy.test.orderPlaceholder}
          value={orderId}
          onChange={(event) => setOrderId(event.target.value)}
          data-testid="gift-composer-test-input"
        />
        <Button
          tone="secondary"
          disabled={orderId.trim() === '' || evaluate.isPending}
          data-testid="gift-composer-test-run"
          onClick={() =>
            evaluate.mutate({
              orderId: orderId.trim(),
              ...(ruleId !== null && { ruleId }),
              ...(draft !== null && { rule: draft }),
            })
          }
        >
          {copy.test.run}
        </Button>
      </div>

      {evaluate.isError ? (
        <Alert tone="error" data-testid="gift-composer-test-error">
          {evaluate.error.isNotFound() ? copy.test.orderNotFound : evaluate.error.message}
        </Alert>
      ) : null}

      {evaluate.data ? (
        <div data-testid="gift-composer-test-result">
          <StatusBadge tone="info" data-testid="gift-composer-test-badge">
            {matched === 0
              ? copy.test.noneApply
              : interpolate(copy.test.someApply, { count: String(matched) })}
          </StatusBadge>
          <ul className="gift-test__verdicts">
            {verdicts.map((verdict) => (
              <li key={verdict.ruleId} data-testid={`gift-composer-test-verdict-${verdict.ruleId}`}>
                <strong>{verdict.ruleName}</strong>{' '}
                {verdict.isSubject || verdict.ruleName === draft?.name ? (
                  <StatusBadge tone="neutral" compact>
                    {copy.test.thisPromotion}
                  </StatusBadge>
                ) : null}
                <span>
                  {verdict.wouldApply
                    ? interpolate(copy.test.wouldAdd, { count: String(verdict.quantity) })
                    : reasonText(copy, verdict)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
