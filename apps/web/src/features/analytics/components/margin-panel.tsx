/**
 * Margin panel (#3588, D27)
 *
 * Gross margin on NET (VAT-exclusive) revenue, below the sales sections of
 * /analytics. Margin is always net - costs are entered net - so the panel
 * states that even when the page is on the Gross basis. Margin and margin %
 * are computed over lines with a recorded cost only; the coverage note keeps
 * every excluded line visible with its reason.
 *
 * States: populated; "missing cost" (nothing in range has a cost - the
 * empty state plus the best sellers still needing one); loading; failed.
 *
 * @module features/analytics/components
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../../shared/ui/button';
import { EmptyValue } from '../../../shared/ui/empty-value';
import { ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import { formatAmount } from '../../../shared/format/format-amount';
import type { NetGrossBasis } from '../api/analytics-settings.types';
import type { MarginFilters, MarginFigures } from '../api/margin-analytics.types';
import {
  useMarginAnalyticsQuery,
  useMarginProductsQuery,
} from '../hooks/use-margin-analytics-query';
import { formatRatio, isNoCostAtAll } from '../lib/margin-copy';
import { ExportCsvButton } from './export-csv-button';
import { MarginCoverageNote } from './margin-coverage-note';
import { MarginByChannelTable, MarginByProductTable, marginSlug } from './margin-tables';
import { MarginTrendChart } from './margin-trend-chart';

export const ANALYTICS_MARGIN_ANCHOR_ID = 'analytics-margin';
const PRODUCT_LIMIT = 5;

interface MarginKpiProps {
  testId: string;
  label: string;
  value: string | null;
  absentLabel?: string;
  metric: string;
  qualifier?: { label: string; value: string | null; absentLabel: string };
}

function MarginKpi({
  testId,
  label,
  value,
  absentLabel = 'No figure for this range',
  metric,
  qualifier,
}: MarginKpiProps): ReactElement {
  return (
    <div className="kpi-card" data-testid={testId}>
      <div className="kpi-card__label">
        <span className="kpi-card__label-text">{label}</span>
      </div>
      <div className="kpi-card__headline">
        <div className="kpi-card__value mono-text tabular">
          {value === null ? <EmptyValue label={absentLabel} /> : value}
        </div>
        <div className="kpi-card__metric">{metric}</div>
      </div>
      {qualifier ? (
        <div className="kpi-card__qualifiers">
          <div className="kpi-card__qualifier">
            <span className="kpi-card__qualifier-label">{qualifier.label}</span>
            <span className="kpi-card__qualifier-value">
              {qualifier.value === null ? (
                <EmptyValue label={qualifier.absentLabel} />
              ) : (
                qualifier.value
              )}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MarginKpiStrip({
  headline,
  currency,
}: {
  headline: MarginFigures;
  currency: string;
}): ReactElement {
  return (
    <section className="status-strip" aria-label="Margin figures">
      <MarginKpi
        testId="margin-kpi-net-revenue"
        label="Net revenue"
        value={formatAmount(headline.netRevenue, currency)}
        metric="All non-cancelled lines, VAT-exclusive"
      />
      <MarginKpi
        testId="margin-kpi-cost"
        label="Cost of goods"
        value={formatAmount(headline.costOfGoods, currency)}
        metric="Lines with a cost"
        qualifier={{
          label: 'Covered revenue',
          value: headline.costCoveragePct === null ? null : formatRatio(headline.costCoveragePct),
          absentLabel: 'No net revenue in this range',
        }}
      />
      <MarginKpi
        testId="margin-kpi-margin"
        label="Gross margin"
        value={formatAmount(headline.grossMargin, currency)}
        metric="Covered revenue − cost"
      />
      <MarginKpi
        testId="margin-kpi-margin-pct"
        label="Margin %"
        value={headline.marginPct === null ? null : formatRatio(headline.marginPct)}
        absentLabel="Margin % needs at least one line with a cost"
        metric="Of covered revenue"
      />
    </section>
  );
}

interface MarginPanelProps {
  filters: MarginFilters;
  /** The page's VAT basis toggle - margin ignores it, and the panel says so. */
  pageBasis: NetGrossBasis;
  displayCurrency?: string | null;
  /** Bumped by the Data Coverage row to open and scroll to the reasons. */
  coverageRevealRequest?: number;
}

