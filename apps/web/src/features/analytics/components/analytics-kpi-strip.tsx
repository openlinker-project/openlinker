/**
 * Sales KPI strip (#1990)
 *
 * Six-card strip matching the reference design mockup's anatomy: every card
 * the mockup specifies ships, and every figure the mockup assumed but
 * `GET /analytics/sales` (#1987) doesn't return renders as an honest
 * "not available" placeholder rather than a fabricated number — never
 * silently dropped.
 *
 * Real vs. not-yet-real, per card:
 *   - Revenue: the headline ("Net sales") needs a refund amount that exists
 *     nowhere in the repo — unavailable. Its GMV qualifier (`headline.
 *     revenue`, real, FX-stamped, in `reportingCurrency`) renders normally.
 *   - Orders, Order value (AOV + median), Units: fully real. Order value
 *     divides by `stampedOrderCount`, not `orderCount` (ADR-040) — the gap
 *     between the two counts is surfaced explicitly rather than hidden.
 *   - Returns & refunds: no return/refund entity exists anywhere in the
 *     orders domain — fully planned.
 *   - Cancellations: `cancelledCount`/`cancelledValue` are real fields —
 *     rendered as a normal, real card.
 *   - Delta ("vs previous period") on every card: `GET /analytics/sales`
 *     takes one `from`/`to` and stores no prior-period figure, so this is
 *     always a static placeholder, never computed (see `AnalyticsKpiCard`).
 *
 * Currency (#1987/#2049/ADR-040): every money figure in this strip is in
 * `headline.reportingCurrency`. When `stampedOrderCount < orderCount`, the
 * Order value card discloses the gap explicitly instead of implying the
 * figure covers every placed order.
 *
 * @module features/analytics/components
 */
