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

import { useMessages, usePlural } from '../../../shared/i18n';
import { Button } from '../../../shared/ui/button';
import { useToast } from '../../../shared/ui/toast-provider';
import {
  useMarkPaymentWritebackHandledMutation,
  useRetryPaymentWritebackMutation,
} from '../hooks/use-payment-writeback-mutations';

interface PaymentWritebackBulkBarProps {
  internalOrderIds: readonly string[];
}

export function PaymentWritebackBulkBar({ internalOrderIds }: PaymentWritebackBulkBarProps): ReactElement | null {
  const retry = useRetryPaymentWritebackMutation();
  const markHandled = useMarkPaymentWritebackHandledMutation();
  const { showToast } = useToast();
  const copy = useMessages('orders').paymentWriteback;
  const plural = usePlural();
  if (internalOrderIds.length === 0) return null;
  const ids = [...internalOrderIds];

  return (
    <div className="order-payment-bulk" role="region" aria-label={copy.bulkRegionLabel}>
      <span>{plural(ids.length, copy.bulkSummary)}</span>
      <span className="order-payment-bulk__actions">
        <Button
          tone="secondary"
          className="button--sm"
          disabled={markHandled.isPending}
          onClick={() =>
            markHandled.mutate(ids, {
              onSuccess: (r) =>
                showToast({ tone: 'success', title: plural(r.updated, copy.handledDone), description: copy.handledDoneDetail }),
              onError: (e) => showToast({ tone: 'error', title: copy.markHandledFailed, description: e.message }),
            })
          }
        >
          {copy.markHandled}
        </Button>
        <Button
          tone="primary"
          className="button--sm"
          disabled={retry.isPending}
          onClick={() =>
            retry.mutate(ids, {
              onSuccess: (r) =>
                showToast({ tone: 'success', title: plural(r.enqueued, copy.retryDone), description: copy.retryDoneDetail }),
              onError: (e) => showToast({ tone: 'error', title: copy.retryFailed, description: e.message }),
            })
          }
        >
          {retry.isPending ? copy.retrying : copy.retryNow}
        </Button>
      </span>
    </div>
  );
}
