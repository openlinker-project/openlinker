/**
 * Returns List Copy
 *
 * Every operator-facing string the returns list renders, in one module.
 *
 * Two reasons it is centralised rather than inlined at each JSX site. It is
 * what `scripts/check-ui-vocabulary.mjs` scans most precisely (every string
 * literal in a `*.copy.ts`, versus JSX text and a scoped attribute allowlist in
 * a `.tsx`), so the design-rule-P9 gate has the least room to miss something.
 * And the empty-state wordings are the substance of this screen — four
 * near-identical-looking sentences that mean four different things — so they
 * are easier to keep honest side by side than scattered across branches.
 *
 * @module apps/web/src/features/returns/lib
 */

export const RETURNS_PAGE_COPY = {
  eyebrow: 'Operations',
  title: 'Returns',
  description:
    'Returns reported by your connected channels, newest first. OpenLinker records what the channel says and does not reinterpret it.',
  tableCaption: 'Returns, newest first',
} as const;

/**
 * The orphan explanation, said plainly (returns spec §4.1).
 *
 * It must not be softened into "unmatched": the point is that an orphan return
 * is kept and counted but triggers nothing, which is a fact the operator has to
 * act on rather than a cosmetic label.
 */
export const RETURNS_ORPHAN_COPY = {
  badge: 'Orphan',
  short: 'No matching order',
  explanation:
    'Returns for orders OpenLinker has never seen. They are kept, but nothing is triggered from them — no stock change, no refund, no credit note — until they are matched to an order.',
} as const;

export const RETURNS_FILTER_COPY = {
  bucketGroupLabel: 'Filter by attribution',
  all: 'All',
  orphan: 'Orphan',
  attributed: 'Matched to an order',
  sourceLabel: 'Filter by source connection',
  allSources: 'All sources',
  clear: 'Clear filters',
} as const;

/**
 * The four empty branches. Each answers a different question, and the wrong one
 * makes a false statement about the operator's own data — the defect this wave
 * keeps correcting.
 */
export const RETURNS_EMPTY_COPY = {
  /** Paged past the end. The data exists; this page simply does not. */
  pastEnd: {
    title: 'Nothing on this page',
    message: 'This page is past the end of the results.',
    action: 'Back to first page',
  },
  /** A filter is narrowing the list. Says nothing about the whole set. */
  noMatches: {
    title: 'No returns match these filters',
    message: 'Try widening or clearing the filters to see the returns recorded so far.',
  },
  /**
   * Nothing in this deployment can fetch returns. A configuration fact, never
   * an error — and never presented as one.
   */
  notConfigured: {
    title: 'Returns ingestion is not set up',
    message:
      'None of your connected channels report returns to OpenLinker yet. This is a configuration state, not a failure — nothing is wrong with the returns you already have.',
  },
  /** Returns can be fetched; none have arrived. */
  none: {
    title: 'No returns recorded yet',
    message: 'Returns reported by your connected channels will appear here.',
  },
} as const;

export const RETURNS_ERROR_COPY = {
  title: 'Unable to load returns',
  /**
   * Distinct from the above: the request succeeded, and this build could not
   * read a single row of what came back. Saying "no returns" there would be a
   * false claim about the operator's data, and saying "unable to load" would
   * point them at a network problem they do not have.
   */
  unreadableTitle: 'Returns could not be read',
  retry: 'Retry',
} as const;

/**
 * The source's own status word. Rendered verbatim and attributed — never
 * translated into OpenLinker vocabulary, never given a traffic-light tone, and
 * never sorted on. It is evidence, not state.
 */
export const RETURNS_SOURCE_STATUS_COPY = {
  prefix: 'Source',
  notReported: 'Not reported',
  attribution:
    'Reported by the source channel, word for word. OpenLinker does not interpret this value.',
  /** Distinct from the above: nothing came back, so there is nothing to quote. */
  notReportedHint: 'The source channel reported no status for this return.',
} as const;

export const RETURNS_ROW_COPY = {
  recordedByYou: 'Recorded by you',
  declined: 'Declined',
  /**
   * `openedAt` is what the source says; `createdAt` is when OpenLinker first
   * saw the return. When the source reported no opening instant we show the
   * latter and SAY so, rather than passing OpenLinker's own clock off as the
   * channel's.
   */
  recordedAtFallback: 'First recorded by OpenLinker',
  openedLabel: 'Opened',
  sourceLabel: 'Source',
  orderLabel: 'Order',
  returnLabel: 'Return',
  statusLabel: 'Status',
  sourceStatusLabel: 'Source status',
  noExternalId: 'No channel reference',
} as const;

export const RETURNS_PAGINATION_COPY = {
  previous: 'Previous',
  next: 'Next',
} as const;

/**
 * A row this build could not read. Reported next to the range label so the two
 * numbers are read together — the range counts what the server says exists, the
 * rendered rows count what could be shown, and hiding the gap between them
 * would make the shorter list look complete.
 */
export function describeUnreadableRows(count: number): string {
  return count === 1
    ? '1 return on this page could not be read and is not shown.'
    : `${count} returns on this page could not be read and are not shown.`;
}

export function describeRange(from: number, to: number, total: number): string {
  return `Showing ${from}–${to} of ${total}`;
}
