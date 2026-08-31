/**
 * Order Sales-Document Markets (#2540)
 *
 * A market row that needs a decision (its outcome is `unresolved`) sorts
 * before every settled row — that's the whole point of #2540's acceptance
 * criterion "decisions-needed rows sort first". Within each group, rows sort
 * alphabetically by country code for a stable, scannable list, with
 * `★ Rest of world` always last regardless of which group it falls in
 * (mirrors `orderSalesDocumentCountries`, #2187).
 *
 * @module apps/web/src/features/sales-documents/lib
 */
import { SALES_DOCUMENT_REST_OF_WORLD_COUNTRY } from '../api/sales-document-rules.types';
import { describeSalesDocumentMarketOutcome } from './sales-document-market-outcome-copy';
import type { SalesDocumentMarketRow } from '../api/sales-document-markets.types';

export function orderSalesDocumentMarkets(
  rows: readonly SalesDocumentMarketRow[],
): SalesDocumentMarketRow[] {
  const restOfWorld = rows.filter((row) => row.country === SALES_DOCUMENT_REST_OF_WORLD_COUNTRY);
  const others = rows.filter((row) => row.country !== SALES_DOCUMENT_REST_OF_WORLD_COUNTRY);

  const rank = (row: SalesDocumentMarketRow): number =>
    describeSalesDocumentMarketOutcome(row.outcome).needsDecision ? 0 : 1;

  const sorted = others.slice().sort((a, b) => {
    const rankDelta = rank(a) - rank(b);
    if (rankDelta !== 0) return rankDelta;
    return a.country.localeCompare(b.country);
  });

  return [...sorted, ...restOfWorld];
}
