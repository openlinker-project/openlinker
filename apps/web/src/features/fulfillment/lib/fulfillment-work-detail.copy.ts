/**
 * Fulfilment work detail copy (#3096)
 *
 * Every operator-facing sentence the routed detail page renders. Transcribed
 * from the reviewed mockup at
 * `docs/plans/mockups/fulfillment-work-detail-3096.html`, which is the design
 * of record for this epic, and — for the Packer card — from
 * `docs/plans/mockups/assign-packing-work.html`.
 *
 * ## Why this file is written once, up front, rather than by each slice
 *
 * The page is built by several slices that each own one section. Copy is the
 * thing most easily paraphrased into a second wording for one idea, and it is
 * the thing a reviewer reads first. Writing it here removes it from every
 * slice's scope: a slice that needs a sentence it cannot find reports that
 * rather than inventing one.
 *
 * ## The `.copy.ts` in the filename is load-bearing, not decoration
 *
 * `scripts/check-ui-vocabulary.mjs` reads EVERY string literal out of a
 * `*.copy.ts` under `apps/web/src/features`, and out of a `.tsx` only JSX
 * text plus an attribute allow-list. It reads nothing at all under
 * `apps/web/src/pages`. So the detail page carries no string literals of its
 * own, exactly as the assign board page does not, and one character out of
 * this filename would make every sentence below invisible to the gate.
 *
 * ## Deliberate divergences from the mockup
 *
 * 1. The mockup's fallback subject for the connection executing a task is
 *    "Whoever holds it". That noun is on the epic-#2412 banned list, so the
 *    subject is "Whoever is working this task".
 * 2. The mockup hard-codes "Two things are stopping this." for its two-hold
 *    demo row. Spelling arbitrary counts does not generalise, so the count
 *    is rendered as a numeral with a singular special case.
 * 3. The mockup says "gave this back" for every cancelled task, but its own
 *    force-cancel path produces the identical field state and says "was told
 *    to stop". Real data carries the discriminator the two axes do not, so
 *    the cancelled sentence branches on `cancellationReason` and says nothing
 *    at all for `rerouted` / `order_cancelled`.
 * 4. `summary.closed` and `summary.acceptedWaiting` have NO mockup source —
 *    the mockup ships no closed or accepted-but-unstarted demo task.
 * 5. `facts.noLocation` reuses `FULFILLMENT_WORKLIST_COPY.lane.noLocation`
 *    BY REFERENCE rather than as a second literal. The Location row itself
 *    renders only on a multi-location install (#3096): with one warehouse it
 *    names the same place on every task and says nothing.
 * 6. `lines.caveat` is the same sentence `fulfillment-task-card.tsx` already
 *    renders for the stale-counter warning, kept byte-identical.
 * 7. The mockup's "e.g." block is gone (#3096 review): with one warehouse every
 *    order is one task, and an example of the opposite read as a claim.
 *
 * @module apps/web/src/features/fulfillment/lib
 */
import { FULFILLMENT_WORKLIST_COPY } from './fulfillment-worklist.copy';

