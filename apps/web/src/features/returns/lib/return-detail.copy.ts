/**
 * Return Detail Copy
 *
 * Every operator-facing string the return detail renders, in one module — the
 * placement `returns-list.copy.ts` established, and the one
 * `scripts/check-ui-vocabulary.mjs` scans most precisely (every string literal
 * in a `*.copy.ts`, versus JSX text plus a scoped attribute allowlist in a
 * `.tsx`).
 *
 * It deliberately does NOT restate the orphan explanation. That string is
 * `RETURNS_ORPHAN_COPY.explanation` and the list already renders it; a second
 * wording here would be two sentences describing one state, and the operator
 * would eventually meet both.
 *
 * The strings that matter most are the four disabled-reason sentences and the
 * five outcome sentences. Each says something different, and the wrong one is a
 * false claim about what the channel did — which is why they sit side by side
 * rather than inline at their branches.
 *
 * @module apps/web/src/features/returns/lib
 */

export const RETURN_DETAIL_COPY = {
  eyebrow: 'Operations',
  titleFallback: 'Return',
  backToList: 'Returns',
  loading: 'Loading return…',
  loadingMessage: 'Fetching this return and its lines.',
  notFoundTitle: 'Return not found',
  notFoundMessage: 'This return does not exist, or it has been removed.',
  errorTitle: 'Unable to load return',
  /**
   * Distinct from the above: the request succeeded and this build could not
   * read the record. "Unable to load" would point the operator at a network
   * problem they do not have.
   */
  unreadableTitle: 'Return could not be read',
  unreadableMessage:
    'OpenLinker received this return but could not read it. This is a version mismatch, not a problem with the return itself.',
  retry: 'Retry',
} as const;

export const RETURN_DETAIL_HEADER_COPY = {
  channelReference: 'Channel reference',
  openLinkerId: 'OpenLinker ID',
  source: 'Source',
  order: 'Order',
  origin: 'Origin',
  opened: 'Opened',
  lastUpdated: 'Last updated',
  closed: 'Closed',
  authorized: 'Authorized',
  declined: 'Declined',
  /** The channel minted no reference of its own. */
  noChannelReference: 'None — this return has no reference at the channel',
  originSource: 'Reported by the channel',
  originOperator: 'Recorded by you',
} as const;

/**
 * The orphan banner.
 *
 * `RETURNS_ORPHAN_COPY.explanation` carries the substance; this adds only the
 * heading and the "safe here" framing the detail page owes an operator who has
 * just clicked into a return nothing can be done with (returns spec §5.5).
 *
 * There is no `Match to an order` action, and the copy says why: re-attribution
 * is automatic once the order is ingested. A button that did nothing would be
 * worse than the sentence.
 */
export const RETURN_ORPHAN_BANNER_COPY = {
  title: 'This return is not matched to an order.',
  safeHere: 'It is safe here — nothing is lost.',
  reattribution:
    'If the order is ingested later, OpenLinker matches this return to it automatically and the actions below become available.',
} as const;

export const RETURN_LINES_COPY = {
  sectionTitle: 'What came back',
  tableCaption: 'Returned lines, in the order the channel reported them',
  empty: 'The channel reported no lines for this return.',
  itemLabel: 'Item',
  reasonLabel: 'Reason',
  quantityLabel: 'Advised',
  receivedLabel: 'Received',
  restockedLabel: 'Restocked',
  scrappedLabel: 'Scrapped',
  custodyLabel: 'Goods',
  moneyLabel: 'Refund',
  orderLineLabel: 'Order line',
  noteLabel: 'Note',
  unnamedItem: 'Unnamed item',
  expandLine: 'Record what happened to',
  collapseLine: 'Close',
  /**
   * `resolvedOrderLineId === null` is a real state, not missing data: OpenLinker
   * has no order-lines table to point at, so it says so instead of rendering a
   * blank an operator would file a bug about.
   */
  unmatchedLine: 'Could not be matched to a line',
  unmatchedLineHint:
    'OpenLinker could not tell which line of the order this returned item belongs to. The return is still recorded in full.',
  /** The counters are the fact; the wording is derived from them and says so. */
  advisedOnly: 'announced by the channel',
  notTrackedYet: 'Not tracked yet',
  notTrackedYetHint:
    'OpenLinker does not yet follow the goods or the refund for a return. It records what the channel reports, and this will start moving in a later release.',
} as const;

export const RETURN_SOURCE_PANEL_COPY = {
  sectionTitle: 'What the channel says',
  statusLabel: 'Status',
  /**
   * The standing explanation of why this panel exists. It is a quotation, not a
   * state OpenLinker stands behind — the operator has to be able to tell those
   * apart before they act on it.
   */
  explainer:
    'These values are the channel’s own, recorded word for word. OpenLinker does not translate or interpret them.',
} as const;

