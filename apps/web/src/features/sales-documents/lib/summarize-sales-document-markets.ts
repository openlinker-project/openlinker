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
import { describeSalesDocumentMarketOutcome } from './sales-document-market-outcome-copy';
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
  return country === SALES_DOCUMENT_REST_OF_WORLD_COUNTRY ? 'Rest of world' : country;
}

function namesSentenceFragment(rows: readonly SalesDocumentMarketRow[]): string {
  const names = rows.slice(0, MAX_NAMED_MARKETS).map((row) => countryLabel(row.country));
  const remaining = rows.length - names.length;
  const joined = names.join(', ');
  return remaining > 0 ? `${joined}, and ${remaining} more` : joined;
}

export interface SalesDocumentMarketSummary {
  tone: 'fresh-install' | 'attention' | 'all-set';
  sentence: string;
}

export function summarizeSalesDocumentMarkets(
  rows: readonly SalesDocumentMarketRow[],
): SalesDocumentMarketSummary | null {
  if (rows.length === 0) return null;

  const blocked = rows.filter((row) => describeSalesDocumentMarketOutcome(row.outcome).needsDecision);

  if (blocked.length === 0) {
    return {
      tone: 'all-set',
      sentence:
        rows.length === 1
          ? 'This market is issuing its documents.'
          : `All ${rows.length} markets are issuing their documents.`,
    };
  }

  const noneConfiguredAtAll = rows.every((row) => !isConfigured(row));
  const ordersArriving = rows.some((row) => row.orderCount !== null);

  if (noneConfiguredAtAll && ordersArriving) {
    return {
      tone: 'fresh-install',
      sentence:
        blocked.length === 1
          ? `Orders are arriving from ${namesSentenceFragment(blocked)}, and it has not been set up yet. Nothing is lost while it waits — set up routing when you're ready.`
          : `Orders are arriving from ${blocked.length} markets — ${namesSentenceFragment(blocked)} — and none has been set up yet. Nothing is lost while they wait — set up routing when you're ready.`,
    };
  }

  // #2807 review — states the fraction (mirroring the mockup's "3 of your 4
  // markets are issuing nothing right now"), not just an enumeration: an
  // operator reading "4 markets — CZ, FI, NO, and 1 more" has no way to tell
  // whether that is most of their footprint or a small corner of it.
  return {
    tone: 'attention',
    sentence:
      blocked.length === 1
        ? `1 of ${rows.length} markets — ${namesSentenceFragment(blocked)} — issues nothing right now. Nothing is lost while it's unconfigured — set up routing to start issuing.`
        : `${blocked.length} of ${rows.length} markets — ${namesSentenceFragment(blocked)} — issue nothing right now. Nothing is lost while they're unconfigured — set up routing to start issuing.`,
  };
}