export function MarginPanel({
  filters,
  pageBasis,
  displayCurrency,
  coverageRevealRequest = 0,
}: MarginPanelProps): ReactElement {
  const query = useMarginAnalyticsQuery(filters, 'week');
  const productsQuery = useMarginProductsQuery({
    ...filters,
    sortBy: 'netRevenue',
    limit: PRODUCT_LIMIT,
    offset: 0,
  });
  const [coverageOpen, setCoverageOpen] = useState(false);
  const anchorRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (coverageRevealRequest > 0) {
      setCoverageOpen(true);
      anchorRef.current?.scrollIntoView?.({ block: 'start' });
    }
  }, [coverageRevealRequest]);

  const data = query.data;
  const currency = data?.currency ?? null;
  const noCostAtAll = data ? isNoCostAtAll(data.headline) : false;

  const exportRequestChannel = { report: 'margin-channel', filters } as const;

  function renderBody(): ReactElement {
    if (query.isLoading) {
      return (
        <LoadingState
          eyebrow="Loading"
          title="Loading margin"
          message="Working out margin over lines with a recorded cost…"
        />
      );
    }
    if (query.error || !data) {
      return (
        <ErrorState
          title="Unable to load margin"
          message={query.error?.message ?? 'Margin figures are not available.'}
          action={<Button onClick={() => void query.refetch()}>Retry</Button>}
        />
      );
    }

    if (noCostAtAll) {
      const uncovered = (productsQuery.data?.items ?? []).filter(
        (item) => item.coveredNetRevenue === 0
      );
      return (
        <>
          <div className="empty-state" data-testid="margin-missing-cost-empty">
            <h2>No margin yet: no variant has a cost price</h2>
            <p>
              Margin needs the net cost you paid for each variant. OpenLinker never guesses it and
              never treats a missing cost as zero. Enter costs on the product page; orders placed
              after that count toward margin.
            </p>
          </div>
          {uncovered.length > 0 ? (
            <div>
              <p className="analytics-margin__basis">
                <strong>Best sellers without a cost</strong> · by net revenue
              </p>
              <ul className="analytics-margin__empty-list" data-testid="margin-missing-cost-list">
                {uncovered.map((item) => {
                  const slug = marginSlug(item.sku ?? item.productId);
                  return (
                    <li key={item.productId}>
                      <span>{item.name ?? 'Unknown product'}</span>
                      <span className="mono-text">
                        {item.sku ? `${item.sku} · ` : ''}
                        {formatAmount(item.netRevenue, data.currency)}
                      </span>
                      <Link
                        className="button button--ghost button--sm"
                        to={`/products/${encodeURIComponent(item.productId)}`}
                        data-testid={`margin-add-cost-link-${slug}`}
                      >
                        Add cost
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <p className="data-table__footnote">
                {productsQuery.data?.total ?? uncovered.length} products sold in this range, none
                with a cost recorded.
              </p>
            </div>
          ) : null}
        </>
      );
    }

    return (
      <>
        <MarginKpiStrip headline={data.headline} currency={data.currency} />
        <MarginCoverageNote
          figures={data.headline}
          currency={data.currency}
          open={coverageOpen}
          onOpenChange={setCoverageOpen}
        />
        {data.trend.length > 0 ? (
          <div>
            <p className="analytics-margin__basis">
              <strong>Gross margin by week</strong> · label is margin %
            </p>
            <MarginTrendChart points={data.trend} currency={data.currency} />
          </div>
        ) : null}
        <div>
          <h4 className="section-title analytics-margin__subtitle">Margin by channel</h4>
          <MarginByChannelTable
            channels={data.channels}
            headline={data.headline}
            currency={data.currency}
          />
          <p className="data-table__footnote">
            Gross margin and margin % are over lines with a cost only. Cost coverage is the share
            of net revenue those lines carry.
          </p>
        </div>
        <div>
          <div className="panel__header analytics-margin__subheader">
            <h4 className="section-title analytics-margin__subtitle">Margin by product</h4>
            <ExportCsvButton
              testId="export-csv-margin-product"
              reportLabel="Margin by product"
              request={{ report: 'margin-product', filters, sortBy: 'netRevenue' }}
              displayCurrency={displayCurrency}
              reportingCurrency={currency}
            />
          </div>
          {productsQuery.error ? (
            <ErrorState
              title="Unable to load margin by product"
              message={productsQuery.error.message}
              action={<Button onClick={() => void productsQuery.refetch()}>Retry</Button>}
            />
          ) : (
            <>
              <MarginByProductTable
                items={productsQuery.data?.items ?? []}
                currency={data.currency}
              />
              <p className="data-table__footnote">Top {PRODUCT_LIMIT} by net revenue.</p>
            </>
          )}
        </div>
      </>
    );
  }

  return (
    <article
      className="panel panel--dense analytics-margin"
      id={ANALYTICS_MARGIN_ANCHOR_ID}
      data-testid="margin-panel"
      ref={anchorRef}
    >
      <div className="panel__header">
        <div>
          <p className="eyebrow">Profitability</p>
          <h3 className="section-title">Margin</h3>
        </div>
        <ExportCsvButton
          testId="export-csv-margin-channel"
          reportLabel="Margin by channel"
          request={exportRequestChannel}
          displayCurrency={displayCurrency}
          reportingCurrency={currency}
          disabledReason={
            noCostAtAll ? 'Nothing to export: no line in this range has a cost' : undefined
          }
        />
      </div>
      <p className="analytics-margin__basis">
        <span className="chip chip--info">Net revenue · VAT-exclusive</span>
        Margin always uses net revenue because costs are entered net
        {pageBasis === 'gross' ? ', even though this page is set to Gross' : ''}. Cancelled orders
        excluded.{currency ? ` Amounts in ${currency}, the reporting currency.` : ''}
      </p>
      {renderBody()}
    </article>
  );
}
