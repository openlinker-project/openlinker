/**
 * Return Money Panel (#2382, returns spec § 5.7)
 *
 * Hosts the refund confirmation and lists what has been recorded.
 *
 * **The form is imported from `orders`, not reimplemented.** `refund_records`
 * and `IOrderRefundService` live there, so orders owns the concept and this is
 * its first consumer — `from '../../orders'`, the #2100 cross-feature barrel
 * shape.
 *
 * Three rules the panel must not soften.
 *
 * **`refunded` is unreachable from every control here.** `Confirm refund` writes
 * `triggered`; only an OBSERVATION from the source writes `refunded` (#2378's
 * pinned rule). A button that set it would be OpenLinker asserting a money
 * movement it did not witness.
 *
 * **A 2xx with `refundRecordWritten: false` is NOT a plain success.** The money
 * state settled durably while the linked order record did not write (#2376), and
 * the two are different facts. Rendering only "recorded" would invite a second
 * confirm that answers 409.
 *
 * **`executedBy` is rendered, not dropped.** `operator_out_of_band` is the
 * honesty device: the panel says the operator moved the money and OpenLinker did
 * not.
 *
 * @module apps/web/src/features/returns/components
 */
import { useState, type ReactElement } from 'react';

import { interpolate, useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { KeyValueList } from '../../../shared/ui/key-value-list';
import { ReadOnlyLock } from '../../../shared/ui/read-only-lock';
import { useToast } from '../../../shared/ui/toast-provider';
import { RefundConfirmationForm, describeRefundReason } from '../../orders';
import { describeRefundError, readRefundCeilingExceeded } from '../lib/refund-error';
import type { RefundCeilingExceededDetails } from '../lib/refund-error';
import { useConfirmReturnRefundMutation } from '../hooks/use-return-custody-mutations';
import type { ReturnDetail } from '../api/returns.types';

interface ReturnMoneyPanelProps {
  detail: ReturnDetail;
  writeAccess: { canWrite: boolean; demoReadOnly: boolean; visible: boolean };
}

export function ReturnMoneyPanel({ detail, writeAccess }: ReturnMoneyPanelProps): ReactElement {
  const returnsCopy = useMessages('returns');
  const moneyCopy = returnsCopy.money.panel;
  const ceilingCopy = returnsCopy.money.refundCeiling;
  const { showToast } = useToast();
  const confirmRefund = useConfirmReturnRefundMutation(detail.id);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ceiling, setCeiling] = useState<RefundCeilingExceededDetails | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  const isOrphan = detail.bucket === 'orphan';

  return (
    <section className="returns-money-panel" id="money">
      <h2 className="section-title">{moneyCopy.sectionTitle}</h2>

      {detail.refunds.length === 0 ? (
        <p className="text-muted">{moneyCopy.none}</p>
      ) : (
        <KeyValueList
          items={detail.refunds.map((refund) => ({
            id: refund.id,
            label: interpolate(returnsCopy.timeline.refundAmount, { amount: refund.amount, currency: refund.currency }),
            value: (
              <span>
                {/* The honesty device, rendered. */}
                {interpolate(moneyCopy.refundLine, {
                  reason: describeRefundReason(refund.reason),
                  executedBy:
                    refund.executedBy === 'operator_out_of_band'
                      ? moneyCopy.executedOutOfBand
                      : moneyCopy.executedOther,
                })}
              </span>
            ),
          }))}
        />
      )}

      {/* Stated up front rather than discovered by submitting into a 409. */}
      {isOrphan ? <Alert tone="warning">{moneyCopy.orphanBlocked}</Alert> : null}

      {writeAccess.visible && !isOrphan ? (
        <ReadOnlyLock active={writeAccess.demoReadOnly} message={returnsCopy.custody.receive.readOnly}>
          {open ? (
            <RefundConfirmationForm
              currency={detail.orderCurrency}
              error={error}
              onCancel={() => {
                setOpen(false);
                setError(null);
                setCeiling(null);
                setAcknowledged(false);
              }}
              onSubmit={(input) => {
                setError(null);
                confirmRefund.mutate(
                  {
                    ...input,
                    currency: detail.orderCurrency ?? '',
                    ...(acknowledged ? { acknowledgeAboveCeiling: true } : {}),
                  },
                  {
                    onSuccess: (result) => {
                      setOpen(false);
                      setCeiling(null);
                      setAcknowledged(false);
                      // Two different facts, reported as two.
                      showToast(
                        result.refundRecordWritten
                          ? { tone: 'success', description: moneyCopy.success }
                          : { tone: 'warning', description: moneyCopy.recordNotWritten }
                      );
                    },
                    onError: (mutationError) => {
                      const exceeded = readRefundCeilingExceeded(mutationError);
                      setCeiling(exceeded);
                      // The callout replaces the generic line; it names the figures.
                      setError(exceeded === null ? describeRefundError(mutationError) : null);
                    },
                  }
                );
              }}
              pending={confirmRefund.isPending}
            />
          ) : (
            <Button onClick={() => setOpen(true)} type="button">
              {moneyCopy.action}
            </Button>
          )}
          {open && ceiling !== null ? (
            <Alert tone="warning" title={ceilingCopy.title}>
              <p>{interpolate(ceilingCopy.figures, { ...ceiling })}</p>
              <label>
                <input
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                  type="checkbox"
                />{' '}
                {ceilingCopy.acknowledge}
              </label>
              <p className="text-muted">{ceilingCopy.acknowledgeHint}</p>
            </Alert>
          ) : null}
        </ReadOnlyLock>
      ) : null}
    </section>
  );
}
