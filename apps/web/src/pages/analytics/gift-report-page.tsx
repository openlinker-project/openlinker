/**
 * Gift Report Page (#3943, mockup `report/*`)
 *
 * `/analytics/gifts` - one report, filters on top: how many gifts were given,
 * what they cost (net purchase cost, per promotion and per manual add), how
 * bundles sell and what they draw from stock. The range and filters live in the
 * URL so a view can be linked. The accountant's per-customer CSV hangs off the
 * same range.
 *
 * @module apps/web/src/pages/analytics
 */
import { useMemo, useRef, type ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AnalyticsDateRangeToolbar, computePresetRange } from '../../features/analytics';
import {
  GIFT_REPORT_SOURCE_VALUES,
  GiftBundleView,
  GiftCostTable,
  GiftExportPanel,
  GiftTotals,
  useGiftReportQuery,
  type GiftReportFilters,
  type GiftReportSource,
} from '../../features/gift-report';
import { useConnectionsQuery } from '../../features/connections';
import { useMessages } from '../../shared/i18n';
import { PageLayout } from '../../shared/ui/page-layout';
import { SegmentedControl } from '../../shared/ui/segmented-control';
import { Select } from '../../shared/ui/select';
import { EmptyState, ErrorState, LoadingState } from '../../shared/ui/feedback-state';

type GiftView = 'gifts' | 'bundles' | 'movements';
const VIEWS: readonly GiftView[] = ['gifts', 'bundles', 'movements'];

function isView(value: string | null): value is GiftView {
  return value !== null && (VIEWS as readonly string[]).includes(value);
}

function isSource(value: string | null): value is GiftReportSource {
  return value !== null && (GIFT_REPORT_SOURCE_VALUES as readonly string[]).includes(value);
}

export function GiftReportPage(): ReactElement {
  const copy = useMessages('gift-report');
  const [searchParams, setSearchParams] = useSearchParams();
  const defaultRange = useRef(computePresetRange('30d', new Date())).current;
  const from = searchParams.get('from') ?? defaultRange.from;
  const to = searchParams.get('to') ?? defaultRange.to;
  const viewParam = searchParams.get('view');
  const view: GiftView = isView(viewParam) ? viewParam : 'gifts';
  const sourceParam = searchParams.get('source');
  const connectionsQuery = useConnectionsQuery();

  const filters: GiftReportFilters = useMemo(
    () => ({
      from,
      to,
      ...(searchParams.get('channel') ? { sourceConnectionId: searchParams.get('channel') as string } : {}),
      ...(isSource(sourceParam) ? { giftSource: sourceParam } : {}),
    }),
    [from, to, searchParams, sourceParam]
  );

  function patch(update: (next: URLSearchParams) => void): void {
    const next = new URLSearchParams(searchParams);
    update(next);
    setSearchParams(next);
  }

  const report = useGiftReportQuery(filters, { enabled: view === 'gifts' });

  const toolbar = (
    <div className="toolbar analytics-toolbar">
      <AnalyticsDateRangeToolbar
        from={from}
        to={to}
        onApply={(nextFrom, nextTo) =>
          patch((next) => {
            next.set('from', nextFrom);
            next.set('to', nextTo);
          })
        }
      />
      <div className="toolbar__group">
        <SegmentedControl<GiftView>
          aria-label={copy.title}
          value={view}
          onChange={(value) => patch((next) => next.set('view', value))}
          options={VIEWS.map((value) => ({
            value,
            label: copy.views[value],
            'data-testid': `gift-report-view-${value}`,
          }))}
        />
      </div>
      {view === 'gifts' ? (
        <div className="toolbar__group">
          <label className="analytics-toolbar__field">
            <span className="analytics-toolbar__label">{copy.filters.channel}</span>
            <Select
              data-testid="gift-report-filter-channel"
              value={searchParams.get('channel') ?? ''}
              onChange={(event) =>
                patch((next) => {
                  if (event.target.value === '') next.delete('channel');
                  else next.set('channel', event.target.value);
                })
              }
            >
              <option value="">{copy.filters.allChannels}</option>
              {(connectionsQuery.data ?? []).map((connection) => (
                <option key={connection.id} value={connection.id}>
                  {connection.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="analytics-toolbar__field">
            <span className="analytics-toolbar__label">{copy.filters.source}</span>
            <Select
              data-testid="gift-report-filter-source"
              value={isSource(sourceParam) ? sourceParam : ''}
              onChange={(event) =>
                patch((next) => {
                  if (event.target.value === '') next.delete('source');
                  else next.set('source', event.target.value);
                })
              }
            >
              <option value="">{copy.filters.allSources}</option>
              <option value="rule">{copy.filters.rule}</option>
              <option value="manual">{copy.filters.manual}</option>
            </Select>
          </label>
        </div>
      ) : null}
    </div>
  );

  let body: ReactElement;
  if (view === 'bundles') {
    body = <GiftBundleView filters={filters} />;
  } else if (view === 'movements') {
    const params = new URLSearchParams({ type: 'gift', from, to });
    body = (
      <div data-testid="gift-report-move-table">
        <p>{copy.movements.body}</p>
        <Link to={`/inventory/movements?${params.toString()}`} data-testid="gift-report-filter-movement">
          {copy.movements.open}
        </Link>
      </div>
    );
  } else if (report.isPending) {
    body = <LoadingState title={copy.title} message={copy.description} />;
  } else if (report.isError) {
    body = <ErrorState title={copy.error} message={copy.error} />;
  } else if (report.data.groups.length === 0) {
    body = (
      <div data-testid="gift-report-empty">
        <EmptyState title={copy.empty.title} message={copy.empty.body} />
      </div>
    );
  } else {
    body = (
      <>
        <GiftTotals totals={report.data.totals} />
        <GiftCostTable groups={report.data.groups} />
      </>
    );
  }

  return (
    <PageLayout
      eyebrow={copy.eyebrow}
      title={<span data-testid="gift-report-title">{copy.title}</span>}
      description={copy.description}
      actions={<GiftExportPanel filters={filters} />}
    >
      {toolbar}
      {body}
    </PageLayout>
  );
}
