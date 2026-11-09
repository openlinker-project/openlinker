/**
 * Summarize Sales-Document Markets (#2541)
 *
 * One computed prose sentence for the settings page's market section —
 * derived from the same rows the list renders, never hand-written. Three
 * outcomes:
 *
 *  1. **Nothing configured anywhere, but orders are arriving** — a fresh
 *     install that already has traffic. This reads as "not set up yet",
 *     never "broken": a brand new instance receiving orders is the expected
 *     starting state, not a fault.
 *  2. **Some markets issue nothing** — names them (capped, so the sentence
 *     stays a sentence on an install with many blocked markets) and states
 *     explicitly that nothing is lost while they stay unconfigured — the
 *     document is held, not dropped.
 *  3. **Everything issues** — the reassuring one-liner.
 *
 * `rows.length === 0` returns `null`: the empty state
 * (`SalesDocumentMarketEmptyState`) owns that case, and the two must never
 * both render (#2541 acceptance).
 *
 * @module apps/web/src/features/sales-documents/lib
 */
import { SALES_DOCUMENT_REST_OF_WORLD_COUNTRY } from '../api/sales-document-rules.types';
import { describeSalesDocumentMarketOutcome } from './sales-document-market-outcome';
import { formatPlural, getLocale, getMessages, interpolate } from '../../../shared/i18n';
import type { SalesDocumentMarketRow } from '../api/sales-document-markets.types';

const MAX_NAMED_MARKETS = 3;

function isConfigured(row: SalesDocumentMarketRow): boolean {
  return (
    row.ruleCount > 0 ||
    row.invoiceDefaultConnectionId !== null ||
    row.receiptDefaultConnectionId !== null ||
    row.acknowledgedNoDocumentAt !== null
  );
}

function countryLabel(country: string): string {
  return country === SALES_DOCUMENT_REST_OF_WORLD_COUNTRY
    ? getMessages('sales-documents').marketSummary.restOfWorld
    : country;
}

function namesSentenceFragment(rows: readonly SalesDocumentMarketRow[]): string {
  const names = rows.slice(0, MAX_NAMED_MARKETS).map((row) => countryLabel(row.country));
  const remaining = rows.length - names.length;
  const joined = names.join(', ');
  return remaining > 0
    ? interpolate(getMessages('sales-documents').marketSummary.namesAndMore, { names: joined, count: remaining })
    : joined;
}

export interface SalesDocumentMarketSummary {
  tone: 'fresh-install' | 'attention' | 'all-set';
  sentence: string;
}

export function summarizeSalesDocumentMarkets(
  rows: readonly SalesDocumentMarketRow[],
): SalesDocumentMarketSummary | null {
  if (rows.length === 0) return null;
  const copy = getMessages('sales-documents').marketSummary;
  const locale = getLocale();

  const blocked = rows.filter((row) => describeSalesDocumentMarketOutcome(row.outcome).needsDecision);

  if (blocked.length === 0) {
    return {
      tone: 'all-set',
      sentence: formatPlural(rows.length, copy.allSet, locale),
    };
  }

  const noneConfiguredAtAll = rows.every((row) => !isConfigured(row));
  const ordersArriving = rows.some((row) => row.orderCount !== null);

  if (noneConfiguredAtAll && ordersArriving) {
    return {
      tone: 'fresh-install',
      sentence: formatPlural(blocked.length, copy.freshInstall, locale, {
        names: namesSentenceFragment(blocked),
      }),
    };
  }

  // #2807 review — states the fraction (mirroring the mockup's "3 of your 4
  // markets are issuing nothing right now"), not just an enumeration: an
  // operator reading "4 markets — CZ, FI, NO, and 1 more" has no way to tell
  // whether that is most of their footprint or a small corner of it.
  return {
    tone: 'attention',
    sentence: formatPlural(blocked.length, copy.attention, locale, {
      names: namesSentenceFragment(blocked),
      total: rows.length,
    }),
  };
}
