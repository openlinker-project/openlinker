/**
 * OrderStatusTabs (#4026)
 *
 * The six health values as `StatusTabs`: same partition, same counts, same
 * `health` URL filter as the tiles they replaced. "All orders" carries the
 * total and the five health tabs sum to it.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactElement } from 'react';
import { useMessages } from '../../../shared/i18n';
import { StatusTabs, type StatusTab } from '../../../shared/ui/status-tabs';
import type { OrderHealthSummary, OrderHealthValue } from '../api/orders.types';

export interface OrderStatusTabsProps {
  value: OrderHealthValue | undefined;
  summary: OrderHealthSummary | undefined;
  onChange: (next: OrderHealthValue | null) => void;
}

export function OrderStatusTabs({ value, summary, onChange }: OrderStatusTabsProps): ReactElement {
  const copy = useMessages('orders').listFilters;
  const labels = copy.healthLabels;
  const tabs: StatusTab<OrderHealthValue>[] = [
    { key: null, label: copy.anyStatus, count: summary?.total },
    { key: 'source_deleted', label: labels.source_deleted, tone: 'error', count: summary?.sourceDeleted },
    { key: 'needs_attention', label: labels.needs_attention, tone: 'error', count: summary?.needsAttention },
    { key: 'awaiting_mapping', label: labels.awaiting_mapping, tone: 'warning', count: summary?.awaitingMapping },
    { key: 'awaiting_dispatch', label: labels.awaiting_dispatch, tone: 'info', count: summary?.awaitingDispatch },
    { key: 'synced', label: labels.synced, tone: 'success', count: summary?.synced },
  ];
  return <StatusTabs tabs={tabs} value={value ?? null} onChange={onChange} aria-label={copy.statusTabsAria} />;
}
