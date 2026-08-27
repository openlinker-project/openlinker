/**
 * Return Custody Copy (#2380)
 *
 * Every operator-facing string for the per-line receive, dispose and
 * write-off flows, in one place so the form, its confirm, its refusal and its
 * toast cannot phrase the same fact three ways.
 *
 * Two strings here are quoted from the returns spec rather than written fresh,
 * and must stay that way: the over-receipt refusal (§ 5.2) and the two
 * disposition explanations (§ 5.3). They are the spec's own adjudicated
 * wording.
 *
 * @module apps/web/src/features/returns/lib
 */

export const RETURN_RECEIVE_COPY = {
  action: 'Receive',
  heading: 'Record what arrived',
  quantityLabel: 'Units received',
  quantityHint: 'Defaults to everything still outstanding on this line.',
  noteLabel: 'Note (optional)',
  notePlaceholder: 'Anything worth recording about this arrival',
  submit: 'Record arrival',
  cancel: 'Cancel',
  pending: 'Recording…',
  success: 'Arrival recorded.',
  /** Spec § 5.2, verbatim. */
  overReceipt:
    "You've recorded more units than the buyer advised. Record what arrived up to the advised quantity, and open a separate return for the rest.",
  nonPositive: 'Record at least one unit.',
  notWholeUnits: 'Record whole units.',
  nothingOutstanding: 'Every advised unit on this line has already arrived.',
  bulkAction: 'Receive all as advised',
  bulkConfirmTitle: 'Record every line as fully arrived?',
  bulkConfirmBody:
    'This records the full outstanding quantity on every line still awaiting its parcel. Check the parcel against the advised quantities first — each line is recorded as a real arrival.',
  bulkConfirm: 'Record all arrivals',
  bulkCancel: 'Go back',
  bulkNothing: 'No line is still awaiting units.',
  bulkSuccess: 'Recorded arrivals on every outstanding line.',
  readOnly: 'Recording what arrived is disabled in the demo.',
  bulkPartial: 'Some lines could not be recorded. The ones that failed are unchanged.',
} as const;

export const RETURN_DISPOSE_COPY = {
  action: 'Dispose',
  heading: 'Record what happened to these units',
  quantityLabel: 'Units',
  quantityHint: 'Defaults to everything received but not yet dealt with.',
  dispositionLabel: 'What happened to them',
  restockLabel: 'Restock',
  scrapLabel: 'Scrap',
  /** Spec § 5.3, verbatim. */
  restockHelp: 'Adds the units back to your stock, in the system that owns your stock.',
  /** Spec § 5.3, verbatim. */
  scrapHelp: 'Writes the units off. Stock is not changed.',
  noteLabel: 'Note (optional)',
  notePlaceholder: 'e.g. scuffed box',
  submit: 'Record',
  cancel: 'Cancel',
  pending: 'Recording…',
  success: 'Disposition recorded.',
  nonPositive: 'Record at least one unit.',
  notWholeUnits: 'Record whole units.',
  overDisposition: 'You only have {n} received unit(s) left to deal with on this line.',
  nothingToDispose: 'Every received unit on this line has already been dealt with.',
  orphanBlocked:
    'This return is not matched to an order, so OpenLinker will not add stock anywhere. You can still scrap these units.',
} as const;

/**
 * Where the stock lands — the § 5.3 sentence, per resolved state.
 *
 * `ambiguous-inventory-master` deliberately does NOT name a candidate. That
 * status means the restock will be REFUSED, so naming one would promise a write
 * that is going to be blocked.
 */
export const RETURN_RESTOCK_TARGET_COPY = {
  resolved: 'Stock will be added in {name}.',
  'ambiguous-inventory-master':
    '{n} connections claim to own your stock, so OpenLinker will not guess which one to write to — restocking will be refused until exactly one is set up.',
  'no-inventory-master':
    'No connection owns your stock, so restocking cannot add units anywhere. Scrapping still works.',
  'adapter-unresolved':
    "OpenLinker can't reach the system that owns your stock right now, so it can't say where these units would land.",
} as const;

export const RETURN_NOT_RETURNED_COPY = {
  action: 'Mark as not returned',
  confirmTitle: 'Record that this parcel is not coming?',
  confirmBody:
    'This writes the line off. Use it when you have decided the buyer is not sending the goods back — it is never something OpenLinker concludes on its own.',
  noteLabel: 'Note (optional)',
  notePlaceholder: 'Why is it not coming back?',
  confirm: 'Write the line off',
  cancel: 'Go back',
  pending: 'Recording…',
  success: 'Line written off.',
  /**
   * Why the action is absent once units have arrived. Rendered in place of the
   * control, because an unexplained absence reads as a missing feature — and
   * the shortfall really is still visible, which is the point.
   */
  partiallyReceivedHint:
    'Some units already arrived on this line, so it cannot be written off. Deal with what arrived — the shortfall stays visible against the advised quantity.',
} as const;

export const RETURN_CUSTODY_ERROR_COPY = {
  generic: 'The change could not be recorded. Nothing was saved.',
  notFound: 'This return line no longer exists. Reload the page.',
  conflict: 'This line has changed since the page loaded. Reload and try again.',
  forbidden: 'Your account cannot record changes to returns.',
  byReason: {
    'over-receipt': RETURN_RECEIVE_COPY.overReceipt,
    'over-disposition':
      'That is more units than this line has received. Reload the page to see the current counts.',
    'non-positive-quantity': 'Record at least one whole unit.',
    'partially-received': RETURN_NOT_RETURNED_COPY.partiallyReceivedHint,
    'nothing-advised': 'The source advised no units on this line, so there is nothing to write off.',
    'illegal-transition':
      'This line is already finished, so it cannot change. Reload the page to see where it ended up.',
  } as Record<string, string>,
} as const;

/**
 * The restock that did not land, on an otherwise successful disposition.
 *
 * Deliberately surfaced even though § 5.4's full treatment is a sibling issue:
 * a disposition that silently no-ops the stock write is worse than none, and
 * rendering a plain success for it would be the UI stating something false.
 */
export const RETURN_RESTOCK_BLOCKED_COPY = {
  title: 'Stock was not added.',
  bodyPrefix: 'OpenLinker recorded the disposition, but',
  bodyUnknownConnection: 'the system that owns your stock',
  bodySuffix: 'did not accept the change, so your stock has not changed.',
  remedyPrefix: 'Add',
  remedyJoin: '×',
  remedySuffix: 'yourself, then mark it handled.',
} as const;