import type { ReactElement } from 'react';
import { Button } from '../../../shared/ui/button';
import { EmptyValue } from '../../../shared/ui/empty-value';
import { ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import { formatAmount } from '../../../shared/format/format-amount';
import { useNumberFormat } from '../../../shared/i18n/use-number-format';
import { useSalesAnalyticsQuery } from '../hooks/use-sales-analytics-query';
import type { SalesAnalyticsFilters } from '../api/sales-analytics.types';
import {
  averageDailyOrders,
  cancellationRate,
  orderCountTrendValues,
  revenueTrendValues,
  trendTone,
  unitsPerOrder,
} from '../lib/sales-analytics-view-model';
import { AnalyticsKpiCard } from './analytics-kpi-card';
import { GapMark } from './gap-mark';

const NET_SALES_GAP =
  'Net sales needs the value of returns/refunds, and no return or refund entity exists anywhere in the repo yet.';
const RETURN_RATE_GAP =
  'No return entity exists anywhere in the repo — nothing records a return or a refund.';
const STAMPED_GAP =
  'Order value is computed only from orders an FX rate has been stamped onto — recently ingested, not-yet-stamped orders are excluded from this figure until the FX stamp sweep reaches them.';
const RATIO_FORMAT_OPTIONS: Intl.NumberFormatOptions = {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
};
const PERCENT_FORMAT_OPTIONS: Intl.NumberFormatOptions = {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
};

interface AnalyticsKpiStripProps {
  filters: SalesAnalyticsFilters;
}

export function AnalyticsKpiStrip({ filters }: AnalyticsKpiStripProps): ReactElement {
  const query = useSalesAnalyticsQuery(filters);
  const numberFormat = useNumberFormat();
  const ratioFormat = useNumberFormat(RATIO_FORMAT_OPTIONS);
  const pctFormat = useNumberFormat(PERCENT_FORMAT_OPTIONS);

  if (query.isLoading) {
    return (
      <LoadingState
        eyebrow="Loading"
        title="Loading sales figures"
        message="Fetching revenue, orders and units for the selected range…"
      />
    );
  }

  if (query.error) {
    return (
      <ErrorState
        title="Unable to load sales figures"
        message={query.error.message}
        action={<Button onClick={() => void query.refetch()}>Retry</Button>}
      />
    );
  }

  const headline = query.data?.headline;
  if (!headline) {
    return (
      <ErrorState
        title="Unable to load sales figures"
        message="The server returned no data for this range."
        action={<Button onClick={() => void query.refetch()}>Retry</Button>}
      />
    );
  }

  const revenueTrend = revenueTrendValues(headline.trend);
  const orderTrend = orderCountTrendValues(headline.trend);
  const avgDaily = averageDailyOrders(headline.orderCount, filters.from, filters.to);
  const unitsRatio = unitsPerOrder(headline.unitsSold, headline.orderCount);
  const cancelRate = cancellationRate(headline.cancelledCount, headline.orderCount);
  const currency = headline.reportingCurrency;
  const stampedGapVisible = headline.stampedOrderCount < headline.orderCount;

  return (
    <section className="status-strip status-strip--analytics" aria-label="Key sales figures">
      <AnalyticsKpiCard
        label="Revenue"
        infotipLabel="About the Revenue figures"
        definitions={[
          {
            term: 'Net sales',
            text: 'The value of product sales after discounts and after customer refunds, excluding VAT.',
            formula: 'Net order value (after discounts, excluding VAT) − Refunded value',
            caveat: NET_SALES_GAP,
          },
          {
            term: 'GMV (Gross Merchandise Value)',
            text: 'The value of non-cancelled, FX-stamped product items in orders placed during the selected period, in the reporting currency.',
            caveat: stampedGapVisible
              ? `Cancelled orders and cancelled items are excluded. ${headline.orderCount - headline.stampedOrderCount} of ${headline.orderCount} placed orders have not yet been FX-stamped and are omitted from this figure.`
              : 'Cancelled orders and cancelled items are excluded. Returned/refunded items remain included.',
          },
        ]}
        headlineUnavailable
        metric={
          <>
            Net sales <GapMark title={NET_SALES_GAP} />
          </>
        }
        value={<EmptyValue label="Not computable until refunds are captured" />}
        trend={{ values: revenueTrend, tone: trendTone(revenueTrend), ariaLabel: 'GMV trend, last 7 days' }}
        qualifiers={[
          {
            label: stampedGapVisible ? (
              <>
                GMV <GapMark title={STAMPED_GAP} />
              </>
            ) : (
              'GMV'
            ),
            value: formatAmount(headline.revenue, currency),
          },
        ]}
      />

      <AnalyticsKpiCard
        label="Orders"
        infotipLabel="About the Orders figures"
        definitions={[
          {
            term: 'Orders',
            text: 'Every non-cancelled order placed during the selected period, across every connected channel.',
          },
          {
            term: 'Avg. daily orders',
            text: 'Orders divided by the number of days in the selected range.',
          },
        ]}
        metric="Placed orders"
        value={numberFormat.format(headline.orderCount)}
        trend={{ values: orderTrend, tone: trendTone(orderTrend), ariaLabel: 'Order count trend, last 7 days' }}
        qualifiers={[{ label: 'Avg. daily', value: ratioFormat.format(avgDaily) }]}
      />

      <AnalyticsKpiCard
        label="Order value"
        infotipLabel="About the Order value figures"
        definitions={[
          {
            term: 'Average order value (AOV)',
            text: 'Revenue divided by the number of FX-stamped orders it was computed from — not by every placed order.',
            caveat: stampedGapVisible ? STAMPED_GAP : undefined,
          },
          {
            term: 'Median order value',
            text: 'The middle value of every FX-stamped order in the range — less skewed by a handful of very large or very small orders than the average.',
          },
        ]}
        metric={
          stampedGapVisible ? (
            <>
              Average <GapMark title={STAMPED_GAP} />
            </>
          ) : (
            'Average'
          )
        }
        value={formatAmount(headline.averageOrderValue, currency)}
        qualifiers={[{ label: 'Median', value: formatAmount(headline.medianOrderValue, currency) }]}
      />

      <AnalyticsKpiCard
        label="Units"
        infotipLabel="About the Units figures"
        definitions={[
          { term: 'Units sold', text: 'Total item quantity across every non-cancelled order line in the selected period.' },
          { term: 'Units per order', text: 'Units sold divided by placed orders.' },
        ]}
        metric="Units sold"
        value={numberFormat.format(headline.unitsSold)}
        qualifiers={[{ label: 'Per order', value: ratioFormat.format(unitsRatio) }]}
      />

      <AnalyticsKpiCard
        label="Cancellations"
        infotipLabel="About the Cancellations figures"
        definitions={[
          {
            term: 'Cancelled orders',
            text: 'Orders placed in the selected period that were subsequently cancelled — excluded from every revenue figure on this page.',
          },
          {
            term: 'Cancellation rate',
            text: 'Cancelled orders divided by all orders placed in the period, including the cancelled ones themselves.',
          },
        ]}
        metric="Cancelled value"
        value={formatAmount(headline.cancelledValue, currency)}
        qualifiers={[
          { label: 'Cancelled orders', value: numberFormat.format(headline.cancelledCount) },
          { label: 'Rate', value: pctFormat.format(cancelRate) },
        ]}
      />

      <AnalyticsKpiCard
        label="Returns & refunds"
        infotipLabel="About Returns & refunds"
        definitions={[
          {
            term: 'Returns & refunds',
            text: 'No return or refund entity exists anywhere in the orders domain yet — this card has nothing to report.',
            caveat: RETURN_RATE_GAP,
          },
        ]}
        planned
        metric={
          <>
            Return rate <GapMark title={RETURN_RATE_GAP} />
          </>
        }
        value={<EmptyValue label="No return/refund entity exists yet" />}
      />
    </section>
  );
}
