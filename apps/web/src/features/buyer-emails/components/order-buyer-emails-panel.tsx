/**
 * Order Buyer Emails Panel (#3555, mockup M21 `order-suppressed` / `order-bounced`)
 *
 * The automatic buyer emails of one order, one row per attempt: sent, not sent
 * (with the server's reason) or bounced. A bounce is never shown as sent. The
 * panel renders nothing for an order with no attempt, so an install that never
 * opted in sees no empty card on every order.
 *
 * `data-mk-state` follows the mockup: `order-bounced` when any attempt bounced,
 * else `order-suppressed` when any was not sent.
 *
 * @module apps/web/src/features/buyer-emails/components
 */
import type { ReactElement } from 'react';
import { DetailSection } from '../../../shared/ui/detail-section';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { TimeDisplay } from '../../../shared/ui/time-display';
import type { BuyerEmailDelivery } from '../api/buyer-emails.types';
import { useOrderBuyerEmailsQuery } from '../hooks/use-order-buyer-emails-query';
import { BUYER_EMAILS_COPY, templateLabel } from '../lib/buyer-emails.copy';

const COPY = BUYER_EMAILS_COPY.order;

function panelState(rows: readonly BuyerEmailDelivery[]): string | undefined {
  if (rows.some((row) => row.outcome === 'bounced')) return 'order-bounced';
  if (rows.some((row) => row.outcome === 'suppressed')) return 'order-suppressed';
  return undefined;
}

function OutcomeBadge({ row }: { row: BuyerEmailDelivery }): ReactElement {
  if (row.outcome === 'sent') return <StatusBadge tone="success">{COPY.sent}</StatusBadge>;
  if (row.outcome === 'bounced') return <StatusBadge tone="error">{COPY.bounced}</StatusBadge>;
  if (row.outcome === 'pending') return <StatusBadge tone="warning">{COPY.pending}</StatusBadge>;
  return <StatusBadge tone="neutral">{COPY.suppressed}</StatusBadge>;
}

export function OrderBuyerEmailsPanel({
  internalOrderId,
}: {
  internalOrderId: string;
}): ReactElement | null {
  const query = useOrderBuyerEmailsQuery(internalOrderId);

  if (query.isError) {
    return (
      <DetailSection title={COPY.title} data-testid="order-buyer-emails">
        <p className="muted-text">{COPY.loadError}</p>
      </DetailSection>
    );
  }
  const rows = query.data ?? [];
  if (query.isLoading || rows.length === 0) return null;

  return (
    <DetailSection title={COPY.title} data-testid="order-buyer-emails" data-mk-state={panelState(rows)}>
      <ul className="buyer-email-list" data-testid="order-buyer-emails-list">
        {rows.map((row) => (
          <li key={row.id} className="buyer-email-list__item" data-testid="order-buyer-email-row" data-outcome={row.outcome}>
            <div className="buyer-email-list__row">
              <strong>{templateLabel(row.templateKey)}</strong>
              <OutcomeBadge row={row} />
            </div>
            {row.outcome === 'suppressed' ? (
              <p className="muted-text" data-testid="order-buyer-email-reason">
                {row.suppressionMessage ?? COPY.suppressedFallback}
              </p>
            ) : null}
            {row.outcome === 'pending' ? (
              <p className="muted-text" data-testid="order-buyer-email-pending">
                {COPY.pendingDetail}
              </p>
            ) : null}
            {row.outcome === 'bounced' ? (
              <p className="muted-text" data-testid="order-buyer-email-bounce">
                {COPY.bouncedDetail}
              </p>
            ) : null}
            <p className="muted-text buyer-email-list__time">
              <TimeDisplay iso={row.createdAt} />
            </p>
          </li>
        ))}
      </ul>
    </DetailSection>
  );
}
