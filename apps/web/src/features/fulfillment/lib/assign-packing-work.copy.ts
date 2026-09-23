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
  /**
   * The heading names the SCREEN, not one of its two jobs.
   *
   * It read "Assign packing work" while the screen was only a staffing board.
   * It now also answers where a task is packed from, matches the nav entry and
   * the crumb, and sits at `/fulfillment` — a heading still naming one of the
   * two would read as the wrong page to anyone arriving for the other.
   */
  page: {
    eyebrow: 'Operations',
    title: 'Fulfilment',
    description:
      'The fulfilment tasks waiting to be worked. Assign one to a packer ahead of time, or leave it open for whoever picks it up first.',
  },

  /**
   * The grouping-axis switch (screen merge).
   *
   * Two questions over one read: "who packs this" and "where is it packed
   * from". The board is the staffing answer; the second axis is what the
   * worklist this screen absorbed was for.
   */
  groupBy: {
    label: 'Group by',
    packer: 'Packer',
    location: 'Location',
    /** Said in place, because a control that silently stops working is worse. */
    dragUnavailable: 'Drag moves a task between packers — switch to Packer to use it.',
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

  /**
   * One task on the board (#3401). The card answers "who packs this?", so it
   * carries what a supervisor recognises the order by and nothing else - the
   * location id, delivery method and variant ids the execution worklist needs
   * are noise here, and on a phone they filled the screen.
   */
  card: {
    heldBadge: 'On hold',
    summary: (parts: { readonly lines: number; readonly units: number }): string =>
      `${String(parts.lines)} ${parts.lines === 1 ? 'item' : 'items'}, ` +
      `${String(parts.units)} ${parts.units === 1 ? 'unit' : 'units'}`,
  },

  /**
   * Column heads above a lane's cards (the mockup's `.lane__col-heads`),
   * naming the three fixed columns a row's identity, buyer and summary line
   * sit in. No head for the drag grip or the staffing controls — the grip is
   * decorative and the controls are self-explanatory (a labelled select and
   * a labelled checkbox need no column caption).
   */
  columns: {
    order: 'Order',
    buyer: 'Buyer',
    details: 'Details',
  },

  /** The mockup's drag grip (`⠿`) — decorative, `aria-hidden`; the native
   * `title` is its only text, read on hover by a mouse user, who is the
   * only user who can drag at all. */
  drag: {
    gripHint: 'Drag to move to a packer',
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
    /**
     * The overflow-menu trigger holding the server-declared action set
     * (Hold, Release hold, Force cancel, …) — the mockup's own reason for a
     * card-level menu: five inline buttons made every card a different
     * height and the row stopped lining up. The "Move to" select and the
     * self-serve checkbox stay inline; only the action SET moves behind
     * this trigger.
     */
    moreActionsLabel: 'More actions',
    // No `hold` key: this screen's own "Hold" label is gone. Every action
    // label now comes from `fulfillmentActionLabel` via `FulfillmentTaskActions`,
    // so the button reads "Put on hold" here exactly as it does on the order
    // panel — one action, one word for it.
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
    message: 'Nothing is waiting to be packed. With fulfilment routing switched off, that is expected.',
  },

  rosterError: {
    message: 'The packer roster could not be loaded, so tasks can only be held or left unassigned.',
  },
} as const;
