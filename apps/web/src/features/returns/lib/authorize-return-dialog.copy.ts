/**
 * Authorize Return Dialog copy (#3078/#3083)
 *
 * Every operator sentence this dialog renders, in one place — a filename
 * `scripts/check-ui-vocabulary.mjs` actually scans (`features/returns` is one
 * of its three watched folders).
 *
 * The confirm copy is careful never to imply approval GATES anything else:
 * restock and refund already act on the return's own state (returns spec
 * §5.5) — approving is an audit stamp, not a permission slip.
 *
 * @module apps/web/src/features/returns/lib
 */
export const AUTHORIZE_RETURN_DIALOG_COPY = {
  title: 'Give this the OK?',
  description:
    'You recorded this return yourself. Approving it is an audit stamp confirming it really ' +
    'happened — it does not hold up restock or refund, which already act on the return on their own.',

  cancel: 'Not yet',
  confirm: 'Approve',
  confirming: 'Approving…',

  /**
   * The 409 `source-ingested` refusal — defensive, since the worklist only
   * ever opens this dialog for an operator-authored return, but this
   * component is exported and may be reused from a place that does not
   * guarantee that.
   */
  refusedTitle: "Can't approve this one",
  refusedBody:
    'This return came in from the source, which already decided it. OpenLinker only approves ' +
    'returns recorded here by an operator.',
  refusedAcknowledge: 'Got it',

  genericError: 'The approval could not be completed. Try again.',
} as const;
