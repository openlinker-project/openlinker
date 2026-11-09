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
import { interpolate, renderRich, useFormat, useMessages, usePlural } from '../../../shared/i18n';
import type { NetGrossBasis } from '../api/analytics-settings.types';
import type { MarginFilters, MarginFigures } from '../api/margin-analytics.types';
import {
  useMarginAnalyticsQuery,
  useMarginProductsQuery,
} from '../hooks/use-margin-analytics-query';
import { formatRatio, isNoCostAtAll } from '../lib/margin.lib';
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
  absentLabel,
  metric,
  qualifier,
}: MarginKpiProps): ReactElement {
  const copy = useMessages('analytics').marginPanel;
  return (
    <div className="kpi-card" data-testid={testId}>
      <div className="kpi-card__label">
        <span className="kpi-card__label-text">{label}</span>
      </div>
      <div className="kpi-card__headline">
        <div className="kpi-card__value mono-text tabular">
          {value === null ? <EmptyValue label={absentLabel ?? copy.noFigure} /> : value}
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
  const copy = useMessages('analytics').marginPanel;
  const kpis = copy.kpis;
  const format = useFormat();
  return (
    <section className="status-strip" aria-label={copy.figuresAria}>
      <MarginKpi
        testId="margin-kpi-net-revenue"
        label={kpis.netRevenue.label}
        value={format.money(headline.netRevenue, currency)}
        metric={kpis.netRevenue.metric}
      />
      <MarginKpi
        testId="margin-kpi-cost"
        label={kpis.cost.label}
        value={format.money(headline.costOfGoods, currency)}
        metric={kpis.cost.metric}
        qualifier={{
          label: kpis.cost.qualifier,
          value: headline.costCoveragePct === null ? null : formatRatio(headline.costCoveragePct),
          absentLabel: kpis.cost.absent,
        }}
      />
      <MarginKpi
        testId="margin-kpi-margin"
        label={kpis.margin.label}
        value={format.money(headline.grossMargin, currency)}
        metric={kpis.margin.metric}
      />
      <MarginKpi
        testId="margin-kpi-margin-pct"
        label={kpis.marginPct.label}
        value={headline.marginPct === null ? null : formatRatio(headline.marginPct)}
        absentLabel={kpis.marginPct.absent}
        metric={kpis.marginPct.metric}
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
  const copy = useMessages('analytics').marginPanel;
  const format = useFormat();
  const plural = usePlural();
  const strong = { strong: (text: string) => <strong>{text}</strong> };
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
          eyebrow={copy.loading.eyebrow}
          title={copy.loading.title}
          message={copy.loading.message}
        />
      );
    }
    if (query.error || !data) {
      return (
        <ErrorState
          title={copy.error.title}
          message={query.error?.message ?? copy.error.message}
          action={<Button onClick={() => void query.refetch()}>{copy.error.retry}</Button>}
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
            <h2>{copy.missingCost.title}</h2>
            <p>{copy.missingCost.body}</p>
          </div>
          {uncovered.length > 0 ? (
            <div>
              <p className="analytics-margin__basis">
                {renderRich(copy.missingCost.bestSellers, strong)}
              </p>
              <ul className="analytics-margin__empty-list" data-testid="margin-missing-cost-list">
                {uncovered.map((item) => {
                  const slug = marginSlug(item.sku ?? item.productId);
                  return (
                    <li key={item.productId}>
                      <span>{item.name ?? copy.missingCost.unknownProduct}</span>
                      <span className="mono-text">
                        {item.sku
                          ? interpolate(copy.missingCost.skuAndAmount, {
                              sku: item.sku,
                              amount: format.money(item.netRevenue, data.currency),
                            })
                          : format.money(item.netRevenue, data.currency)}
                      </span>
                      <Link
                        className="button button--ghost button--sm"
                        to={`/products/${encodeURIComponent(item.productId)}`}
                        data-testid={`margin-add-cost-link-${slug}`}
                      >
                        {copy.missingCost.addCost}
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <p className="data-table__footnote">
                {plural(productsQuery.data?.total ?? uncovered.length, copy.missingCost.footnote)}
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
              {renderRich(copy.trendTitle, strong)}
            </p>
            <MarginTrendChart points={data.trend} currency={data.currency} />
          </div>
        ) : null}
        <div>
          <h4 className="section-title analytics-margin__subtitle">{copy.byChannel}</h4>
          <MarginByChannelTable
            channels={data.channels}
            headline={data.headline}
            currency={data.currency}
          />
          <p className="data-table__footnote">
            {copy.byChannelFootnote}
          </p>
        </div>
        <div>
          <div className="panel__header analytics-margin__subheader">
            <h4 className="section-title analytics-margin__subtitle">{copy.byProduct}</h4>
            <ExportCsvButton
              testId="export-csv-margin-product"
              reportLabel={copy.byProduct}
              request={{ report: 'margin-product', filters, sortBy: 'netRevenue' }}
              displayCurrency={displayCurrency}
              reportingCurrency={currency}
            />
          </div>
          {productsQuery.error ? (
            <ErrorState
              title={copy.byProductError}
              message={productsQuery.error.message}
              action={
                <Button onClick={() => void productsQuery.refetch()}>{copy.error.retry}</Button>
              }
            />
          ) : (
            <>
              <MarginByProductTable
                items={productsQuery.data?.items ?? []}
                currency={data.currency}
              />
              <p className="data-table__footnote">
                {interpolate(copy.byProductFootnote, { n: format.number(PRODUCT_LIMIT) })}
              </p>
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
          <p className="eyebrow">{copy.eyebrow}</p>
          <h3 className="section-title">{copy.title}</h3>
        </div>
        <ExportCsvButton
          testId="export-csv-margin-channel"
          reportLabel={copy.byChannel}
          request={exportRequestChannel}
          displayCurrency={displayCurrency}
          reportingCurrency={currency}
          disabledReason={
            noCostAtAll ? copy.exportDisabled : undefined
          }
        />
      </div>
      <p className="analytics-margin__basis">
        <span className="chip chip--info">{copy.basisChip}</span>
        {pageBasis === 'gross' ? copy.basisGross : copy.basis}
        {currency ? ` ${interpolate(copy.currency, { currency })}` : ''}
      </p>
      {renderBody()}
    </article>
  );
}
