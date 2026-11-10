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
import { Fragment, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Popover, PopoverContent, PopoverTrigger } from '../../../shared/ui/popover';
import { oldestAgeSuffix } from '../../../shared/lib/oldest-age-suffix';
import type { OrderHealthSummary, OrderSlaSummary } from '../api/orders.types';
import type { UseOrderListFiltersResult } from '../hooks/use-order-list-filters';
import { useMessages, usePlural } from '../../../shared/i18n';

type Tone = 'error' | 'warning' | null;

interface AttentionItem {
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

interface AttentionGroup {
  id: 'late' | 'stuck' | 'toHandle';
  label: string;
  short: string;
  tone: Tone;
  total: number | undefined;
  items: AttentionItem[];
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

  const groups: AttentionGroup[] = [
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
    <div className="orders-attention" role="group" aria-label={COPY.quick.needsLook}>
      <span className="orders-attention__label">{COPY.quick.needsLook}</span>
      {groups.map((group, index) => (
        <Fragment key={group.id}>
          {index > 0 ? (
            <span className="orders-attention__sep" aria-hidden="true">
              ·
            </span>
          ) : null}
          <AttentionGroupLink
            group={group}
            footer={
              group.footer ? (
                <div className="orders-attention-pop__foot">
                  <Link className="nav-link" to="/orders/dispatch-risk">
                    {slaAny ? COPY.reviewDispatchRisk : COPY.dispatchRiskOverview}
                  </Link>
                  <span className="text-muted">{ATTN.riskHint}</span>
                </div>
              ) : null
            }
          />
        </Fragment>
      ))}
    </div>
  );
}

function AttentionGroupLink({
  group,
  footer,
}: {
  group: AttentionGroup;
  footer: ReactElement | null;
}): ReactElement {
  const ATTN = useMessages('orders').listFilters.attention;
  const plural = usePlural();
  const [open, setOpen] = useState(false);
  const activeCount = group.items.filter((item) => item.on).length;
  const classes = [
    'orders-attention__link',
    group.total && group.tone ? `orders-attention__link--${group.tone}` : '',
    activeCount > 0 ? 'orders-attention__link--on' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={classes} data-attention-group={group.id}>
          <span className="orders-attention__n mono tabular">
            {group.total === undefined ? '—' : group.total}
          </span>
          <span className="orders-attention__short">{group.short}</span>
          {activeCount > 0 ? (
            <span
              className="orders-attention__on"
              title={plural(activeCount, ATTN.activeCount)}
              aria-label={plural(activeCount, ATTN.activeCount)}
            />
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="orders-attention-pop" aria-label={group.label}>
        <div className="orders-attention-pop__head">{group.label}</div>
        {group.items.map((item) => {
          const age = item.count ? oldest(item.oldestAt) : '';
          const countClass = [
            'orders-attention-item__n',
            'mono',
            'tabular',
            item.count && item.tone ? `orders-attention-item__n--${item.tone}` : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <button
              key={item.id}
              type="button"
              className="orders-attention-item"
              aria-pressed={item.on}
              title={item.title}
              data-attention-item={item.id}
              onClick={item.toggle}
            >
              <span className="orders-attention-item__box" aria-hidden="true" />
              <span className="orders-attention-item__text">
                <span className="orders-attention-item__title">{item.label}</span>
                <span className="orders-attention-item__desc">{item.desc}</span>
              </span>
              <span className="orders-attention-item__meta">
                <span className={countClass}>{item.count === undefined ? '—' : item.count}</span>
                {age ? <span className="orders-attention-item__age mono">{age}</span> : null}
              </span>
            </button>
          );
        })}
        {footer}
      </PopoverContent>
    </Popover>
  );
}
