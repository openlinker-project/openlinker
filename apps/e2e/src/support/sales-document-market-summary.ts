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
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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

// #3879: the web app reads these sentences from `locales/en/sales-documents.json` (ADR-081).
// This package imports no code from `apps/web`, so it reads the same file as
// DATA and keeps local look-alikes of the four i18n helpers the function body
// calls, under the same names, so the mirrored text stays identical.
type PluralForms = { readonly one?: string; readonly other: string };
type MarketSummaryCopy = {
  readonly restOfWorld: string;
  readonly namesAndMore: string;
  readonly allSet: PluralForms;
  readonly freshInstall: PluralForms;
  readonly attention: PluralForms;
};

const EN_LOCALE_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../web/src/locales/en/sales-documents.json',
);
let enCopy: { marketSummary: MarketSummaryCopy } | null = null;

function getMessages(namespace: 'sales-documents'): { marketSummary: MarketSummaryCopy } {
  void namespace;
  enCopy ??= JSON.parse(readFileSync(EN_LOCALE_FILE, 'utf8')) as { marketSummary: MarketSummaryCopy };
  return enCopy;
}

function getLocale(): string {
  return 'en';
}

function interpolate(template: string, params: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

function formatPlural(
  count: number,
  forms: PluralForms,
  locale: string,
  params: Readonly<Record<string, string | number>> = {},
): string {
  const form = new Intl.PluralRules(locale).select(count) === 'one' ? (forms.one ?? forms.other) : forms.other;
  return interpolate(form, { ...params, n: new Intl.NumberFormat(locale).format(count) });
}

function countryLabel(country: string): string {
  return country === REST_OF_WORLD_COUNTRY
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

  const blocked = rows.filter((row) => needsDecision(row));

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
