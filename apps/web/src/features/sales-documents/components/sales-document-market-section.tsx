/**
 * SalesDocumentMarketSection (#2540/#2541)
 *
 * The settings page's headline half: one prose sentence answering "what does
 * each market issue" (#2541), then a scannable market list (#2540) — both
 * read the single merged `useSalesDocumentMarketsQuery` snapshot, so they
 * can never disagree about what "right now" means. Detected-market wording
 * (#2542) — the order count, its discovery window, and the sole-templated-
 * market caption — is computed here from the full row set and passed down
 * to each row, since only the section can know whether a template is unique
 * across the rendered markets. The loading skeleton (#2543) builds on this
 * same query in a later slice of the same mini-epic.
 *
 * The summary and the empty state never both render (#2541 acceptance):
 * `summarizeSalesDocumentMarkets` returns `null` for an empty row set, and
 * the empty-state branch below returns before the summary would even be
 * computed.
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
import { summarizeSalesDocumentMarkets } from '../lib/summarize-sales-document-markets';
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

  const summary = summarizeSalesDocumentMarkets(rows);
  const windowDays = marketsQuery.data?.windowDays;
  // #2542 — a suggested-setup caption may only claim exclusivity ("the only
  // market with guidance so far") when it's actually true of THIS section's
  // rows, never hand-asserted from the current single-template catalogue.
  const templatedMarketCount = rows.filter((row) => row.hasTemplate).length;

  return (
    <div className="page-section sales-document-market-section">
      {summary ? (
        <p
          className={`sales-document-market-section__summary sales-document-market-section__summary--${summary.tone}`}
        >
          {summary.sentence}
        </p>
      ) : null}

      <ul className="sales-document-market-row-list" aria-label="Sales-document markets">
        {rows.map((row) => (
          <SalesDocumentMarketRow
            key={row.country}
            row={row}
            onSelect={onSelectCountry}
            windowDays={windowDays}
            isSoleTemplatedMarket={row.hasTemplate && templatedMarketCount === 1}
          />
        ))}
      </ul>
    </div>
  );
}
