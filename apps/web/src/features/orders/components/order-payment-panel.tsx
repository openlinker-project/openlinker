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

import { interpolate, renderRich, useMessages, usePlural } from '../../../shared/i18n';
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
import { paymentWritebackRowCopy, type PaymentWritebackCopy } from '../lib/payment-writeback-row';

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

function headline(
  copy: PaymentWritebackCopy,
  entries: readonly OrderPaymentWritebackEntry[],
  sourceName: string | null,
): {
  text: string;
  tone: 'ok' | 'warn' | 'muted';
} {
  if (entries.some((e) => e.state === 'cod')) return { text: copy.cashOnDelivery, tone: 'muted' };
  if (entries.some((e) => e.state === 'not-sent' && e.reason === 'cancelled')) {
    return { text: copy.paidAfterCancellation, tone: 'warn' };
  }
  if (entries.every((e) => e.state === 'awaiting')) return { text: copy.notPaidYet, tone: 'muted' };
  return {
    text: sourceName ? interpolate(copy.paidOn, { source: sourceName }) : copy.paidOnUnknown,
    tone: 'ok',
  };
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
  const copy = useMessages('orders').paymentWriteback;
  const plural = usePlural();

  if (entries.length === 0) return null;

  const rows = entries.filter((e) => e.state !== 'not-tracked');
  const notTracked = entries.filter((e) => e.state === 'not-tracked');
  const counted = entries.filter(isCounted);
  const done = counted.filter((e) => e.state === 'paid-in-shop' || e.state === 'created-paid').length;
  const problems = entries.filter((e) => e.problem);
  const paidAfterCancel = entries.some((e) => e.state === 'not-sent' && e.reason === 'cancelled');
  const head = headline(copy, entries, sourceName);
  const progressText = interpolate(copy.progress, { done, total: counted.length });

  const onRetry = (): void => {
    retry.mutate([internalOrderId], {
      onSuccess: (result) =>
        showToast({ tone: 'success', title: plural(result.enqueued, copy.retryDone), description: copy.retryDoneDetail }),
      onError: (error) => showToast({ tone: 'error', title: copy.retryFailed, description: error.message }),
    });
  };
  const onHandled = (): void => {
    markHandled.mutate([internalOrderId], {
      onSuccess: (result) =>
        showToast({ tone: 'success', title: plural(result.updated, copy.handledDone), description: copy.handledDoneDetail }),
      onError: (error) => showToast({ tone: 'error', title: copy.markHandledFailed, description: error.message }),
    });
  };

  return (
    <section className="detail-section order-payment-panel" aria-labelledby="order-payment-panel-title">
      <h3 className="detail-section__title" id="order-payment-panel-title">
        {copy.panelTitle}
      </h3>

      {problems.length > 0 ? (
        <Alert
          tone="warning"
          title={
            problems.length === 1 ? (
              <span>
                {renderRich(copy.problemTitleOne, {
                  shop: () => (
                    <ConnectionEntityLabel connectionId={problems[0].destinationConnectionId} showId={false} />
                  ),
                })}
              </span>
            ) : (
              plural(problems.length, copy.problemTitleMany)
            )
          }
          action={
            <span className="order-payment-panel__alert-actions">
              <Button tone="secondary" className="button--sm" onClick={onHandled} disabled={markHandled.isPending}>
                {copy.markHandled}
              </Button>
              <Button tone="primary" className="button--sm" onClick={onRetry} disabled={retry.isPending}>
                {retry.isPending ? copy.retrying : copy.retryNow}
              </Button>
            </span>
          }
        >
          {copy.problemBody}
        </Alert>
      ) : null}

      {paidAfterCancel ? (
        <Alert tone="warning" title={copy.cancelledTitle}>
          {copy.cancelledBody}
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
            <span className="order-payment-panel__progress-label">{progressText}</span>
            <span
              className="order-payment-panel__track"
              role="img"
              aria-label={progressText}
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
        <ul className="order-payment-panel__shops" aria-label={copy.shopsLabel}>
          {rows.map((entry) => {
            const row = paymentWritebackRowCopy(copy, entry.state, entry.reason);
            return (
              <li key={entry.destinationConnectionId} className="order-payment-panel__shop">
                <ConnectionEntityLabel connectionId={entry.destinationConnectionId} showId={false} />
                <span className="order-payment-panel__state">
                  <span className={`order-payment-panel__status order-payment-panel__status--${row.tone}`}>
                    <span className="order-payment-panel__dot" aria-hidden="true" />
                    {row.label}
                  </span>
                  {entry.state === 'paid-in-shop' ? (
                    <span className="order-payment-panel__helper">
                      <TimeDisplay iso={entry.at} format="time" />
                    </span>
                  ) : row.helper ? (
                    <span className="order-payment-panel__helper">{row.helper}</span>
                  ) : null}
                  {entry.state === 'retrying' ? (
                    <Button tone="ghost" className="button--sm" onClick={onRetry} disabled={retry.isPending}>
                      {copy.retryNow}
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
          {renderRich(plural(notTracked.length, copy.notTracked), {
            shops: () =>
              notTracked.map((entry, i) => (
                <span key={entry.destinationConnectionId}>
                  {i > 0 ? ', ' : null}
                  <ConnectionEntityLabel connectionId={entry.destinationConnectionId} showId={false} />
                </span>
              )),
          })}
        </p>
      ) : null}
    </section>
  );
}
