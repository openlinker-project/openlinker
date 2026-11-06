/**
 * Order Payment Panel (#3963)
 *
 * Answers, on the order detail page, "did the payment that arrived after the
 * shops got this order reach them?". One headline (where the money was paid),
 * a "N of M shops updated" line, then one row per shop with a single
 * sentence-case state word. Payment is shown here and nowhere else on the page.
 *
 * A warning appears only when OpenLinker gave up on a shop (or when the buyer
 * paid an order that is already cancelled); a shop that is still being retried
 * stays quiet, with one "Retry now" on its row. Shops that have no payment
 * status at all drop to a footnote rather than a row that reads like an error.
 *
 * Matches `docs/plans/mockups/paid-writeback-to-destination.html`, states
 * `later`, `retrying`, `stopped`, `cod`, `cancelled` and `first`.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactElement } from 'react';

import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { TimeDisplay } from '../../../shared/ui/time-display';
import { useToast } from '../../../shared/ui/toast-provider';
import { ConnectionEntityLabel } from '../../connections';
import type { OrderPaymentWritebackEntry } from '../api/orders.types';
import {
  useMarkPaymentWritebackHandledMutation,
  useRetryPaymentWritebackMutation,
} from '../hooks/use-payment-writeback-mutations';
import { PAYMENT_WRITEBACK_COPY as COPY, paymentWritebackRowCopy } from '../lib/payment-writeback.copy';

interface OrderPaymentPanelProps {
  internalOrderId: string;
  entries: readonly OrderPaymentWritebackEntry[];
  /** Name of the source connection the money was paid on; `null` when unknown. */
  sourceName: string | null;
  /** Formatted order total, e.g. "PLN 389.00"; `null` when unknown. */
  amountLabel: string | null;
}

/** Entries that are part of "N of M shops updated". */
const COUNTED_STATES = new Set(['paid-in-shop', 'created-paid', 'sending', 'retrying']);

function isCounted(entry: OrderPaymentWritebackEntry): boolean {
  return COUNTED_STATES.has(entry.state) || entry.problem;
}

function headline(entries: readonly OrderPaymentWritebackEntry[], sourceName: string | null): {
  text: string;
  tone: 'ok' | 'warn' | 'muted';
} {
  if (entries.some((e) => e.state === 'cod')) return { text: COPY.cashOnDelivery, tone: 'muted' };
  if (entries.some((e) => e.state === 'not-sent' && e.reason === 'cancelled')) {
    return { text: COPY.paidAfterCancellation, tone: 'warn' };
  }
  if (entries.every((e) => e.state === 'awaiting')) return { text: COPY.notPaidYet, tone: 'muted' };
  return { text: sourceName ? COPY.paidOn(sourceName) : COPY.paidOnUnknown, tone: 'ok' };
}

