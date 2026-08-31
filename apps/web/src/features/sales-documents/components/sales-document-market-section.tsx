/**
 * SalesDocumentMarketSection (#2540)
 *
 * The settings page's scannable market list: one row per market, sorted so a
 * market needing a decision sorts above a settled one. Reads the single
 * merged `useSalesDocumentMarketsQuery` snapshot — the summary sentence
 * (#2541), the detected-market suggested-setup wording (#2542) and the
 * loading skeleton (#2543) build on this same query in later slices of the
 * same mini-epic.
 *
 * `onSelectCountry` is the existing seam `SalesDocumentCountryIndex` already
 * uses (#2187) — this section's action buttons resolve to the same
 * per-country routing dialog, so a market discovered here and a market
 * discovered through the older configured-countries table land on identical
 * configuration UI.
 *
 * @module apps/web/src/features/sales-documents/components
 */
import type { ReactElement } from 'react';
import { EmptyState, ErrorState, LoadingState } from '../../../shared/ui/feedback-state';
import { useSalesDocumentMarketsQuery } from '../hooks/use-sales-document-markets-query';
import { orderSalesDocumentMarkets } from '../lib/order-sales-document-markets';
import { SalesDocumentMarketRow } from './sales-document-market-row';

export interface SalesDocumentMarketSectionProps {
  onSelectCountry: (country: string) => void;
}

export function SalesDocumentMarketSection({
  onSelectCountry,
}: SalesDocumentMarketSectionProps): ReactElement {
  const marketsQuery = useSalesDocumentMarketsQuery();

  if (marketsQuery.isLoading) {
    return <LoadingState title="Loading markets" message="Fetching the current routing outcome for each market…" />;
  }

  if (marketsQuery.error) {
    return (
      <ErrorState
        title="Unable to load markets"
        message={marketsQuery.error.message}
        action={
          <button
            type="button"
            className="button button--secondary button--sm"
            onClick={() => void marketsQuery.refetch()}
          >
            Retry
          </button>
        }
      />
    );
  }

  const rows = orderSalesDocumentMarkets(marketsQuery.data?.markets ?? []);

  if (rows.length === 0) {
    return (
      <div className="page-section sales-document-market-section">
        <EmptyState
          title="No markets yet"
          message="Markets appear here on their own as orders arrive from a new country. There's nothing to configure until then."
        />
      </div>
    );
  }

  return (
    <div className="page-section sales-document-market-section">
      <ul className="sales-document-market-row-list" aria-label="Sales-document markets">
        {rows.map((row) => (
          <SalesDocumentMarketRow key={row.country} row={row} onSelect={onSelectCountry} />
        ))}
      </ul>
    </div>
  );
}
