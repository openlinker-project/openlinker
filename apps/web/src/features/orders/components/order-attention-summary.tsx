/**
 * OrderAttentionSummary (#4026)
 *
 * "Needs a look" as one quiet line beside the status tabs:
 *
 *   Needs a look  6 late to ship · 7 stuck · 3 to handle
 *
 * It replaces the row of nine chips. Each number is the server's UNION count
 * for its group (`summary.attention`, #4025), so an order that matches two
 * items counts once. Each number opens a popover listing its items with a
 * one-line explanation, the item's own count and, where one exists, the age
 * of the oldest order. Toggling an item writes the same URL filter the old
 * chip wrote, through `useOrderListFilters`.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { oldestAgeSuffix } from '../../../shared/lib/oldest-age-suffix';
import type { OrderHealthSummary, OrderSlaSummary } from '../api/orders.types';
import type { UseOrderListFiltersResult } from '../hooks/use-order-list-filters';
import { useMessages, usePlural } from '../../../shared/i18n';
import {
  AttentionSummary,
  type AttentionGroup as SharedAttentionGroup,
} from '../../../shared/ui/attention-summary';

type Tone = 'error' | 'warning' | null;

interface OrderAttentionItem {
  id: string;
  label: string;
  desc: string;
  tone: Tone;
  on: boolean;
  count: number | undefined;
  oldestAt?: string | null;
  title?: string;
  toggle: () => void;
}

interface OrderAttentionGroup {
  id: 'late' | 'stuck' | 'toHandle';
  label: string;
  short: string;
  tone: Tone;
  total: number | undefined;
  items: OrderAttentionItem[];
  footer: boolean;
}

export interface OrderAttentionSummaryProps {
  filtersApi: UseOrderListFiltersResult;
  summary: OrderHealthSummary | undefined;
  slaSummary: OrderSlaSummary | undefined;
}

function oldest(oldestAt: string | null | undefined): string {
  return oldestAgeSuffix(oldestAt).replace(/^ · /, '');
}

export function OrderAttentionSummary({
  filtersApi,
  summary,
  slaSummary,
}: OrderAttentionSummaryProps): ReactElement {
  const COPY = useMessages('orders').listFilters;
  const ATTN = COPY.attention;
  const plural = usePlural();
  const { state } = filtersApi;
  const toggleSla = (value: 'overdue' | 'at_risk'): void => {
    filtersApi.setFilter('slaState', state.slaState === value ? null : value);
  };

  const groups: OrderAttentionGroup[] = [
    {
      id: 'late',
      ...ATTN.late,
      tone: 'error',
      total: summary?.attention?.lateToShip,
      footer: true,
      items: [
        {
          id: 'overdue',
          ...ATTN.items.overdue,
          tone: 'error',
          on: state.slaState === 'overdue',
          count: slaSummary?.overdue,
          toggle: () => {
            toggleSla('overdue');
          },
        },
        {
          id: 'at_risk',
          ...ATTN.items.atRisk,
          tone: 'warning',
          on: state.slaState === 'at_risk',
          count: slaSummary?.atRisk,
          toggle: () => {
            toggleSla('at_risk');
          },
        },
        {
          id: 'breaching',
          ...ATTN.items.breaching,
          tone: 'warning',
          on: state.breaching,
          count: summary?.dueWithin24h,
          toggle: () => {
            filtersApi.toggle('dueBefore');
          },
        },
      ],
    },
    {
      id: 'stuck',
      ...ATTN.stuck,
      tone: 'error',
      total: summary?.attention?.stuck,
      footer: false,
      items: [
        {
          id: 'sales-docs',
          ...ATTN.items.salesDocs,
          tone: 'error',
          on: state.invoicingBlocked,
          count: summary?.salesDocumentBlocked,
          oldestAt: summary?.salesDocumentBlockedOldestAt,
          title: summary?.salesDocumentIssuedOnRequest
            ? plural(summary.salesDocumentIssuedOnRequest, COPY.quick.salesDocsTitle)
            : undefined,
          toggle: () => {
            filtersApi.toggle('salesDocumentBlocked');
          },
        },
        {
          id: 'oms-stopped',
          ...ATTN.items.omsStopped,
          tone: 'error',
          on: state.omsAttention,
          count: summary?.omsAttention,
          toggle: () => {
            filtersApi.toggle('attention');
          },
        },
        {
          id: 'routing',
          ...ATTN.items.routing,
          tone: 'error',
          on: state.routingBlocked,
          count: summary?.destinationRoutingBlocked,
          toggle: () => {
            filtersApi.toggle('destinationRoutingBlocked');
          },
        },
        {
          id: 'waiting',
          ...ATTN.items.waiting,
          tone: 'warning',
          on: state.waitingInOpenLinker,
          count: summary?.waitingInOpenLinker,
          oldestAt: summary?.waitingInOpenLinkerOldestAt,
          toggle: () => {
            filtersApi.toggle('waitingInOpenLinker');
          },
        },
        {
          id: 'gift-not-added',
          ...ATTN.items.giftNotAdded,
          tone: 'warning',
          on: state.giftNotAdded,
          count: summary?.giftNotAdded,
          toggle: () => {
            filtersApi.toggle('giftNotAdded');
          },
        },
        {
          id: 'gift-shop-rejected',
          ...ATTN.items.giftShopRejected,
          tone: 'error',
          on: state.giftShopRejected,
          count: summary?.giftShopRejected,
          toggle: () => {
            filtersApi.toggle('giftShopRejected');
          },
        },
        {
          id: 'rate-conflict',
          ...ATTN.items.rateConflict,
          tone: 'warning',
          on: state.rateConflict,
          count: summary?.taxRateConflict,
          toggle: () => {
            filtersApi.toggle('taxRateConflict');
          },
        },
      ],
    },
    {
      id: 'toHandle',
      ...ATTN.toHandle,
      tone: null,
      total: summary?.attention?.toHandle,
      footer: false,
      items: [
        {
          id: 'pack-bench',
          ...ATTN.items.packBench,
          tone: null,
          on: state.onPackBench,
          count: summary?.onPackBench,
          toggle: () => {
            filtersApi.toggle('onPackBench');
          },
        },
        {
          id: 'buyer-note',
          ...ATTN.items.buyerNote,
          tone: null,
          on: state.hasBuyerNote,
          count: summary?.hasBuyerNote,
          toggle: () => {
            filtersApi.toggle('hasBuyerNote');
          },
        },
        {
          id: 'open-return',
          ...ATTN.items.openReturn,
          tone: null,
          on: state.openReturn,
          count: summary?.openReturn,
          toggle: () => {
            filtersApi.toggle('openReturn');
          },
        },
      ],
    },
  ];

  const slaAny = slaSummary !== undefined && (slaSummary.overdue > 0 || slaSummary.atRisk > 0);

  return (
    <AttentionSummary
      label={COPY.quick.needsLook}
      groups={groups.map(
        (group): SharedAttentionGroup => ({
          id: group.id,
          label: group.label,
          short: group.short,
          tone: group.tone,
          total: group.total,
          items: group.items.map(({ oldestAt, ...item }) => ({
            ...item,
            age: item.count ? oldest(oldestAt) || undefined : undefined,
          })),
          footer: group.footer ? (
            <div className="attention-pop__foot">
              <Link className="nav-link" to="/orders/dispatch-risk">
                {slaAny ? COPY.reviewDispatchRisk : COPY.dispatchRiskOverview}
              </Link>
              <span className="text-muted">{ATTN.riskHint}</span>
            </div>
          ) : undefined,
        }),
      )}
    />
  );
}
