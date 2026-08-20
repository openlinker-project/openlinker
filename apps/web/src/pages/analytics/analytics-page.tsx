/**
 * Analytics Page
 *
 * The /analytics route shell (#1986): page scaffold, date-range control,
 * the trust/data-coverage disclosure, the needs-attention section (#1989),
 * and the sales KPI strip / by-channel table (#1990). Section #1991 will
 * mount alongside. Ships zero revenue/order metrics of its own — see
 * docs/plans/implementation-plan-analytics-page-shell.md,
 * docs/plans/implementation-plan-analytics-needs-attention.md, and
 * docs/plans/implementation-plan-sales-channel-aggregates.md.
 *
 * @module apps/web/src/pages/analytics
 */
import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AnalyticsDateRangeToolbar,
  AnalyticsDegradationBanner,
  AnalyticsKpiStrip,
  AnalyticsNeedsAttention,
  AnalyticsTrustHeader,
  ChannelSalesTable,
  computePresetRange,
  ProductSalesTable,
  useAnalyticsTrustQuery,
  type SalesAnalyticsFilters,
} from '../../features/analytics';
import { Button, EmptyState, ErrorState, LoadingState } from '../../shared/ui';

export function AnalyticsPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
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

  // Built once per from/to so `AnalyticsKpiStrip` and `ChannelSalesTable`
  // share a byte-identical query key and therefore one network request —
  // and so a channel-table failure can never blank the KPI strip: they
  // render independently even though they fetch from the same cache entry.
  const salesFilters: SalesAnalyticsFilters = useMemo(() => ({ from, to }), [from, to]);

  return (
    <section className="page-section">
      <div className="page-header">
        <div className="page-header__content">
          <p className="eyebrow">Operations</p>
          <h2 className="page-title">Analytics</h2>
          <p className="page-description">
            Sales across connected channels, with clear data coverage.
          </p>
        </div>
      </div>

      <AnalyticsDateRangeToolbar from={from} to={to} onApply={handleApply} />

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
          <AnalyticsTrustHeader connections={trustQuery.data.connections} />
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
              <AnalyticsNeedsAttention />
              <AnalyticsKpiStrip filters={salesFilters} />
              <ChannelSalesTable filters={salesFilters} />
              <ProductSalesTable filters={salesFilters} />
            </>
          )}
        </>
      ) : null}
    </section>
  );
}