export function OrderPaymentPanel({
  internalOrderId,
  entries,
  sourceName,
  amountLabel,
}: OrderPaymentPanelProps): ReactElement | null {
  const retry = useRetryPaymentWritebackMutation();
  const markHandled = useMarkPaymentWritebackHandledMutation();
  const { showToast } = useToast();

  if (entries.length === 0) return null;

  const rows = entries.filter((e) => e.state !== 'not-tracked');
  const notTracked = entries.filter((e) => e.state === 'not-tracked');
  const counted = entries.filter(isCounted);
  const done = counted.filter((e) => e.state === 'paid-in-shop' || e.state === 'created-paid').length;
  const problems = entries.filter((e) => e.problem);
  const paidAfterCancel = entries.some((e) => e.state === 'not-sent' && e.reason === 'cancelled');
  const head = headline(entries, sourceName);

  const onRetry = (): void => {
    retry.mutate([internalOrderId], {
      onSuccess: (result) => showToast({ tone: 'success', title: COPY.retryDone(result.enqueued), description: COPY.retryDoneDetail }),
      onError: (error) => showToast({ tone: 'error', title: 'Retry failed', description: error.message }),
    });
  };
  const onHandled = (): void => {
    markHandled.mutate([internalOrderId], {
      onSuccess: (result) => showToast({ tone: 'success', title: COPY.handledDone(result.updated), description: COPY.handledDoneDetail }),
      onError: (error) => showToast({ tone: 'error', title: 'Could not mark as handled', description: error.message }),
    });
  };

  return (
    <section className="detail-section order-payment-panel" aria-labelledby="order-payment-panel-title">
      <h3 className="detail-section__title" id="order-payment-panel-title">
        {COPY.panelTitle}
      </h3>

      {problems.length > 0 ? (
        <Alert
          tone="warning"
          title={
            problems.length === 1 ? (
              <span>
                <ConnectionEntityLabel connectionId={problems[0].destinationConnectionId} showId={false} />{' '}
                {COPY.problemTitleSuffix}
              </span>
            ) : (
              COPY.problemTitleMany(problems.length)
            )
          }
          action={
            <span className="order-payment-panel__alert-actions">
              <Button tone="secondary" className="button--sm" onClick={onHandled} disabled={markHandled.isPending}>
                {COPY.markHandled}
              </Button>
              <Button tone="primary" className="button--sm" onClick={onRetry} disabled={retry.isPending}>
                {retry.isPending ? COPY.retrying : COPY.retryNow}
              </Button>
            </span>
          }
        >
          {COPY.problemBody}
        </Alert>
      ) : null}

      {paidAfterCancel ? (
        <Alert tone="warning" title={COPY.cancelledTitle}>
          {COPY.cancelledBody}
        </Alert>
      ) : null}

      <div className="order-payment-panel__head">
        <div className="order-payment-panel__lead">
          <p className={`order-payment-panel__headline order-payment-panel__headline--${head.tone}`}>
            {head.text}
          </p>
          {amountLabel ? <p className="order-payment-panel__meta tabular">{amountLabel}</p> : null}
        </div>
        {counted.length > 0 ? (
          <div className="order-payment-panel__progress">
            <span className="order-payment-panel__progress-label">{COPY.progress(done, counted.length)}</span>
            <span
              className="order-payment-panel__track"
              role="img"
              aria-label={COPY.progress(done, counted.length)}
            >
              <span
                className={`order-payment-panel__fill${done === counted.length ? ' order-payment-panel__fill--done' : ''}`}
                style={{ width: `${Math.round((done / counted.length) * 100)}%` }}
              />
            </span>
          </div>
        ) : null}
      </div>

      {rows.length > 0 ? (
        <ul className="order-payment-panel__shops" aria-label="Payment in each shop">
          {rows.map((entry) => {
            const copy = paymentWritebackRowCopy(entry.state, entry.reason);
            return (
              <li key={entry.destinationConnectionId} className="order-payment-panel__shop">
                <ConnectionEntityLabel connectionId={entry.destinationConnectionId} showId={false} />
                <span className="order-payment-panel__state">
                  <span className={`order-payment-panel__status order-payment-panel__status--${copy.tone}`}>
                    <span className="order-payment-panel__dot" aria-hidden="true" />
                    {copy.label}
                  </span>
                  {entry.state === 'paid-in-shop' ? (
                    <span className="order-payment-panel__helper">
                      <TimeDisplay iso={entry.at} format="time" />
                    </span>
                  ) : copy.helper ? (
                    <span className="order-payment-panel__helper">{copy.helper}</span>
                  ) : null}
                  {entry.state === 'retrying' ? (
                    <Button tone="ghost" className="button--sm" onClick={onRetry} disabled={retry.isPending}>
                      {COPY.retryNow}
                    </Button>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      {notTracked.length > 0 ? (
        <p className="order-payment-panel__foot">
          {notTracked.map((entry, i) => (
            <span key={entry.destinationConnectionId}>
              {i > 0 ? ', ' : null}
              <ConnectionEntityLabel connectionId={entry.destinationConnectionId} showId={false} />
            </span>
          ))}{' '}
          {COPY.notTrackedSuffix}
        </p>
      ) : null}
    </section>
  );
}
