/**
 * Sales-document market summary mirror (#2563 M10)
 *
 * A byte-for-byte-behavior mirror of `summarizeSalesDocumentMarkets`
 * (`apps/web/src/features/sales-documents/lib/summarize-sales-document-markets.ts`)
 * and `describeSalesDocumentMarketOutcome`'s `needsDecision` predicate
 * (`sales-document-market-outcome-copy.ts`). This package deliberately
 * imports nothing from `apps/web` or `libs/*` (see the package doc comment),
 * so — exactly like `apps/web`'s own browser-side mirrors of `libs/core`
 * logic (`stock-and-pricing-preview.ts`, `parameter-restrictions.ts`, …) —
 * the rule is copied rather than shared.
 *
 * WHY THIS EXISTS: the settings page's "which of the mockup's four states is
 * the stack in right now" is a GLOBAL property of every market the whole
 * install has ever seen — unreachable to force deterministically once
 * another spec (or a real operator) has left the stack in some particular
 * mix of configured/unconfigured countries. Rather than assert a canned
 * scenario that only holds on a freshly migrated stack, this mirror computes
 * the EXPECTED summary from the LIVE `GET /sales-documents/markets` read, so
 * the spec can assert "the page agrees with the rule" on whatever real data
 * the stack happens to hold — always a real assertion, never a skip, and
 * never a hardcoded assumption about install history.
 *
 * Kept in exact sync with the two files above; if either changes, update
 * this too (there is no `check:invariants` mirror script for this pair
 * since `apps/e2e` sits outside that gate — see the package doc comment on
 * why this package isn't part of the mirror-drift CI checks the rest of the
 * monorepo runs).
 *
 * @module support
 */
import type { SalesDocumentMarketRow } from '../api/api.types';

const REST_OF_WORLD_COUNTRY = '*';
const MAX_NAMED_MARKETS = 3;

export function needsDecision(row: SalesDocumentMarketRow): boolean {
  return row.outcome.kind === 'unresolved';
}

function isConfigured(row: SalesDocumentMarketRow): boolean {
  return (
    row.ruleCount > 0 ||
    row.invoiceDefaultConnectionId !== null ||
    row.receiptDefaultConnectionId !== null ||
    row.acknowledgedNoDocumentAt !== null
  );
}

function countryLabel(country: string): string {
  return country === REST_OF_WORLD_COUNTRY ? 'Rest of world' : country;
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

  const blocked = rows.filter(needsDecision);

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

  return {
    tone: 'attention',
    sentence:
      blocked.length === 1
        ? `1 of ${rows.length} markets — ${namesSentenceFragment(blocked)} — issues nothing right now. Nothing is lost while it's unconfigured — set up routing to start issuing.`
        : `${blocked.length} of ${rows.length} markets — ${namesSentenceFragment(blocked)} — issue nothing right now. Nothing is lost while they're unconfigured — set up routing to start issuing.`,
  };
}
