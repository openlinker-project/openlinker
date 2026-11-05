/**
 * Payment writeback bulk bar (#3963)
 *
 * Shown above the orders list while the "Payment not sent to shop" filter is
 * on: one sentence saying what is wrong, and the two actions that fix it for
 * every order on the page - Retry, or Mark as handled when the operator
 * updated the payment in the shop by hand.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactElement } from 'react';

import { Button } from '../../../shared/ui/button';
import { useToast } from '../../../shared/ui/toast-provider';
import {
  useMarkPaymentWritebackHandledMutation,
  useRetryPaymentWritebackMutation,
} from '../hooks/use-payment-writeback-mutations';
import { PAYMENT_WRITEBACK_COPY as COPY } from '../lib/payment-writeback.copy';

interface PaymentWritebackBulkBarProps {
  internalOrderIds: readonly string[];
}

export function PaymentWritebackBulkBar({ internalOrderIds }: PaymentWritebackBulkBarProps): ReactElement | null {
  const retry = useRetryPaymentWritebackMutation();
  const markHandled = useMarkPaymentWritebackHandledMutation();
  const { showToast } = useToast();
  if (internalOrderIds.length === 0) return null;
  const ids = [...internalOrderIds];

  return (
    <div className="order-payment-bulk" role="region" aria-label={COPY.filterChip}>
      <span>{COPY.bulkSummary(ids.length)}</span>
      <span className="order-payment-bulk__actions">
        <Button
          tone="secondary"
          className="button--sm"
          disabled={markHandled.isPending}
          onClick={() =>
            markHandled.mutate(ids, {
              onSuccess: (r) => showToast({ tone: 'success', title: COPY.handledDone(r.updated), description: COPY.handledDoneDetail }),
              onError: (e) => showToast({ tone: 'error', title: 'Could not mark as handled', description: e.message }),
            })
          }
        >
          {COPY.markHandled}
        </Button>
        <Button
          tone="primary"
          className="button--sm"
          disabled={retry.isPending}
          onClick={() =>
            retry.mutate(ids, {
              onSuccess: (r) => showToast({ tone: 'success', title: COPY.retryDone(r.enqueued), description: COPY.retryDoneDetail }),
              onError: (e) => showToast({ tone: 'error', title: 'Retry failed', description: e.message }),
            })
          }
        >
          {retry.isPending ? COPY.retrying : COPY.retryNow}
        </Button>
      </span>
    </div>
  );
}
