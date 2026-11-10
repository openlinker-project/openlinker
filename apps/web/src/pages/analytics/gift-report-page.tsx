/**
 * Gift Report Page (#3943, redesign #3935)
 *
 * `/analytics/gifts` - one report, filters on top: how many gifts were given,
 * what they cost (net purchase cost, per promotion and per gift product, week by
 * week), how bundles sell and what they draw from stock. The range and filters
 * live in the URL so a view can be linked. The accountant's per-customer CSV
 * hangs off the same range. A gift with no purchase cost is named, never counted
 * as free.
 *
 * @module apps/web/src/pages/analytics
 */
import { useMemo, useRef, useState, type ReactElement } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { computePresetRange } from '../../features/analytics';
import {
  GIFT_REPORT_SOURCE_VALUES,
  GiftBundleView,
  GiftCostChart,
  GiftCostTable,
  GiftExportDialog,
  GiftReportKpis,
  useGiftReportGuide,
  useGiftReportQuery,
  type GiftGrouping,
  type GiftReportFilters,
  type GiftReportSource,
} from '../../features/gift-report';
import { useConnectionsQuery } from '../../features/connections';
import { interpolate, useActiveLocale, useMessages, getBcp47Locale } from '../../shared/i18n';
import { Button } from '../../shared/ui/button';
import { EmptyState, ErrorState, LoadingState } from '../../shared/ui/feedback-state';
import { GuideButton, PageGuide } from '../../shared/ui/guide-drawer';
import { PageLayout } from '../../shared/ui/page-layout';
import { SegmentedControl } from '../../shared/ui/segmented-control';
import { Select } from '../../shared/ui/select';
import { StatusTabs } from '../../shared/ui/status-tabs';

type GiftView = 'gifts' | 'bundles' | 'movements';
type Preset = '7d' | '30d' | '90d';
const PRESETS: readonly Preset[] = ['7d', '30d', '90d'];

function isSource(value: string | null): value is GiftReportSource {
  return value !== null && (GIFT_REPORT_SOURCE_VALUES as readonly string[]).includes(value);
}

