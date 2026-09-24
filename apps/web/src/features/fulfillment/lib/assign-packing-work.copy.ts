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

  lane: {
    unassignedTitle: 'Unassigned',
    /** A task assigned to a user id no longer in the active packer roster. */
    offRosterTitle: 'No longer a packer',
    empty: 'Nothing here right now.',
  },

  row: {
    moveToLabel: 'Move to',
    moveToUnassigned: 'Unassigned',
    selfServeLabel: 'Anyone may claim this',
    hold: 'Hold',
    moveFailed: 'Could not move this task. Nothing has changed.',
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
