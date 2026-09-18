/**
 * Match Return Dialog copy (#3078/#3082)
 *
 * Every operator sentence this dialog renders, in one place — a filename
 * `scripts/check-ui-vocabulary.mjs` actually scans (`features/returns` is one
 * of its three watched folders).
 *
 * **The field is honest about what it searches.** There is no order-search
 * endpoint (`GET /orders` exposes no `search` parameter, and an order carries
 * no buyer name on the FE contract at all — a deliberate PII boundary), so
 * this dialog offers a bounded pick-list of recent orders (the same
 * client-side-filtered-20 shape `command-palette-provider.tsx` already uses)
 * ALONGSIDE free-text entry, and says so rather than implying a full search.
 *
 * @module apps/web/src/features/returns/lib
 */
export const MATCH_RETURN_DIALOG_COPY = {
  title: 'Which order is this?',
  description:
    "Pick a recent order below, or type its internal order id directly if you already know it.",

  fieldLabel: 'Order',
  fieldDescription: 'Must be an order OpenLinker already has on file.',
  fieldPlaceholder: 'ol_order_… or pick from recent orders',

  /**
   * Field-specific rather than a mirror of anything in
   * `return-detail.copy.ts` (tech-lead review on #3281, SUGGESTION —
   * the previous comment here claimed a shared vocabulary that does
   * not exist).
   */
  fieldRequired: 'Enter an order id, or pick one from the list.',

  warning: "This can't be undone — double-check the order before confirming.",

  /**
   * Renders only when the typed value exactly matches a fetched order — the
   * thing left on screen to actually check against `warning` above, since
   * the `<datalist>` option's readable text disappears once picked and the
   * field itself holds only the opaque internal id (tech-lead review on
   * #3281, IMPORTANT).
   */
  resolvedOrder: (orderNumber: string): string => `This will match to order ${orderNumber}.`,

  cancel: 'Cancel',
  confirm: 'Confirm match',
  confirming: 'Matching…',

  /**
   * 400 `unknown-order` — a FIELD error, not a toast, and it names what was
   * typed so the operator can see their own mistake rather than guess at it.
   */
  unknownOrder: (typed: string): string =>
    `OpenLinker doesn't have an order matching "${typed}" — double-check it, or pick one from the list.`,

  /**
   * 409 `already-attributed` — a DISTINCT message, never the generic error:
   * attribution is monotonic, so this is not a retryable failure, it is news
   * that the return is already resolved (possibly by someone else, or by the
   * background reconcile).
   */
  alreadyAttributedTitle: 'Already linked',
  alreadyAttributedBody:
    "Someone else — another operator, or OpenLinker's own background check — matched this " +
    'return to an order already. There is nothing left to do here.',
  alreadyAttributedAcknowledge: 'OK, got it',

  /** Anything else: a network failure, a 404, a 5xx. */
  genericError: 'The match could not be completed. Try again.',
} as const;
