/**
 * Analytics Page
 *
 * The /analytics route shell (#1986): page scaffold, date-range control,
 * and the trust/data-coverage disclosure every other /analytics section
 * (#1989, #1990, #1991) will mount alongside. Ships zero revenue/order
 * metrics — see docs/plans/implementation-plan-analytics-page-shell.md.
 *
 * @module apps/web/src/pages/analytics
 */
import { useEffect, useRef, type ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AnalyticsDateRangeToolbar,
  AnalyticsDegradationBanner,
  AnalyticsTrustHeader,
  computePresetRange,
  useAnalyticsTrustQuery,
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

  return (
    <PageLayout
      eyebrow="Operations"
      title="Analytics"
      description="Sales across connected channels, with clear data coverage."
    >
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
          ) : null}
        </>
      ) : null}
    </PageLayout>
  );
}
