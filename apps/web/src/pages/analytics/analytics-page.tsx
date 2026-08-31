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
  AnalyticsConvertNote,
  AnalyticsCurrencyPicker,
  AnalyticsDataCoveragePanel,
  AnalyticsDateRangeToolbar,
  AnalyticsDegradationBanner,
  AnalyticsKpiStrip,
  AnalyticsNeedsAttention,
  AnalyticsSettingsDialog,
  AnalyticsTrustHeader,
  ChannelSalesTable,
  ProductSalesTable,
  computePresetRange,
  toExclusiveEndInstant,
  useAnalyticsTrustQuery,
  useSalesAnalyticsQuery,
  type DisplayCurrencyRateBasis,
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
      setSearchParams({ from, to }, { replace: true });
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
    setSearchParams({ from: nextFrom, to: nextTo });
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

  return (
    <PageLayout
      eyebrow="Operations"
      title="Analytics"
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
          <AnalyticsCurrencyPicker
            reportingCurrency={reportingCurrency}
            displayCurrency={displayCurrency}
            onChange={handleDisplayCurrencyChange}
          />
        }
      />
      <AnalyticsConvertNote filters={salesFilters} onSwitchBack={() => handleDisplayCurrencyChange(null)} />

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
              <AnalyticsKpiStrip filters={salesFilters} connections={trustQuery.data.connections} />
              <ChannelSalesTable filters={salesFilters} />
              <ProductSalesTable filters={salesFilters} />
            </>
          )}
          {/* Coverage gaps and stock-at-risk are listing facts, not order
              facts, so they render regardless of ingestion status — a fresh
              install with a full catalogue and no orders yet is exactly
              when they matter most (#2120 review, SUGGESTION). Both this
              section and the data-coverage header below it render
              unconditionally, after the order-derived figures above. */}
          <AnalyticsNeedsAttention />
          <AnalyticsDataCoveragePanel filters={coverageFilters} onOpenSettings={() => setSettingsDialogOpen(true)} />
          <AnalyticsTrustHeader connections={trustQuery.data.connections} />
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
