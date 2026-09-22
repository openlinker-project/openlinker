/**
 * Orphan Returns Worklist copy (#3078/#3081)
 *
 * Every operator sentence this component renders, in one place — the
 * `order-returns-panel.copy.ts` precedent, and a filename
 * `scripts/check-ui-vocabulary.mjs` actually scans (`features/returns` is one
 * of its three watched folders).
 *
 * Two groups, two vocabularies, deliberately never blended into one:
 *
 * - **Needs an order** — an orphan return (`bucket === 'orphan'`). Nothing
 *   downstream (restock, refund, invoice correction) can happen until it is
 *   linked to an order, and the copy says so rather than leaving the group
 *   heading to imply a softer "unmatched" state.
 * - **Waiting for your OK** — an operator-authored return the operator has
 *   not yet approved (`origin === 'operator_authored' && authorizedAt ===
 *   null`). Approving is an audit stamp, never a gate on restock/refund, which
 *   already act on the return's own state — the copy is careful not to imply
 *   otherwise.
 *
 * @module apps/web/src/features/returns/lib
 */
export const ORPHAN_RETURNS_WORKLIST_COPY = {
  sectionTitle: 'Needs your attention',

  needsOrderTitle: 'Needs an order',
  needsOrderDescription:
    "OpenLinker can't restock, refund or correct the invoice for these until they're linked to an order.",
  needsOrderAction: 'Match to an order',

  needsApprovalTitle: 'Waiting for your OK',
  needsApprovalDescription:
    'You recorded these yourself. Approving is an audit stamp confirming it really happened — it does not hold up restock or refund.',
  needsApprovalAction: 'Review and approve',

  /**
   * The `ReadOnlyLock` tooltip for a demo viewer with no `orders:write`
   * permission — the `return-detail.copy.ts` `readOnly` precedent, worded for
   * this row action specifically (tech-lead review on #3283, IMPORTANT).
   */
  approveReadOnly: 'You do not have permission to approve returns.',

  /** The read failed. Never conflated with "nothing needs attention". */
  errorTitle: 'Could not be loaded',
  errorMessage: 'OpenLinker could not read this list just now. This is not a statement about it.',
  retry: 'Try again',

  /** The envelope itself could not be parsed: zero rows and zero drops. */
  unreadableTitle: 'Could not be read',
  unreadableMessage:
    'The response did not match what this version of OpenLinker expects, so nothing is shown here. This is not evidence there is nothing.',

  /** The read succeeded and answered zero — a positive, confirmed claim. */
  needsOrderEmpty: 'Nothing is waiting to be matched to an order.',
  needsApprovalEmpty: 'Nothing is waiting for your approval.',

  loading: 'Checking…',
  loadingMessage: 'Reading the returns list.',

  /**
   * The approval scan reads one bounded page and discloses that truthfully
   * rather than trimming quietly — the same rule `order-returns-panel.copy.ts`
   * states. Phrased as a caveat rather than a precise count: the scan filters
   * client-side for `operator_authored` + unapproved, so a truncated page
   * cannot say how many of the REMAINING rows would also qualify.
   *
   * Names the DIRECTION of the approximation, not only that one exists
   * (tech-lead review on #3280): the read is ordered newest-first, so an
   * unapproved return ages OUT of the scanned window as newer attributed
   * returns arrive — the longer something has waited, the more likely this
   * scan misses it.
   */
  approvalScanTruncated:
    'Showing the 100 most recent attributed returns — an older one waiting for approval may not appear here.',

  /**
   * The "needs an order" read is an EXACT server-side filter, so — unlike
   * the approval scan above — a truncation here can state both numbers
   * precisely rather than only a caveat. `order-returns-panel.copy.ts`'s
   * `truncated(shown, total)` is the precedent this mirrors: an exact-filter
   * page still owes a truncation notice when `total` exceeds what is shown,
   * or an operator who clears the visible rows would believe the group is
   * empty while more sit past the page boundary.
   */
  needsOrderTruncated: (shown: number, total: number): string =>
    `Showing ${shown} of ${total} — more are waiting to be matched.`,
} as const;
