/**
 * Pack-bench work-list copy (#2416, `W3b-3`, stories B1–B5, C3)
 *
 * One copy source for the list, its two empty states and its scan feedback.
 *
 * ## What this copy is NOT allowed to say
 *
 * - **Never that stock is picked, gathered or ready** (story B2). OpenLinker
 *   cannot see a shelf. Rows count *units to verify*; a row that implies the
 *   goods are waiting sends a packer to fetch something that is not there, and
 *   after that happens twice the list is not trusted again. `bench-work.copy.test.ts`
 *   asserts the absence of those words rather than trusting review.
 * - **Never the nine banned terms.** `scripts/check-ui-vocabulary.mjs` scans
 *   every string literal in this file. Note that "holder" and "phase" are among
 *   them, so the connection carrying out the packing is named plainly — *"this
 *   bench"*, *"where packing happens"* — and never by the domain word.
 * - **Never a warehouse name.** Nothing tells a bench which location it stands
 *   in, so the heading names the connection the work came through. Saying
 *   otherwise would be the surface claiming a fact OpenLinker does not have.
 *
 * @module apps/web/src/features/bench/lib
 */

export const benchWorkCopy = {
  header: {
    eyebrow: 'Packing work',
    /** Rendered when the API could not name a single connection. */
    fallbackTitle: 'Packing work at this bench',
    orderingNote: 'Most urgent first',
  },
  scope: {
    /**
     * D8, said to the packer: this list is what was routed here, not every
     * unpacked order in the business.
     */
    note: 'This is the packing work routed here and accepted at this bench — not a list of every unpacked order. Orders that go out through a logistics provider never appear here.',
  },
  search: {
    label: "Find a parcel — type the order reference or the buyer's name",
    /** D11's forgiving matching, taught by the placeholder itself. */
    placeholder: 'e.g. 4471, OL-4471, allegro-4471, Nowak',
    hint: 'Part of a reference is enough. Leading zeros, marketplace prefixes and a surname all find it. There is no barcode on the tote, so typing is how a parcel is found.',
    noMatches: 'Nothing here matches what you typed. Clear the box to see everything again.',
    clearAction: 'Clear',
  },
  sections: {
    toPack: 'To pack',
    /**
     * The mockup's own heading. These rows are shown precisely so a packer does
     * not pack a parcel that has been stopped or cancelled.
     */
    doNotPack: 'Do not pack these',
  },
  row: {
    expeditedBadge: 'Moved to the front',
    expeditedHint: 'Someone asked for this one to go out ahead of its deadline order.',
    heldBadge: 'On hold',
    heldTitle: 'On hold — do not pack',
    heldBody: 'Put the tote back on the trolley.',
    cancelledBadge: 'Cancelled',
    cancelledTitle: 'Cancelled',
    cancelledBody: 'Nothing to pack. Take the items back to the shelf.',
    /** Deadline headlines. Never "ready", never "picked". */
    deadlineOverdue: 'Past its deadline',
    deadlineSoon: 'Deadline close',
    deadlineLater: 'Later today or after',
    deadlineUnknown: 'No dispatch deadline given',
    /**
     * The row's own summary line, built here rather than inline in the
     * component so the B2 word check in `bench-work.copy.test.ts` actually
     * covers the most-read string on the surface. A literal in the JSX escapes
     * that scan entirely.
     */
    summary: (parts: {
      readonly parcelIndex: number;
      readonly parcelTotal: number;
      readonly lineCount: number;
      readonly unitsToVerify: number;
    }): string =>
      `Parcel ${String(parts.parcelIndex)} of ${String(parts.parcelTotal)} · ` +
      `${String(parts.lineCount)} lines, ${String(parts.unitsToVerify)} units to verify`,
    openAction: 'Open parcel',
    expediteAction: 'Move to the front',
    releaseExpediteAction: 'Back to deadline order',
    expediteFailed: 'That did not go through. The list has been refreshed — try again.',
  },
  emptyIdle: {
    title: 'Nothing to pack right now',
    body: 'Every parcel routed to this bench has been packed. New work turns up here on its own — you do not need to refresh, and you can stay signed in.',
    reassurance: 'Work is reaching this bench normally.',
  },
  emptyNotRouted: {
    title: 'No work can reach this bench',
    body: 'OpenLinker is not sending packing work here, so nothing will appear however long you keep this screen open. Nothing is broken at the bench, and this is not the same as having nothing to pack.',
    remedyTitle: 'What to do about it',
    /**
     * Names the remedy, per story B3. It points at the settings page that
     * assigns who carries work out, because that is the fact that is missing —
     * creating a stock location is a different setup step and would not make a
     * parcel arrive here.
     */
    remedyBody: 'Show this screen to your supervisor. Someone with an administrator account turns on packing in OpenLinker under Settings, on the page that says who decides what. Until then, orders keep going wherever they went before.',
  },
  scan: {
    /**
     * C3, on this surface specifically. There is nothing here a scan can match
     * — nothing prints a barcode on a tote — so every scan made on the list is
     * unrecognised, and saying so plainly is both true and useful.
     */
    unrecognisedTitle: 'That scan was not recognised',
    unrecognisedBody: 'Nothing on this screen can be scanned, and nothing was recorded. Find the parcel by typing its reference or the buyer’s name.',
    /** What came off the scanner, so a packer can see a misread rather than guess at one. */
    scannedLabel: 'Scanned',
    dismissAction: 'Dismiss',
  },
  truncated: {
    /** Said when the read hit its cap, rather than quietly showing part of it. */
    note: 'There is more work than fits on this screen. The oldest work is the part shown — still most urgent first; pack some and the rest will appear.',
  },
  footer: {
    honesty: 'OpenLinker cannot see your shelves. This list says what has been routed here and when it must go out — never whether the goods are in front of you.',
    liveness: 'Updates by itself',
  },
  errors: {
    loadTitle: 'Could not load the work for this bench',
    retryAction: 'Try again',
  },
  loading: {
    title: 'Loading the work for this bench',
    body: 'One moment.',
  },
} as const;
