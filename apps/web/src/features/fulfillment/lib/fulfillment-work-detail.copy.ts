/**
 * Fulfilment work detail copy (#3096)
 *
 * Every operator-facing sentence the routed detail page renders. Transcribed
 * from the reviewed mockup at
 * `docs/plans/mockups/fulfillment-work-detail-3096.html`, which is the design
 * of record for this epic.
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
 *    subject is "Whoever is working this task" — the exact phrase
 *    `fulfillment-task-card.tsx`'s own stale-counter caveat already puts in
 *    front of the operator one section up.
 * 2. The mockup hard-codes "Two things are stopping this." for its two-hold
 *    demo row. Spelling arbitrary counts does not generalise, so the count
 *    is rendered as a numeral with a singular special case.
 * 3. The mockup says "gave this back" for every cancelled task, but its own
 *    force-cancel path produces the identical field state and says "was told
 *    to stop". Real data carries the discriminator the two axes do not, so
 *    the cancelled sentence branches on `cancellationReason` and says nothing
 *    at all for `rerouted` / `order_cancelled`, where the executor did
 *    nothing wrong and "gave this back" would be a false attribution.
 * 4. `summary.closed` has NO mockup source — the mockup ships no closed demo
 *    task, so the sentence is written here rather than transcribed.
 * 5. `facts.noLocation` reuses `FULFILLMENT_WORKLIST_COPY.lane.noLocation`
 *    BY REFERENCE rather than as a second literal, so the assign board and
 *    this page cannot describe an absent location differently. The mockup
 *    puts "No location yet" in the hero sub-line and omits the Details
 *    Location row entirely when the location is null — this page instead
 *    always renders the row, carrying that same wording, because a row that
 *    names the absent fact beats one that silently disappears (a
 *    disappearing row reads as a page that forgot, not as a task that has no
 *    location yet).
 * 6. `lines.caveat` is the same sentence `fulfillment-task-card.tsx` already
 *    renders inline for the stale-counter warning — copied verbatim rather
 *    than imported, since that sentence is JSX text in a `.tsx` and not an
 *    exported constant; kept byte-identical here so the two surfaces agree.
 *
 * ## `executor` has no source in the mockup (#3291)
 *
 * The mockup never wired up `task.assignedConnectionId`, so there is no
 * markup to transcribe for the "Who's handling this" panel. Its wording
 * follows the vocabulary already established here: `executorFallback` above
 * is what a lookup that never resolves reads as, and this panel is what
 * makes that lookup actually run.
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

  /**
   * Four page states, and none of them may impersonate another: a failed
   * read is not an empty one, and an id that matches nothing is a fact about
   * the URL rather than about the request.
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
  },

  /**
   * Why this screen is not a duplicate of Orders. Always visible, never
   * behind a disclosure: the reader who needs it is the one who does not
   * know they need it. The example is fixed illustrative prose and is never
   * interpolated from the task on screen, which would turn an explanation
   * into a claim.
   */
  vsOrders: {
    ordersLabel: 'Orders',
    ordersText: 'What was sold, and its overall status. One row per order, always.',
    taskLabel: 'This task',
    taskText:
      'One physical packing job. An order becomes more than one of these only when it ships from more than one place.',
    examplePrefix: 'For example',
    exampleText:
      'An order is one row in Orders. But if its shoe box ships from Warsaw and its earbuds ship from Berlin, it is two separate tasks here, one per warehouse.',
  },

  sections: {
    holds: "Why it's stuck",
    executor: "Who's handling this",
    shipment: 'Shipment',
    payment: 'Payment',
    lines: "What's in this task",
    facts: 'Details',
    actions: 'What you can do',
  },

  /**
   * The dedicated panel #3291 adds — distinct from `summary`'s one-line
   * sentence above, which names the same connection but never distinguishes
   * an in-house executor from a partner and never degrades on a 404.
   */
  executor: {
    /** `task.assignedConnectionId === null` — a real, reachable state. */
    unassigned: 'Not assigned to anyone yet.',
    loading: 'Checking who is handling this…',
    /** The lookup 404s: a deleted or renamed connection. */
    removed: 'This connection no longer exists.',
    /** Any other failed lookup — the raw id still renders beside this. */
    unavailable: "This connection's details could not be loaded.",
    /** `platformType === 'openlinker'` — the OMS itself, never a partner. */
    inHouse: 'Handled automatically, no partner involved.',
    externalPartner: 'External partner',
  },

  /**
   * The "Shipment" panel #3292 adds. Three states: no shipment yet (with an
   * OL-executed-only CTA into the existing manual dispatch flow on the order
   * page), an active/in-transit shipment, and a delivered one.
   */
  shipment: {
    loading: 'Checking for a shipment…',
    unavailable: 'The shipment for this task could not be loaded.',
    /** No shipment row exists for this task at all. */
    none: 'Nothing dispatched yet.',
    /** The CTA, shown only when the holder is OpenLinker's own OMS. */
    createLabel: 'Create a label',
    /** Shown beside the CTA — never for a 3rd-party holder, who ships on their own. */
    createLabelHint: 'This task is handled in-house, so no partner will dispatch it on its own.',
    carrier: 'Carrier',
    trackingNumber: 'Tracking number',
    status: 'Status',
    trackParcel: 'Track this parcel',
    noLabelYet: 'Label not generated yet.',
    delivered: 'Delivered.',
  },

  /**
   * The "Payment" panel #3293 adds — narrowed deliberately. No COD/prepaid
   * distinction: no order-source adapter projects a payment-method field
   * onto `Order` today (checked: none of Allegro, PrestaShop, WooCommerce or
   * Erli), so this panel states only what is real — the order's total,
   * currency and source channel — worded so it never implies a fact this
   * build cannot know. The real distinction is filed as #3294.
   */
  payment: {
    /**
     * `formatAmount` already bakes the currency symbol into its output
     * (`order-totals-panel.tsx`'s own usage), so there is no separate
     * currency literal here. The SOURCE half is not a string at all — it
     * renders through `ConnectionEntityLabel`, the same component the
     * order-detail page already uses for "which shop this order came from",
     * so this panel is a JSX composition rather than one interpolated
     * sentence.
     */
    placedOn: 'placed on',
    unavailable: "This order's payment summary could not be loaded.",
    followUpNote: 'Whether this is already paid or collected on delivery is not yet tracked here.',
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
  },

  holds: {
    /** Rendered before the relative time, as the shipped task card does. */
    since: 'since',
  },

  lines: {
    empty: 'This fulfilment task covers no lines.',
    /** One per line, appended after the counts when non-zero. */
    cancelledSuffix: (cancelled: number): string => `(${cancelled} cancelled)`,
    /**
     * Byte-identical to `fulfillment-task-card.tsx`'s inline stale-counter
     * warning — see divergence 6 above. One fact, one sentence, wherever
     * picked counts are shown.
     */
    caveat:
      'Picked counts are reported by whoever is working the task and can be a little behind what you see here.',
  },

  actions: {
    nothingLeft: 'Nothing left to do.',
  },

  /**
   * The plain-language sentence beneath the hero's two raw axis labels.
   *
   * `subject` is the resolved display name of the connection executing the
   * task, or `executorFallback` when it is unassigned or unresolved. The
   * derivation that picks between these is `fulfillment-work-summary.ts`;
   * this table only supplies the words.
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