export const FULFILLMENT_WORK_DETAIL_COPY = {
  /** Page chrome. The title is the order, not the task id. */
  eyebrow: 'Fulfilment task',
  backToWorklist: 'Back to the worklist',
  titleFallback: 'Fulfilment task',
  orderTitlePrefix: 'Order',
  /** The page action: there was no way from a task back to its order. */
  openOrder: 'Open order',

  /**
   * Five page states, and none of them may impersonate another: a failed
   * read is not an empty one, an id that matches nothing is a fact about the
   * URL, and a 403 is a fact about the session's role — never a Retry.
   */
  states: {
    loading: {
      title: 'Loading this fulfilment task',
      message: 'Fetching the task details.',
    },
    error: {
      title: 'Could not load this fulfilment task',
      message: 'The task could not be read just now. Nothing has been changed.',
      retry: 'Retry',
    },
    notFound: {
      title: 'Task not found',
      message: 'No fulfilment task matches this address. It may have been removed.',
    },
    /** A session without `orders:write` (#3096): the board and the detail are supervisors'. */
    denied: {
      title: 'Fulfilment tasks are for supervisors',
      message:
        'Your role cannot open fulfilment tasks. Ask an administrator if you need access.',
    },
    /** The same refusal for a session whose work is the bench — with a way there. */
    deniedBench: {
      title: 'Packing happens on the pack bench',
      message: 'This screen is for supervisors. Your parcels are waiting on the bench.',
      action: 'Go to the pack bench',
    },
  },

  /**
   * Why this screen is not a duplicate of Orders. Always visible, never
   * behind a disclosure: the reader who needs it is the one who does not
   * know they need it.
   */
  vsOrders: {
    ordersLabel: 'Orders',
    ordersText: 'What was sold, and its overall status. One row per order, always.',
    taskLabel: 'This task',
    taskText:
      'One physical packing job. An order becomes more than one of these only when it ships from more than one place.',
  },

  sections: {
    holds: "Why it's stuck",
    lines: "What's in this task",
    facts: 'Details',
    /** Not a section title: the action card's small label, as the mockup draws it. */
    actions: 'What you can do',
    packer: 'Packer',
    payment: 'Payment',
  },

  /**
   * Who is executing the task, as the hero's sub-line names it. The detail
   * used to give this a section of its own ("Who's handling this"); the
   * mockup folds it into the sub-line, and the freed slot became the Packer
   * card.
   */
  executor: {
    /** `task.assignedConnectionId === null` — a real, reachable state. */
    unassigned: 'Not routed to anyone yet',
    /** The lookup failed or 404'd — the sub-line says so rather than going blank. */
    unavailable: 'Executor details unavailable',
    externalPartner: 'External partner',
  },

  /**
   * The Packer card (#3096), from `assign-packing-work.html`: who packs this
   * parcel, and the same Assign / Move / Pull back menu the board offers.
   * Queue counts are deliberately absent here — the detail has no page of
   * tasks to count from, and a number fetched for it would be a second read
   * for a figure the board already shows.
   */
  packer: {
    unassigned: 'Unassigned',
    /** `age` is pre-formatted by `formatUnassignedAge`, e.g. "2d". */
    waiting: (age: string): string => `waiting ${age}`,
    /** Shown when the pool has no recorded wait for this task. */
    waitingUnknown: 'waiting to be picked up',
    rosterError: 'The packer roster could not be loaded, so this task can only be left unassigned.',
  },

  /**
   * The Payment card. The figures are `OrderTotalsPanel`'s, the same rows the
   * order page renders; this table only supplies the source line.
   */
  payment: {
    placedOn: 'Placed on',
    unavailable: "This order's payment summary could not be loaded.",
  },

  /** The right-hand order modules when the task's order could not be read. */
  order: {
    unavailable:
      "The order behind this task could not be loaded, so its shipment, sales document and payment are not shown.",
    retry: 'Retry',
  },

  facts: {
    state: 'State',
    handshake: 'Handshake',
    location: 'Location',
    delivery: 'Delivery',
    externalReference: 'External reference',
    started: 'Started',
    /** Reuses the worklist's wording rather than minting a second one — see divergence 5 above. */
    noLocation: FULFILLMENT_WORKLIST_COPY.lane.noLocation,
    /**
     * #3096 (G02-3) — what the bench has done to the box. Shown only when the
     * API carries the field; an older API sends nothing and the row is absent
     * rather than claiming the parcel is open.
     */
    parcel: 'Parcel',
    parcelOpen: 'Still open',
    parcelClosed: 'Parcel closed',
    channelNotified: 'Channel notified',
    /**
     * Closed but not yet settled with the channel. Says what happens next,
     * because "not notified" alone reads as a fault somebody must fix by hand.
     */
    channelNotYet: 'Not yet — retried automatically',
    completed: 'Completed',
  },

  holds: {
    /** Rendered before the instant, as the mockup's "since Sep 10 09:20". */
    since: 'since',
  },

  lines: {
    empty: 'This fulfilment task covers no lines.',
    /** One per line, appended after the counts when non-zero. */
    cancelledSuffix: (cancelled: number): string => `(${cancelled} cancelled)`,
    skuLabel: 'SKU',
    eanLabel: 'EAN',
    /**
     * Byte-identical to `fulfillment-task-card.tsx`'s stale-counter warning —
     * see divergence 6 above.
     */
    caveat:
      'Picked counts are reported by whoever is working the task and can be a little behind what you see here.',
  },

  actions: {
    nothingLeft: 'Nothing left to do.',
  },

  /**
   * The plain-language sentence beneath the hero headline.
   *
   * `subject` is the resolved display name of the connection executing the
   * task, or `executorFallback` when it is unassigned or unresolved. The
   * derivation that picks between these is `fulfillment-work-summary.ts`.
   */
  summary: {
    executorFallback: 'Whoever is working this task',
    scheduled: (subject: string): string => `${subject} will start picking this soon.`,
    inProgress: (subject: string): string =>
      `${subject} is picking and packing this right now.`,
    inProgressExpedited: (subject: string): string =>
      `${subject} is picking and packing this right now, ahead of its usual place in the queue.`,
    awaitingAnswer: (subject: string): string =>
      `Asked ${subject} to take this. No answer yet.`,
    /** `open` + `accepted`: taken, not started. See divergence 4. */
    acceptedWaiting: (subject: string): string =>
      `${subject} accepted this and has not started picking yet.`,
    cancellationRequested: (subject: string): string =>
      `Asked ${subject} to stop. They have not answered, so packing may still be happening.`,
    cancellationRejected: (subject: string): string =>
      `${subject} said no to the cancellation, so this is going ahead.`,
    incomplete: (subject: string): string =>
      `${subject} could only pack part of this. Needs re-sourcing or a manual decision.`,
    cancelledByOperator: (subject: string): string => `${subject} was told to stop.`,
    cancelledGivenBack: (subject: string): string => `${subject} gave this back.`,
    closed: 'This task is finished.',
    unassigned: 'Not yet assigned anywhere, so there is nothing to pick until it is routed.',
    onHold: (count: number): string =>
      count === 1
        ? 'One thing is stopping this. See below.'
        : `${count} things are stopping this. See below.`,
  },
} as const;
