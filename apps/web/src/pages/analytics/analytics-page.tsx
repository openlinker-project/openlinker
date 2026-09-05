/**
 * Analytics Page
 *
 * The /analytics route shell (#1986): page scaffold, date-range control,
 * the trust/data-coverage disclosure, the needs-attention section (#1989),
 * the sales KPI strip / by-channel table (#1990), and the top-products
 * table (#1991). Ships zero revenue/order metrics of its own — see
 * docs/plans/implementation-plan-analytics-page-shell.md,
 * docs/plans/implementation-plan-analytics-needs-attention.md,
 * docs/plans/implementation-plan-sales-channel-aggregates.md, and
 * docs/plans/implementation-plan-top-products-table.md.
 *
 * @module apps/web/src/pages/analytics
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ANALYTICS_DATA_COVERAGE_ANCHOR_ID,
  AnalyticsConvertNote,
  AnalyticsCoverageAlertBadge,
  AnalyticsCurrencyPicker,
  AnalyticsDataCoveragePanel,
  AnalyticsDateRangeToolbar,
  AnalyticsDegradationBanner,
  AnalyticsKpiStrip,
  AnalyticsMoneyBasisToggle,
  AnalyticsNeedsAttention,
  AnalyticsSettingsDialog,
  AnalyticsTrustHeader,
  ChannelSalesTable,
  ProductSalesTable,
  computePresetRange,
  parseMoneyBasis,
  toExclusiveEndInstant,
  useAnalyticsCoverageQuery,
  useAnalyticsTrustQuery,
  useSalesAnalyticsQuery,
  type CoverageCategory,
  type DisplayCurrencyRateBasis,
  type MoneyBasis,
  type SalesAnalyticsFilters,
} from '../../features/analytics';
import { Button, EmptyState, ErrorState, LoadingState, PageLayout } from '../../shared/ui';

export function AnalyticsPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  // Frozen once per mount rather than re-read on every render: a dashboard
  // left open overnight keeps deriving "30d"/"7d" from the day it was
  // opened, which is preferable to the preset ranges silently shifting
  // under an operator mid-session (#2098 tech review).
  const today = useRef(new Date()).current;
  const defaultRange = useRef(computePresetRange('30d', today)).current;

  const from = searchParams.get('from') ?? defaultRange.from;
  const to = searchParams.get('to') ?? defaultRange.to;

  // A first-ever visit carries no from/to — write the resolved defaults into
  // the URL so the resting state ("30d is lit") is a real, shareable link,
  // not an implicit fallback that only exists in memory.
  useEffect(() => {
    if (!searchParams.get('from') || !searchParams.get('to')) {
      const next = new URLSearchParams(searchParams);
      next.set('from', from);
      next.set('to', to);
      setSearchParams(next, { replace: true });
    }
    // Deliberate `[]`: this project's ESLint config carries no
    // `react-hooks/exhaustive-deps` rule (verified via `pnpm lint` — an
    // unrecognized-rule disable directive itself errors), so there is no
    // suppression to add. Runs once on mount only; from/to/searchParams/
    // setSearchParams already reflect the resolved defaults, and re-running
    // on their change would fight the user's own subsequent Apply/preset
    // navigation.
  }, []);

  function handleApply(nextFrom: string, nextTo: string): void {
    // Merge onto the existing params, never replace wholesale — `from`/`to`
    // are not the only state this URL carries (ADR-064: `displayCurrency` /
    // `rateBasis` are URL-encoded "like the existing date-range filter"), and
    // a literal-object `setSearchParams` call drops every other param.
    const next = new URLSearchParams(searchParams);
    next.set('from', nextFrom);
    next.set('to', nextTo);
    setSearchParams(next);
  }

  const trustQuery = useAnalyticsTrustQuery();

  // `null` means no override — the dashboard renders in the reporting
  // currency (#2472, ADR-064). Read raw rather than derived-from-settings:
  // the choice lives in the URL like the date range, never in a saved
  // preference (that's `AnalyticsSettingsView`, a different axis).
  const displayCurrency = searchParams.get('displayCurrency');
  const rateBasis: DisplayCurrencyRateBasis =
    searchParams.get('rateBasis') === 'order-date' ? 'order-date' : 'current-rate';

  function handleDisplayCurrencyChange(
    nextDisplayCurrency: string | null,
    nextRateBasis: DisplayCurrencyRateBasis = rateBasis
  ): void {
    const next = new URLSearchParams(searchParams);
    if (nextDisplayCurrency) {
      next.set('displayCurrency', nextDisplayCurrency);
      next.set('rateBasis', nextRateBasis);
    } else {
      next.delete('displayCurrency');
      next.delete('rateBasis');
    }
    setSearchParams(next);
  }

  // Net/Gross page-level view preference (#2895) — URL state, matching the
  // `displayCurrency`/`rateBasis` pattern above. `parseMoneyBasis` resolves
  // an absent/unrecognized param to `net` — see `money-basis.lib.ts`'s own
  // doc comment for why the default is `net`, not `gross`.
  const basis: MoneyBasis = parseMoneyBasis(searchParams.get('basis'));

  function handleBasisChange(nextBasis: MoneyBasis): void {
    const next = new URLSearchParams(searchParams);
    next.set('basis', nextBasis);
    setSearchParams(next);
  }

  // Built once per from/to/displayCurrency/rateBasis so `AnalyticsKpiStrip`,
  // `ChannelSalesTable` and `AnalyticsConvertNote` share a byte-identical
  // query key and therefore one network request — and so a channel-table
  // failure can never blank the KPI strip: they render independently even
  // though they fetch from the same cache entry.
  const salesFilters: SalesAnalyticsFilters = useMemo(
    () => ({ from, to, ...(displayCurrency ? { displayCurrency, rateBasis } : {}) }),
    [from, to, displayCurrency, rateBasis]
  );

  // Reads the same cache entry `AnalyticsKpiStrip` populates (byte-identical
  // query key) — no extra request. `headline.currency` is the TRUE system
  // reporting currency these figures are stamped in, open to every
  // authenticated user (unlike `GET /currency-settings`, which is
  // admin-only). This must not be read from `AnalyticsSettingsView.
  // displayCurrency` — that field resolves to an operator-saved *view*
  // default when one exists, which is a different axis and would mislabel
  // the "native" option the moment an admin sets a non-default preference.
  const salesQuery = useSalesAnalyticsQuery(salesFilters);
  const reportingCurrency = salesQuery.data?.headline.currency ?? null;

  // Same range as `salesFilters`, converted to the ISO-instant shape
  // `GET /analytics/coverage` expects (#2473).
  const coverageFilters = useMemo(
    () => ({ from: new Date(`${from}T00:00:00.000Z`).toISOString(), to: toExclusiveEndInstant(to) }),
    [from, to]
  );

  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);

  // Reads the SAME cache entry `AnalyticsDataCoveragePanel` populates
  // internally (byte-identical query key) — no extra request, same pattern
  // `salesQuery` above already establishes. Owning it at the page level is
  // what lets the KPI strip's `GapMark`s and the channel table's
  // `AnalyticsExclusionNote`s open the panel's own detail modals (#2474
  // Phase 7 → #2480/#2481, epic #2452 Phase 8) without a second
  // `CoverageDetailDialog` implementation.
  const coverageQuery = useAnalyticsCoverageQuery(coverageFilters);
  const [openCoverageCategory, setOpenCoverageCategory] = useState<CoverageCategory | null>(null);

  return (
    <PageLayout
      eyebrow="Operations"
      title={
        <>
          Analytics <AnalyticsCoverageAlertBadge categories={coverageQuery.data?.categories} />
        </>
      }
      description="Sales across connected channels, with clear data coverage."
      actions={
        <Button type="button" tone="secondary" onClick={() => setSettingsDialogOpen(true)}>
          Analytics settings
        </Button>
      }
    >
      <AnalyticsDateRangeToolbar
        from={from}
        to={to}
        onApply={handleApply}
        trailing={
          <>
            <AnalyticsMoneyBasisToggle basis={basis} onChange={handleBasisChange} />
            <AnalyticsCurrencyPicker
              reportingCurrency={reportingCurrency}
              displayCurrency={displayCurrency}
              onChange={handleDisplayCurrencyChange}
            />
          </>
        }
      />
      <AnalyticsConvertNote
        filters={salesFilters}
        coverage={coverageQuery.data}
        onSwitchBack={() => handleDisplayCurrencyChange(null)}
      />

      {trustQuery.isLoading ? (
        <LoadingState title="Loading data coverage" message="Checking ingestion status…" />
      ) : trustQuery.error ? (
        <ErrorState
          title="Unable to load data coverage"
          message={trustQuery.error.message}
          action={
            <Button type="button" onClick={() => void trustQuery.refetch()}>
              Retry
            </Button>
          }
        />
      ) : trustQuery.data && trustQuery.data.connections.length === 0 ? (
        <EmptyState
          title="Connect a sales channel to see figures here"
          message="This page reports the orders OpenLinker has ingested. Once a marketplace or shop is connected and its first orders arrive, figures appear here without further setup."
          action={
            <Link className="button button--primary" to="/connections/new">
              Add a connection
            </Link>
          }
        />
      ) : trustQuery.data ? (
        <>
          <AnalyticsDegradationBanner connections={trustQuery.data.connections} />
          {trustQuery.data.connections.every((entry) => entry.status === 'never-ingested') ? (
            <EmptyState
              title="First orders are still arriving"
              message="Nothing is missing; it is not here yet. Figures will appear as orders land."
              action={
                <Link className="button button--secondary" to="/cursors">
                  View sync progress
                </Link>
              }
            />
          ) : (
            <>
              <AnalyticsKpiStrip
                filters={salesFilters}
                connections={trustQuery.data.connections}
                coverage={coverageQuery.data}
                onOpenCategory={setOpenCoverageCategory}
                basis={basis}
              />
              <ChannelSalesTable
                filters={salesFilters}
                coverage={coverageQuery.data}
                coverageFilters={coverageFilters}
                onOpenCategory={setOpenCoverageCategory}
                basis={basis}
              />
              <ProductSalesTable
                filters={salesFilters}
                coverage={coverageQuery.data}
                coverageFilters={coverageFilters}
                onOpenCategory={setOpenCoverageCategory}
                basis={basis}
              />
            </>
          )}
          {/* Coverage gaps and stock-at-risk are listing facts, not order
              facts, so they render regardless of ingestion status — a fresh
              install with a full catalogue and no orders yet is exactly
              when they matter most (#2120 review, SUGGESTION). This section
              and the Data Coverage panel below render unconditionally,
              after the order-derived figures above. */}
          <AnalyticsNeedsAttention />
          <AnalyticsTrustHeader connections={trustQuery.data.connections} />
          {/* Deliberately the LAST section on the page: an operator reads
              revenue/channel/product figures first, and only then the
              detail behind any coverage gap. The title-adjacent
              `AnalyticsCoverageAlertBadge` is the way back here without
              scrolling past everything above when something needs action. */}
          <div id={ANALYTICS_DATA_COVERAGE_ANCHOR_ID}>
            <AnalyticsDataCoveragePanel
              filters={coverageFilters}
              onOpenSettings={() => setSettingsDialogOpen(true)}
              openCategory={openCoverageCategory}
              onOpenCategoryChange={setOpenCoverageCategory}
            />
          </div>
        </>
      ) : null}

      <AnalyticsSettingsDialog
        open={settingsDialogOpen}
        onOpenChange={setSettingsDialogOpen}
        displayCurrency={displayCurrency}
        rateBasis={rateBasis}
        reportingCurrency={reportingCurrency}
        onApplyView={handleDisplayCurrencyChange}
        coverageFilters={coverageFilters}
      />
    </PageLayout>
  );
}
