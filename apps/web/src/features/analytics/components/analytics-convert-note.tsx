/**
 * Analytics Convert Note
 *
 * Renders the four ADR-064 display-currency states (native/converting/
 * converted/unavailable) beneath the toolbar. Reuses the same
 * `useSalesAnalyticsQuery` cache entry the KPI strip reads (identical query
 * key — see `analytics-page.tsx`), so selecting a currency costs no extra
 * request beyond the one the strip already issues.
 *
 * @module apps/web/src/features/analytics/components
 */
import type { ReactElement } from 'react';
import { Alert, Button } from '../../../shared/ui';
import { useSalesAnalyticsQuery } from '../hooks/use-sales-analytics-query';
import { resolveConvertNoteState } from '../lib/display-currency.lib';
import type { SalesAnalyticsFilters } from '../api/sales-analytics.types';

interface AnalyticsConvertNoteProps {
  filters: SalesAnalyticsFilters;
  onSwitchBack: () => void;
}

export function AnalyticsConvertNote({ filters, onSwitchBack }: AnalyticsConvertNoteProps): ReactElement | null {
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

  const conversion = query.data?.headline.displayCurrencyConversion;
  const unresolved = conversion?.unresolvedNativeCurrencies ?? [];

  return (
    <Alert
      tone="info"
      action={
        <Button type="button" tone="ghost" className="button--sm" onClick={onSwitchBack}>
          Switch back
        </Button>
      }
    >
      Converted to {filters.displayCurrency} — preview only, nothing saved.
      {unresolved.length > 0 && (
        <span>
          {' '}
          Couldn&rsquo;t convert orders in {unresolved.join(', ')} — excluded from this total.
        </span>
      )}
    </Alert>
  );
}
