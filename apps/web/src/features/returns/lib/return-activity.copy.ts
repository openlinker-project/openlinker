/**
 * Return-detail activity timeline copy (#2646)
 *
 * The panel's own sentences. The ENTRY copy — titles, eyebrows, descriptions —
 * stays in `return-timeline.copy.ts`, which #2383 owns and both timelines read:
 * a second copy of "Return received" is exactly the drift that module exists to
 * prevent.
 *
 * @module apps/web/src/features/returns/lib
 */
export const RETURN_ACTIVITY_COPY = {
  sectionTitle: 'Activity',
  /** Names the RETURN, because the order timeline uses the same list markup. */
  ariaLabel: 'Return activity timeline',

  loading: 'Loading activity…',
  loadingMessage: 'Reading what has happened on this return.',

  /** The read failed. Never conflated with "nothing has happened". */
  errorTitle: 'Activity could not be loaded',
  errorMessage:
    'Things may well have happened on this return — OpenLinker could not read them just now.',
  retry: 'Try again',

  /**
   * A 403. Stated as a permission fact rather than as a fault, because it is
   * reachable by design: these entries carry refund amounts, so the read is
   * narrowed to the roles that own the money.
   */
  forbiddenTitle: 'Activity is not available to this account',
  forbiddenMessage:
    'This history includes refund amounts, so it is limited to accounts that handle money. Everything else on this page is unaffected.',

  /** The read succeeded and answered zero. */
  emptyTitle: 'Nothing recorded yet',
  emptyMessage:
    'Receiving, disposing, declining and refunding this return will each appear here.',
} as const;
