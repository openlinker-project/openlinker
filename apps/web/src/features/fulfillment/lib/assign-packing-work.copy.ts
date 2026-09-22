/**
 * Assign Packing Work operator copy (#3340, ADR-074)
 *
 * Every user-visible string the swimlane board renders. Lives under
 * `features/fulfillment/lib` — the same folder `fulfillment-worklist.copy.ts`
 * gives the reason for — so `scripts/check-ui-vocabulary.mjs` covers it
 * (its scan root is `apps/web/src/features/*`, not `pages/`).
 *
 * @module apps/web/src/features/fulfillment/lib
 */

export const ASSIGN_PACKING_WORK_COPY = {
  page: {
    eyebrow: 'Operations',
    title: 'Assign packing work',
    description:
      'Pre-assign a fulfilment task to a specific packer ahead of time, or leave it open for whoever picks it up first.',
  },

  /**
   * #3428 — the metric row above the board. Only "Unassigned right now" is
   * shipped — it is a pure count over lanes already read for the board, so
   * it needs no new backend signal. "Oldest unassigned" and "Packers at
   * their benches" both need a presence/unassigned-since signal this system
   * does not have yet (their write semantics — when does "unassigned
   * since" get stamped, and what counts as "at the bench" — are undecided,
   * not merely unwired), so neither is rendered rather than showing a
   * fabricated or misleading number.
   */
  metrics: {
    unassignedLabel: 'Unassigned right now',
  },

  lane: {
    unassignedTitle: 'Unassigned',
    /** A task assigned to a user id no longer in the active packer roster. */
    offRosterTitle: 'No longer a packer',
    empty: 'Nothing here right now.',
    /** #3427 — the cross-packer load comparison. See `lightestLoadLaneIds`. */
    lightestLoadTag: 'lightest load',
    /**
     * #3429 — the mockup's `.lane__station` text under "Unassigned", verbatim.
     * Static copy, unlike a packer lane's station/presence line (deliberately
     * NOT rendered — see `assign-packing-work-lane-section.tsx`'s docblock):
     * this one needs no backend signal at all.
     */
    unassignedSubtitle: 'Visible to every packer until claimed or assigned',
  },

  row: {
    moveToLabel: 'Move to',
    moveToUnassigned: 'Unassigned',
    selfServeLabel: 'Anyone may claim this',
    hold: 'Hold',
    moveFailed: 'Could not move this task. Nothing has changed.',
    /** #3429 — only errors toasted before; a successful staffing change said nothing. */
    moveSucceeded: 'Task moved.',
    selfServeUpdated: 'Self-serve eligibility updated.',
  },

  loading: {
    message: 'Loading packing work…',
  },

  error: {
    title: 'Could not load packing work',
    message: 'The board could not be read just now. Nothing has been changed.',
    retry: 'Retry',
  },

  empty: {
    title: 'Nothing to assign right now',
    message: 'No fulfilment tasks are waiting. That is normal unless fulfilment routing is switched on.',
  },

  rosterError: {
    message: 'The packer roster could not be loaded, so tasks can only be held or left unassigned.',
  },
} as const;
