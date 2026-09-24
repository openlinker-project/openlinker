/**
 * Fulfilment filter, paging and lane-label copy (#2410; narrowed by the merge)
 *
 * What survived the worklist page it was written for. The screens merged, so
 * the fulfilment screen's own page title, loading line, error and
 * nothing-to-do sentence come from `assign-packing-work.copy.ts`; what is
 * still read from HERE is the vocabulary that came with the capabilities the
 * merged screen absorbed - the filter boxes, the pager, the two empty states
 * only those capabilities can produce, and the lane labels
 * `fulfillment-lanes.ts` falls back to.
 *
 * Keys are deleted here the moment nothing reads them. A copy module is not
 * an archive: an unread string still reads as vocabulary this product uses.
 *
 * ## Why the PAGE holds no literals of its own
 *
 * `scripts/check-ui-vocabulary.mjs` reads string literals from a `*.copy.ts`
 * and JSX text from a `.tsx`, and it scans only under
 * `apps/web/src/features/*` — `SCAN_ROOT_PARENT` is that directory, so
 * `pages/fulfillment` cannot be added as a scan root without changing a shared
 * gate. Putting the worklist's copy HERE, under a folder the gate already
 * scans, covers it with no script change and no shared-file edit.
 *
 * The filename is load-bearing for the same reason `fulfillment-task.copy.ts`
 * says it is: named `fulfillment-worklist-copy.ts` — one character out — this
 * file would be invisible to the gate while appearing to be covered by it.
 *
 * ## Naming (epic #2412, design rule P9)
 *
 * The operator noun is **fulfilment task**. The internal aggregate name, the
 * word for who decides something, and the word for a stage of a process are all
 * on the banned list, so questions are phrased "Who decides …?" and states are
 * named for what they are.
 *
 * @module apps/web/src/features/fulfillment/lib
 */

export const FULFILLMENT_WORKLIST_COPY = {
  filter: {
    orderLabel: 'Order',
    orderPlaceholder: 'Filter by order id',
    locationLabel: 'Location',
    locationPlaceholder: 'Filter by location id',
    clear: 'Clear filters',
    groupLabel: 'Fulfilment task filters',
  },

  lane: {
    /** Shown when a task carries no `locationId`. */
    noLocation: 'No location yet',
    /** Shown when a task carries no `deliveryMethod`. */
    noDeliveryMethod: 'No delivery method yet',
    /**
     * Stated on every lane, because the rows are a paged slice: a lane shows
     * the tasks for that pair ON THIS PAGE, and a later page can add more.
     */
    pageScopeNote: 'Grouped from the tasks on this page only.',
  },

  empty: {
    /** A filter is narrowing the list and matched nothing. */
    filtered: {
      title: 'No fulfilment tasks match these filters',
      message: 'Nothing on this page matches what you filtered for. Clear the filters to see everything.',
    },
    /** Paged past the end — rows exist, this page is simply beyond them. */
    pastEnd: {
      title: 'Nothing on this page',
      message: 'There are fulfilment tasks, but none this far down the list.',
      action: 'Back to the first page',
    },
  },

  pagination: {
    previous: 'Previous',
    next: 'Next',
    /** `Showing 1–25 of 92` */
    range: (from: number, to: number, total: number): string =>
      `Showing ${from}–${to} of ${total}`,
  },
} as const;