export const RETURN_DECLINE_COPY = {
  sectionTitle: 'Decline this return',
  action: 'Decline return',
  /**
   * The confirm framing, in the returns spec’s own words (§5.6). It states
   * the asymmetry rather than hiding it: OpenLinker asks, the channel decides.
   */
  confirmTitle: 'Decline this return?',
  confirmBody:
    'Declining tells the channel you are refusing this return. The channel decides what happens next — OpenLinker records the outcome it reports.',
  confirmAction: 'Send decline',
  cancel: 'Cancel',
  submitting: 'Sending…',
  reasonCodeLabel: 'Channel rejection code',
  reasonCodeDescription:
    'The channel’s own code for refusing a return. OpenLinker passes it through unchanged; if the channel does not accept it, the reply below lists the codes it does.',
  reasonCodeRequired: 'Enter the channel’s rejection code.',
  commentLabel: 'Comment (optional)',
  commentDescription:
    'Some channels require a comment for some codes, and shorten it to their own limit.',
  commentTooLong: 'Keep the comment to 500 characters or fewer.',
  /**
   * Why the action cannot be taken. Each names a different cause, and the
   * button stays VISIBLE and disabled carrying one of them — a missing button
   * is indistinguishable from a bug (returns spec §5.5).
   */
  blockedOrphan:
    'This return is not matched to an order, so nothing can be sent to the channel about it yet.',
  blockedNoSourceReturnId:
    'This return has no reference at the channel — there is nothing to ask them about. Returns you recorded yourself are always in this state.',
  blockedSourceDeclaresNoDecline:
    'This channel publishes no way to decline a return, so OpenLinker has nothing to send.',
  blockedUnknownReason:
    'OpenLinker could not establish whether this channel accepts a decline, so the action is held back rather than sent into the unknown.',
  blockedAlreadyDeclined: 'The channel has already reported this return as declined.',
  readOnly: 'You do not have permission to make changes.',
} as const;

/**
 * What happened, per outcome.
 *
 * The distinction the whole action turns on is between `declined` and
 * `decline-sent`: a 2xx alone never displays as declined by the channel
 * (returns spec §5.6 / US-3). `decline-sent` therefore states that the request
 * was accepted and the answer has not arrived — and the header keeps showing no
 * decline instant, because there is none.
 */
export const RETURN_DECLINE_OUTCOME_COPY = {
  declined: {
    title: 'The channel declined this return',
    body: 'The channel reported the decline as a fact, with the time it happened.',
  },
  'decline-sent': {
    title: 'Decline sent',
    body: 'The channel has the request and has not yet reported the outcome. OpenLinker records their decision when it arrives — until then this return is not declined.',
  },
  'already-declined': {
    title: 'Already declined',
    body: 'This return was already declined, so nothing was sent again.',
  },
  'in-flight': {
    title: 'A decline is already in progress',
    body: 'An earlier request for this return is still open, so no second request was sent.',
  },
  refused: {
    title: 'The channel refused the request',
    body: 'OpenLinker asked and the channel said no. Its own words:',
  },
  unknown: {
    title: 'The channel answered in a way OpenLinker does not recognise',
    body: 'The request was sent. Re-open this return in a moment to see what the channel recorded.',
  },
} as const;

/**
 * What went wrong, by HTTP status.
 *
 * Read from the status code and, for the orphan conflict, from the error body's
 * own `trigger` field — never by parsing the message, which would drift the
 * first time the backend reworded it.
 */
export const RETURN_DECLINE_ERROR_COPY = {
  notFound: 'This return no longer exists. Reload the page to see the current list.',
  /** The button is disabled for a known orphan, so this is the stale-page race. */
  conflictPrefix: 'This return is not matched to an order, so it cannot be declined.',
  conflictTriggerPrefix: 'Blocked action:',
  unsupported: 'The channel cannot be asked to decline this return.',
  generic: 'The decline could not be sent.',
} as const;

/** A line this build could not read. Reported, never quietly dropped. */
export function describeUnreadableLines(count: number): string {
  return count === 1
    ? '1 line of this return could not be read and is not shown.'
    : `${count} lines of this return could not be read and are not shown.`;
}

/**
 * The quantity summary for one line.
 *
 * Derived purely from the counters, and worded so it cannot be mistaken for a
 * state OpenLinker tracks: nothing has arrived until `received` moves, and
 * nothing moves it in this release.
 */
export function describeLineQuantity(advised: number, received: number): string {
  return received === 0
    ? `${advised} ${RETURN_LINES_COPY.advisedOnly}`
    : `${received} of ${advised} received`;
}

/**
 * The two rails (#2378, spec § 5).
 *
 * The independence sentence is COPY, not a comment: custody and money moving
 * independently is the single most misread thing about the model, and a reader
 * of the screen needs it as much as a reader of the code.
 */
export const RETURN_RAIL_COPY = {
  custodyLabel: 'Parcel',
  moneyLabel: 'Money',
  independenceNote:
    'These two move independently. A marketplace can refund the buyer before the parcel arrives, and a parcel can arrive with no refund owed.',
  inDoubtNote:
    'OpenLinker asked for this refund but could not confirm what happened. Do not refund again — check with the source first.',
  refundedBy: (sourceName: string | null): string =>
    sourceName === null ? 'Confirmed by the source' : `Confirmed by ${sourceName}`,
} as const;
