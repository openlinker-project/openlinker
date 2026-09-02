/**
 * SalesDocumentMarketSection (#2540/#2541)
 *
 * The settings page's headline half: one prose sentence answering "what does
 * each market issue" (#2541), then a scannable market list (#2540) — both
 * read the single merged `useSalesDocumentMarketsQuery` snapshot, so they
 * can never disagree about what "right now" means. Detected-market wording
 * (#2542) — the order count and its discovery window — is computed here
 * from the full row set and passed down to each row. The loading skeleton
 * (#2543) is
 * `SalesDocumentMarketSectionSkeleton`, sized from the real row's own shape
 * so the section never reflows on arrival — a blank load must never be
 * mistaken for "nothing is configured" (the empty state's job), so the
 * skeleton renders its own visible, `aria-live="polite"` narration rather
 * than an empty container. A background refetch (e.g. the error state's
 * Retry action) keeps the loaded rows on screen but disables every row's
 * action and announces "Refreshing markets…" in a live region, so an
 * operator never presses an action against data that is already stale in
 * flight.
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
import { useState, type ReactElement, type ReactNode } from 'react';
import { EmptyState, ErrorState } from '../../../shared/ui/feedback-state';
import { useSalesDocumentMarketsQuery } from '../hooks/use-sales-document-markets-query';
import { orderSalesDocumentMarkets } from '../lib/order-sales-document-markets';
import { summarizeSalesDocumentMarkets } from '../lib/summarize-sales-document-markets';
import { describeSalesDocumentMarketOutcome } from '../lib/sales-document-market-outcome-copy';
import { SalesDocumentMarketRow } from './sales-document-market-row';
import { SalesDocumentMarketSectionSkeleton } from './sales-document-market-section-skeleton';
import type { SalesDocumentMarketRow as MarketRowData } from '../api/sales-document-markets.types';

// #2806 review — one list, filtered, instead of two separate tables (the
// "recently active" markets read here and the "everything ever configured"
// `SalesDocumentCountryIndex`) that both opened the identical routing
// dialog for the identical underlying config. `GET /sales-documents/markets`
// already unions both populations server-side (a country appears once,
// however it qualified) — see that controller's own doc comment — so this
// was always ONE data set wearing two UIs, not two data sets.
type MarketFilter = 'all' | 'active' | 'configured' | 'attention';

export interface SalesDocumentMarketSectionProps {
  onSelectCountry: (country: string) => void;
}

export function SalesDocumentMarketSection({
  onSelectCountry,
}: SalesDocumentMarketSectionProps): ReactElement {
  const marketsQuery = useSalesDocumentMarketsQuery();
  const [filter, setFilter] = useState<MarketFilter>('all');

  if (marketsQuery.isLoading) {
    return <SalesDocumentMarketSectionSkeleton />;
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
            disabled={marketsQuery.isFetching}
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
  // #2543 — a background refetch (e.g. the error state's Retry, or React
  // Query's own focus/interval refetch) keeps the loaded rows visible but
  // must disable every action: the section already read `isLoading` above,
  // so this branch only covers "loaded once, fetching again."
  const isBusy = marketsQuery.isFetching;

  // #2806 review — the two old lists ("recently active" / "everything ever
  // configured") become filter chips over this ONE row set, so a country
  // never renders twice. `orderCount !== null` is exactly "had activity in
  // the discovery window" (never 0 — see the row type's own doc comment);
  // "configured" reuses the same predicate the market row already renders a
  // tag for, so the chip counts and the badges can't disagree.
  const activeCount = rows.filter((row) => row.orderCount !== null).length;
  const configuredOnlyCount = rows.filter(
    (row) => row.orderCount === null && isConfigured(row),
  ).length;
  const attentionCount = rows.filter(
    (row) => describeSalesDocumentMarketOutcome(row.outcome).needsDecision,
  ).length;

  const filteredRows = rows.filter((row) => {
    if (filter === 'active') return row.orderCount !== null;
    if (filter === 'configured') return row.orderCount === null && isConfigured(row);
    if (filter === 'attention') return describeSalesDocumentMarketOutcome(row.outcome).needsDecision;
    return true;
  });

  return (
    <div className="page-section sales-document-market-section">
      {summary ? (
        <p
          className={`sales-document-market-section__summary sales-document-market-section__summary--${summary.tone}`}
        >
          {summary.sentence}
        </p>
      ) : null}

      <div className="sales-document-market-section__filters" role="group" aria-label="Filter markets">
        <FilterChip active={filter === 'all'} onClick={() => setFilter('all')} count={rows.length}>
          All markets
        </FilterChip>
        <FilterChip active={filter === 'active'} onClick={() => setFilter('active')} count={activeCount}>
          Recent orders
        </FilterChip>
        <FilterChip
          active={filter === 'configured'}
          onClick={() => setFilter('configured')}
          count={configuredOnlyCount}
        >
          Configured, no recent orders
        </FilterChip>
        <FilterChip active={filter === 'attention'} onClick={() => setFilter('attention')} count={attentionCount}>
          Needs a decision
        </FilterChip>
      </div>

      <span className="sr-only" role="status" aria-live="polite">
        {isBusy ? 'Refreshing markets…' : ''}
      </span>

      {filteredRows.length === 0 ? (
        <p className="muted-text">No markets match this filter.</p>
      ) : (
        <ul className="sales-document-market-row-list" aria-label="Sales-document markets">
          {filteredRows.map((row) => (
            <SalesDocumentMarketRow
              key={row.country}
              row={row}
              onSelect={onSelectCountry}
              windowDays={windowDays}
              disabled={isBusy}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function isConfigured(row: MarketRowData): boolean {
  return (
    row.ruleCount > 0 ||
    row.invoiceDefaultConnectionId !== null ||
    row.receiptDefaultConnectionId !== null ||
    row.acknowledgedNoDocumentAt !== null
  );
}

interface FilterChipProps {
  active: boolean;
  count: number;
  onClick: () => void;
  children: ReactNode;
}

function FilterChip({ active, count, onClick, children }: FilterChipProps): ReactElement {
  return (
    <button
      type="button"
      className={`sales-document-market-section__chip${active ? ' sales-document-market-section__chip--active' : ''}`}
      onClick={onClick}
      aria-pressed={active}
    >
      {children} <span className="sales-document-market-section__chip-count">{count}</span>
    </button>
  );
}