export function GiftReportPage(): ReactElement {
  const copy = useMessages('gift-report');
  const navigate = useNavigate();
  const locale = useActiveLocale();
  const tag = getBcp47Locale(locale);
  const guideCopy = useGiftReportGuide();
  const [searchParams, setSearchParams] = useSearchParams();
  const [by, setBy] = useState<GiftGrouping>('promotion');
  const [exporting, setExporting] = useState(false);
  const today = useRef(new Date()).current;
  const defaultRange = useRef(computePresetRange('30d', today)).current;
  const from = searchParams.get('from') ?? defaultRange.from;
  const to = searchParams.get('to') ?? defaultRange.to;
  const view: GiftView = searchParams.get('view') === 'bundles' ? 'bundles' : 'gifts';
  const sourceParam = searchParams.get('source');
  const channel = searchParams.get('channel');
  const connectionsQuery = useConnectionsQuery();

  const filters: GiftReportFilters = useMemo(
    () => ({
      from,
      to,
      ...(channel ? { sourceConnectionId: channel } : {}),
      ...(isSource(sourceParam) ? { giftSource: sourceParam } : {}),
    }),
    [from, to, channel, sourceParam],
  );

  function patch(update: (next: URLSearchParams) => void): void {
    const next = new URLSearchParams(searchParams);
    update(next);
    setSearchParams(next);
  }

  const activePreset = PRESETS.find((preset) => {
    const range = computePresetRange(preset, today);
    return range.from === from && range.to === to;
  });
  const rangeText = ((): string => {
    const short = new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'short' });
    const long = new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'short', year: 'numeric' });
    return `${short.format(new Date(`${from}T12:00:00`))} – ${long.format(new Date(`${to}T12:00:00`))}`;
  })();

  const report = useGiftReportQuery(filters, { enabled: view === 'gifts' });
  const filtered = channel !== null || isSource(sourceParam);

  function clearFilters(): void {
    patch((next) => {
      next.delete('channel');
      next.delete('source');
    });
  }

  function goTab(next: GiftView | null): void {
    if (next === 'movements') {
      const params = new URLSearchParams({ type: 'gift', from, to });
      void navigate(`/inventory/movements?${params.toString()}`);
      return;
    }
    patch((params) => {
      if (next === 'bundles') params.set('view', 'bundles');
      else params.delete('view');
    });
  }

  let body: ReactElement;
  if (view === 'bundles') {
    body = <GiftBundleView filters={filters} />;
  } else if (report.isPending) {
    body = <LoadingState title={copy.title} message={copy.description} />;
  } else if (report.isError) {
    body = <ErrorState title={copy.error} message={copy.error} />;
  } else if (report.data.groups.length === 0) {
    body = (
      <div data-testid="gift-report-empty">
        <EmptyState
          title={copy.empty.title}
          message={copy.empty.body}
          action={
            filtered ? (
              <Button tone="secondary" className="button--sm" onClick={clearFilters}>
                {copy.empty.clear}
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  } else {
    const unknown = report.data.totals.reduce((sum, total) => sum + total.unknownCostUnits, 0);
    body = (
      <div className="gift-report">
        <GiftReportKpis totals={report.data.totals} />
        {unknown > 0 ? (
          <div className="gift-note gift-note--warn" data-testid="gift-report-unknown-alert">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="6.2" />
              <path d="M8 7.2V11M8 5v.1" />
            </svg>
            <span>
              <b>{interpolate(copy.unknown.title, { n: unknown })}.</b> {copy.unknown.body}{' '}
              <Link className="link" to="/products">
                {copy.unknown.link}
              </Link>
            </span>
          </div>
        ) : null}
        {report.data.series.map((series) => (
          <GiftCostChart key={series.currency ?? 'none'} series={series} />
        ))}
        <GiftCostTable groups={report.data.groups} by={by} onByChange={setBy} />
        <p className="form-field__description gift-report__foot">
          {copy.movements.footBefore}
          <Link
            className="link"
            to={`/inventory/movements?${new URLSearchParams({ type: 'gift', from, to }).toString()}`}
            data-testid="gift-report-filter-movement"
          >
            {copy.movements.footLink}
          </Link>
          {copy.movements.footAfter}
        </p>
      </div>
    );
  }

  return (
    <PageGuide
      title={guideCopy.title}
      lede={guideCopy.lede}
      sections={guideCopy.sections}
      defaultOpen={guideCopy.defaultOpen}
    >
    <PageLayout
      eyebrow={copy.eyebrow}
      title={<span data-testid="gift-report-title">{copy.title}</span>}
      description={copy.description}
      actions={
        <>
          <GuideButton label={copy.guideButton} />
          <Button className="button--sm" data-testid="gift-report-export" onClick={() => setExporting(true)}>
            <svg className="gift-dl-ico" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />
            </svg>
            {copy.export.button}
          </Button>
        </>
      }
    >
      <div className="list-statusbar">
        <StatusTabs<GiftView>
          hideCounts
          aria-label={copy.viewsAria}
          value={view}
          onChange={goTab}
          tabs={[
            { key: 'gifts', label: copy.views.gifts },
            { key: 'bundles', label: copy.views.bundles },
            { key: 'movements', label: copy.views.movements },
          ]}
        />
      </div>
      <div className="gift-filters">
        <SegmentedControl<Preset>
          aria-label={copy.filters.period}
          value={activePreset ?? null}
          onChange={(preset) =>
            patch((next) => {
              const range = computePresetRange(preset, today);
              next.set('from', range.from);
              next.set('to', range.to);
            })
          }
          options={PRESETS.map((preset) => ({ value: preset, label: copy.filters.days[preset] }))}
        />
        <span className="gift-filters__range">{rangeText}</span>
        <Select
          className="gift-filters__select"
          aria-label={copy.filters.channel}
          data-testid="gift-report-filter-channel"
          value={channel ?? ''}
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
        {view === 'gifts' ? (
          <SegmentedControl<'all' | GiftReportSource>
            aria-label={copy.filters.source}
            value={isSource(sourceParam) ? sourceParam : 'all'}
            onChange={(value) =>
              patch((next) => {
                if (value === 'all') next.delete('source');
                else next.set('source', value);
              })
            }
            options={[
              { value: 'all', label: copy.filters.allSources, 'data-testid': 'gift-report-filter-source' },
              { value: 'rule', label: copy.filters.rule },
              { value: 'manual', label: copy.filters.manual },
            ]}
          />
        ) : null}
      </div>
      {body}
      <GiftExportDialog open={exporting} onOpenChange={setExporting} filters={filters} />
    </PageLayout>
    </PageGuide>
  );
}
