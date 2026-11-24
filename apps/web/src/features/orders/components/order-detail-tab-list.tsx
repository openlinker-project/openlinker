/**
 * Order detail tab list (#4286)
 *
 * The tab strip of the order detail page. Counts are shown only when the page
 * already holds the number; a missing count renders nothing, never a `0`
 * (absence is not "none").
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactElement } from 'react';
import { TabsList, TabsTrigger } from '../../../shared/ui/tabs';
import type { OrderDetailTabId } from '../lib/order-detail-tabs';

export interface OrderDetailTabEntry {
  id: OrderDetailTabId;
  label: string;
  /** Omitted when unknown or zero. */
  count?: number;
  /** A problem lives in this tab: shows an attention dot. */
  flag?: boolean;
}

export function OrderDetailTabList({
  tabs,
  ariaLabel,
  attentionLabel,
}: {
  tabs: readonly OrderDetailTabEntry[];
  ariaLabel: string;
  attentionLabel: string;
}): ReactElement {
  return (
    <TabsList aria-label={ariaLabel} className="order-detail__tab-list">
      {tabs.map((tab) => (
        <TabsTrigger key={tab.id} value={tab.id} id={`order-tab-${tab.id}`}>
          {tab.label}
          {tab.flag ? <span className="order-detail__tab-dot" role="img" aria-label={attentionLabel} /> : null}
          {tab.count !== undefined && tab.count > 0 ? (
            <span className="tabs__count">{tab.count}</span>
          ) : null}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}
