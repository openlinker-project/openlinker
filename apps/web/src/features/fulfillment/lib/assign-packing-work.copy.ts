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
   * #3428 shipped "Unassigned right now" — a pure count over lanes already
   * read for the board, needing no backend signal. #3424 adds "Oldest
   * unassigned", now that `unassignedSince` exists.
   *
   * "Packers at their benches" ships with #3424's presence signal behind it.
   *
   * The count itself is one line; what it needed was the two states a bare
   * `filter(...).length` gets wrong. A roster read that FAILED must not render
   * `0` - the page already tolerates that failure and keeps working, so a zero
   * there would report an empty warehouse when the truth is that nobody asked.
   * And `online` is a threshold over a heartbeat bumped by BENCH ACTIVITY, so
   * a genuine `0` means nobody has touched a bench recently, not that nobody
   * is signed in - which is why the label says "at their benches" rather than
   * "online".
   */
  metrics: {
    unassignedLabel: 'Unassigned right now',
    oldestUnassignedLabel: 'Oldest unassigned',
    packersAtBenchesLabel: 'Packers at their benches',
    /** Shown when the roster could not be read - never a `0`, which would be a claim. */
    packersAtBenchesUnknownLabel: 'Not known',
    /**
     * Rendered via `EmptyValue` when no pooled task has a known age — an
     * empty pool, or every pooled row predates the `unassignedSince` column.
     */
    oldestUnassignedEmptyLabel: 'No unassigned tasks with a known wait time',
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
    /**
     * #3424 — the pool's own neglect signal: a task has sat in Unassigned
     * for `age` (already compactly formatted, e.g. `"52m"`). `age` is a
     * pre-formatted string rather than a raw instant, so this stays a pure
     * sentence-builder and the rounding rule lives in exactly one place
     * (`assign-packing-work-duration.ts`).
     */
    sitUnassignedBadge: (age: string): string => `Sat unassigned ${age}`,
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
     * Static copy, unlike a packer lane's station/presence line: that one
     * needed a backend signal this system did not have (see
     * `assign-packing-work-lane-section.tsx`'s docblock on why it was
     * withheld) — #3424 supplies it, in `packerSubtitle` below.
     */
    unassignedSubtitle: 'Visible to every packer until claimed or assigned',
    /**
     * #3424 — a packer lane's own `.lane__station` line: the operator-typed
     * station plus live presence, e.g. "Bench 3 / Zebra ZD420 · online". A
     * packer with no `stationLabel` gets presence alone ("online" /
     * "offline") rather than an empty line — the mockup's format assumes a
     * station is always set, which this roster does not guarantee. Offline
     * says so explicitly: a blank line where presence should be reads as
     * "no signal", not "not at the bench", which is a different and false
     * claim (see the lane section's own docblock).
     */
    packerSubtitle: (packer: { readonly online: boolean; readonly stationLabel: string | null }): string => {
      const presence = packer.online ? 'online' : 'offline';
      return packer.stationLabel === null ? presence : `${packer.stationLabel} · ${presence}`;
    },
  },

  row: {
    moveToLabel: 'Move to',
    moveToUnassigned: 'Unassigned',
    selfServeLabel: 'Anyone may claim this',
    /**
     * The SAME control on a row that already has a packer. It is not a
     * different setting - it is the one ADR-074 calls the escape hatch - but
     * it answers a different question there, so it says so. Unticked it is a
     * hard assignment: the named packer, nobody else.
     */
    selfServeAssignedLabel: 'Anyone may still take this',
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
    /**
     * Why these are five sentences and not one (#3415).
     *
     * They used to share `moveFailed`, whose second half - "Nothing has
     * changed" - is a CLAIM, and on a 5xx or a dropped connection it is a
     * claim OpenLinker cannot make: the write may well have landed. The
     * others each have a different remedy, and a supervisor told "could not
     * move this task" when the real answer is "somebody moved it first" will
     * try the same thing again.
     *
     * `staffingFailed` is the fallback rather than a sixth case, and it is
     * deliberately vague about what did or did not happen, because an
     * unrecognised status is exactly the case where we do not know.
     */
    moveFailed: 'Could not move this task. Nothing has changed.',
    moveForbidden: 'You are not allowed to reassign work.',
    moveNotFound: 'That task is no longer here. The board has been refreshed.',
    moveConflict: 'Somebody changed this task first. The board has been refreshed.',
    moveUnknown: 'That did not go through, and we could not tell whether it landed. Check the board.',
    selfServeFailed: 'Could not change who may claim this. Nothing has changed.',
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
