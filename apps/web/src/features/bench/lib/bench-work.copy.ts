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
  /** #3413 (epic #3401) — packed-today, its trend, and the cross-bench backlog. */
  metrics: {
    packedTodayLabel: 'Packed today',
    toPackLabel: 'To pack — all benches',
    trendFlat: 'same as yesterday',
    trendUp: (delta: number): string => `+${String(delta)} vs yesterday`,
    trendDown: (delta: number): string => `-${String(delta)} vs yesterday`,
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
  /** #3416 (epic #3401) — the rail's three tabs, and the four sections the first tab holds. */
  tabs: {
    bench: 'At this bench',
    hold: 'On hold',
    done: 'Packed today',
    assignedToYou: 'Assigned to you',
    assignedToOthers: 'Assigned to other packers',
    unassigned: 'Unassigned — anyone can pick this up',
    waitingOnCarrier: 'Packed — waiting on carrier',
    onHoldHeading: 'On hold — do not pack',
    noPacksYet: 'Nothing packed yet today.',
    /** The mockup's own log-not-a-queue sentence. */
    doneNote: 'This is a log, not a queue — nothing here can be opened.',
    /** #3412 — this row's own claim control. */
    claimAction: 'Claim this parcel',
    claimFailed: 'That claim did not go through. The list has been refreshed — try again.',
    /** The unlabelled row's own reassurance — nothing left for THIS bench to do. */
    nothingLeftHere: 'Nothing left for you to do here',
    /** The unlabelled row's own badge. */
    unlabelledBadge: 'Packed · no label',
    takeNextAction: 'Take next task',
    takeNextEmpty: 'Nothing unassigned right now.',
    takeNextFailed: 'That did not go through. The list has been refreshed — try again.',
    /**
     * A parcel WAS found and then lost, so this must not say the queue is
     * empty — the rail behind the message is still showing rows, and a packer
     * reading "nothing here" over a full list concludes the button is broken.
     */
    takeNextTaken: 'Someone got there first. Try again — there may be more.',
    /** The same race, but the parcel went on hold rather than to a packer. */
    takeNextHeld: 'That one just went on hold. Try again.',
    /** The order was cancelled between picking it and taking it. */
    takeNextCancelled: 'That order was just cancelled. Try again.',
    /**
     * The standing ADR-074 lock, NOT a lost race — a different fact from
     * `takeNextTaken` and must not borrow its words. That sentence tells a
     * packer to try again for a parcel that will keep refusing them; this one
     * names the actual state, so they stop retrying a box that was never
     * going to open.
     */
    takeNextLocked: 'That one is already assigned to someone. Try a different one.',
    noSectionMatches: 'Nothing here matches what you typed.',
  },

  /**
   * The parcel pane before a box is open (mockup-parity epic #3401). Says
   * what to do next, and deliberately nothing about the bench being idle —
   * `empty` below owns "nothing can reach this bench", which is a different
   * fact and has a different remedy.
   */
  placeholder: {
    title: 'No box open',
    body: 'Pick a parcel from the list on the left to start scanning it into a box.',
  },
  row: {
    /**
     * What a row says about a line whose variant is not in the catalogue.
     *
     * Deliberately not a guess and not a blank: a packer meeting this needs to
     * know the row is real and its name is not, so they look at the parcel
     * rather than at a gap.
     */
    itemUnnamed: 'Product not in the catalogue',
    /**
     * The overflow line, worded so it reads as "there is more" rather than as
     * a truncation fault. The server caps the list; `lineCount` is the total.
     */
    itemsMore: (count: number): string =>
      count === 1 ? '1 more item in this box' : `${String(count)} more items in this box`,
    /** Prefix on the quantity, so "2" cannot be misread as a line number. */
    itemQuantity: (quantity: number): string => `${String(quantity)} x`,
    /** #3412 — pull the oldest-deadline unassigned parcel into your own queue. */
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
      `${String(parts.lineCount)} ${parts.lineCount === 1 ? 'item' : 'items'}, ` +
      `${String(parts.unitsToVerify)} units to scan`,
    openAction: 'Open parcel',
    /** #3341, ADR-074 — the pre-assigned-to-you state. */
    assignedToYouBadge: 'Assigned to you',
    /** Muted per the mockup's own treatment — a fact about the account, not an alert. */
    assignedToOtherBadge: 'Assigned to another packer',
    /** Shown in place of the open control when this packer may not claim it. */
    lockedForOther: 'Only the assigned packer may open this one',
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
    note: 'More work than fits here. Pack some and the rest appears.',
  },
  footer: {
    honesty: 'OpenLinker cannot see your shelves — this is what must go out, and when.',
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
