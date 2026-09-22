/**
 * Pack-bench topbar copy (#3423; way-out added as a #3340 follow-up)
 *
 * @module apps/web/src/features/bench/lib
 */
export const benchTopbarCopy = {
  parentCrumb: 'Operations',
  currentCrumb: 'Pack bench',

  /**
   * Named for the destination, not for the gesture. "Back" says nothing about
   * where back is, and this control is the only exit from a route that renders
   * no sidebar — the admin pressing it wants the work list, not the previous
   * page in their history.
   */
  leaveAction: 'Leave the bench',
} as const;
