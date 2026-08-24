/**
 * Order Sales-Document Countries (#2187)
 *
 * `★ Rest of world` (`SALES_DOCUMENT_REST_OF_WORLD_COUNTRY`, `'*'`) always
 * renders last in `SalesDocumentCountryIndex`, regardless of where the API
 * placed it in the raw response — the countries-listing read has no ordering
 * guarantee of its own. The other rows sort alphabetically by country code
 * for a stable, scannable list.
 *
 * This function does not invent a row: it only orders what the #2186 read
 * actually returned. A country — including `★ Rest of world` — that carries
 * no rule, default, or acknowledgment simply isn't in the response yet; an
 * operator adds it explicitly via the "Add country" affordance, same as any
 * other unconfigured code.
 *
 * @module apps/web/src/features/sales-documents/lib
 */
import {
  SALES_DOCUMENT_REST_OF_WORLD_COUNTRY,
  type SalesDocumentCountrySummary,
} from '../api/sales-document-rules.types';

export function orderSalesDocumentCountries(
  summaries: readonly SalesDocumentCountrySummary[],
): SalesDocumentCountrySummary[] {
  const restOfWorld = summaries.filter(
    (summary) => summary.country === SALES_DOCUMENT_REST_OF_WORLD_COUNTRY,
  );

  const others = summaries
    .filter((summary) => summary.country !== SALES_DOCUMENT_REST_OF_WORLD_COUNTRY)
    .slice()
    .sort((a, b) => a.country.localeCompare(b.country));

  return [...others, ...restOfWorld];
}
