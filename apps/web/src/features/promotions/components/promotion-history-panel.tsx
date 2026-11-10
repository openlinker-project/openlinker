/**
 * PromotionHistoryPanel (#3935, mockups "Historia")
 *
 * What happened when the promotion met an order: the order number, when, why it
 * was skipped (in words) and whether the gift was added, skipped or failed.
 * Reads the promotion's own application log, newest first.
 *
 * @module apps/web/src/features/promotions/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { interpolate, useFormat, useMessages } from '../../../shared/i18n';
import { Alert } from '../../../shared/ui/alert';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import type { PromotionHistoryItem } from '../api/promotions.types';
import { usePromotionHistoryQuery } from '../hooks/use-promotions';

const OUTCOME_TONE: Record<PromotionHistoryItem['outcome'], StatusBadgeTone> = {
  applied: 'success',
  skipped: 'neutral',
  failed: 'error',
};

const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function useHistoryWhen(): (iso: string) => string {
  const copy = useMessages('promotions').history;
  const format = useFormat();
  return (iso) => {
    const at = new Date(iso);
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    if (sameDay(at, now)) return interpolate(copy.today, { time: format.time(iso) });
    if (sameDay(at, yesterday)) return interpolate(copy.yesterday, { time: format.time(iso) });
    return format.dateTime(iso);
  };
}

export function historyReasonText(
  copy: ReturnType<typeof useMessages<'promotions'>>['history'],
  item: PromotionHistoryItem,
): string | null {
  if (item.reasonCode === null) return null;
  const reasons = copy.reasons as Record<string, string>;
  return reasons[item.reasonCode] ?? item.reasonCode;
}

export interface PromotionHistoryPanelProps {
  promotionId: string;
  enabled: boolean;
}

export function PromotionHistoryPanel({ promotionId, enabled }: PromotionHistoryPanelProps): ReactElement {
  const copy = useMessages('promotions').history;
  const history = usePromotionHistoryQuery(promotionId, enabled);
  const when = useHistoryWhen();

  if (history.isError) {
    return (
      <Alert tone="warning" density="compact" data-testid="promotion-history-failed">
        {copy.failed}
      </Alert>
    );
  }
  const items = history.data?.items ?? [];
  if (history.data !== undefined && items.length === 0) {
    return (
      <p className="form-field__description" data-testid="promotion-history-empty">
        {copy.empty}
      </p>
    );
  }
  return (
    <ul className="pm-log" data-testid="promotion-history">
      {items.map((item) => {
        const reason = historyReasonText(copy, item);
        return (
          <li key={item.id}>
            <span>
              <Link className="mono" to={`/orders/${encodeURIComponent(item.internalOrderId)}`}>
                {item.orderNumber !== null ? `#${item.orderNumber}` : item.internalOrderId}
              </Link>
              <span className="text-muted">
                {when(item.createdAt)}
                {reason !== null ? ` · ${reason}` : ''}
              </span>
            </span>
            <StatusBadge tone={OUTCOME_TONE[item.outcome]} withDot compact>
              {item.outcome === 'applied' ? copy.applied : item.outcome === 'skipped' ? copy.skipped : copy.error}
            </StatusBadge>
          </li>
        );
      })}
    </ul>
  );
}
