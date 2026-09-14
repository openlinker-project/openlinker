/**
 * Order-detail returns panel copy (#2640)
 *
 * Every operator sentence this panel renders, in one place — and a filename
 * `scripts/check-ui-vocabulary.mjs` actually scans (`*.copy.ts`; a plain
 * `-copy.ts` is scanned too, but a `…-strings.ts` would be scanned by nothing
 * and the script fails the run on such an escapee).
 *
 * **The restock-blocked sentence is deliberately NOT here.** It lives in
 * `features/returns/lib/restock-blocked.copy.ts`, the single home returns spec
 * § 5.4 requires, and this panel reaches it by rendering `ReturnStageCell` —
 * the same component the returns list uses. Reusing the component rather than
 * re-importing the constant is one step stronger: there is no second render of
 * the badge that could drift from the first.
 *
 * @module apps/web/src/features/returns/lib
 */
export const ORDER_RETURNS_PANEL_COPY = {
  sectionTitle: 'Returns',

  /** The read failed. Never conflated with "this order has no returns". */
  errorTitle: 'Returns could not be loaded',
  errorMessage:
    'This order may still have returns — OpenLinker could not read them just now. Nothing below is a statement about them.',
  retry: 'Try again',

  /**
   * The read succeeded and answered zero. A positive, confirmed claim — which
   * is why it may only render when the query settled without error and the
   * envelope was readable.
   */
  emptyTitle: 'No returns on this order',
  emptyMessage: 'Returns reported against this order will appear here.',

  /** The envelope itself could not be parsed: zero rows and zero drops. */
  unreadableTitle: 'Returns could not be read',
  unreadableMessage:
    'The response did not match what this version of OpenLinker expects, so no returns are shown. This is not evidence that the order has none.',

  loading: 'Loading returns…',
  loadingMessage: 'Reading the returns recorded against this order.',

  /**
   * Deliberately NO `viewAll` deep link. `internalOrderId` is not in
   * `RETURN_FILTER_PARAMS`, so a link to `/returns` would land on an
   * UNFILTERED list — worse than stating the truncation in words.
   */
  noChannelReference: 'No channel reference',

  /**
   * The panel had no order id to scope the read to, so it asked nothing.
   * Never an empty state: an unasked question has no answer to report.
   */
  unscopedTitle: 'Returns were not loaded',
  unscopedMessage:
    'This page could not tell which order to look up returns for, so none were requested. This is not a statement about whether the order has any.',

  /**
   * The panel shows one page. Disclosed with both numbers rather than trimmed
   * quietly — a truncation nobody is told about is a disappearance defect.
   */
  truncated: (shown: number, total: number): string =>
    `Showing ${shown} of ${total} returns on this order.`,
} as const;
