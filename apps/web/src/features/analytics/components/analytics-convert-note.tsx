/**
 * Analytics Convert Note
 *
 * Renders the four ADR-064 display-currency states (native/converting/
 * converted/unavailable) beneath the toolbar. Reuses the same
 * `useSalesAnalyticsQuery` cache entry the KPI strip reads (identical query
 * key — see `analytics-page.tsx`), so selecting a currency costs no extra
 * request beyond the one the strip already issues.
 *
 * Two things fixed after live review:
 *
 * 1. **The "Converted" claim was shown even while a currency recalculation
 *    run was actively rewriting the very figures being converted** — the
 *    banner said "Converted to EUR" (a past-tense success claim) directly
 *    above KPI cards reading "Recalculating…". Both can be true at once
 *    (the picker converts whatever the backend currently reports, and the
 *    backend's own numbers are mid-flight), but presenting them side by
 *    side without saying so reads as a contradiction. This component now
 *    takes the same `coverage` prop the KPI strip/tables read and, when the
 *    `currency` category is `in-progress`, replaces the "Converted" claim
 *    with an explicit in-progress note instead.
 * 2. **One generic message covered both rate-basis modes**, which compute
 *    genuinely different things (`current-rate`: today's live rate applied
 *    to each order's own native currency, summed; `order-date`: today's
 *    live rate applied ONCE to the already-summed reporting-currency total
 *    — despite the name, this does NOT use each order's historical rate,
 *    see ADR-064 decision 2). Silently saying "Converted to EUR" for both
 *    implied they answer the same question. The copy now names which mode
 *    produced the figure, matching the labels the Analytics Settings dialog
 *    itself uses ("Current rate" / "Rate on order date").
 *
 * @module apps/web/src/features/analytics/components
 */
import type { ReactElement } from 'react';
import { Alert, Button } from '../../../shared/ui';
import { useSalesAnalyticsQuery } from '../hooks/use-sales-analytics-query';
import { isCurrencyRecalculating, resolveConvertNoteState } from '../lib/display-currency.lib';
import type { SalesAnalyticsFilters } from '../api/sales-analytics.types';
import type { AnalyticsCoverage } from '../api/analytics-coverage.types';

interface AnalyticsConvertNoteProps {
  filters: SalesAnalyticsFilters;
  /** Same Data Coverage aggregate `AnalyticsKpiStrip`/`ChannelSalesTable`/`ProductSalesTable` read — no extra request when the page fetches it once. */
  coverage?: AnalyticsCoverage;
  onSwitchBack: () => void;
}

export function AnalyticsConvertNote({
  filters,
  coverage,
  onSwitchBack,
}: AnalyticsConvertNoteProps): ReactElement | null {
  const query = useSalesAnalyticsQuery(filters, { enabled: Boolean(filters.displayCurrency) });
  const state = resolveConvertNoteState({
    displayCurrency: filters.displayCurrency ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    data: query.data,
  });

  if (state === 'native' || !filters.displayCurrency) {
    return null;
  }

  if (state === 'converting') {
    return (
      <Alert tone="info">Converting to {filters.displayCurrency}…</Alert>
    );
  }

  if (state === 'unavailable') {
    return (
      <Alert
        tone="warning"
        action={
          <Button type="button" tone="secondary" className="button--sm" onClick={() => void query.refetch()}>
            Try again
          </Button>
        }
      >
        Couldn&rsquo;t get today&rsquo;s {filters.displayCurrency} rate. Showing the reporting currency instead.
      </Alert>
    );
  }

  const currencyRecalculating = isCurrencyRecalculating(coverage);

  if (currencyRecalculating) {
    return (
      <Alert tone="info">
        A currency recalculation is running for this range — the {filters.displayCurrency} conversion will
        reflect the updated figures once it completes.
      </Alert>
    );
  }

  const conversion = query.data?.headline.displayCurrencyConversion;
  const unresolved = conversion?.unresolvedNativeCurrencies ?? [];
  const rateBasis = filters.rateBasis ?? 'current-rate';
  const modeLabel = rateBasis === 'order-date' ? 'Rate on order date' : 'Current rate';
  const modeExplanation =
    rateBasis === 'order-date'
      ? "today's live rate applied once to the already-summed reporting-currency total"
      : "today's live rate applied to each order's own native currency, then summed";

  return (
    <Alert
      tone="info"
      action={
        <Button type="button" tone="ghost" className="button--sm" onClick={onSwitchBack}>
          Switch back
        </Button>
      }
    >
      <strong>{modeLabel}:</strong> converted to {filters.displayCurrency} — {modeExplanation}. Preview only,
      nothing saved.
      {unresolved.length > 0 && (
        <span>
          {' '}
          Couldn&rsquo;t convert orders in {unresolved.join(', ')} — excluded from this total.
        </span>
      )}
    </Alert>
  );
}
