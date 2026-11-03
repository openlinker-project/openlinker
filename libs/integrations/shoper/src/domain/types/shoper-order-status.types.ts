/**
 * Shoper Order Status Types
 *
 * What the shop says about one order status: its coarse lifecycle `type`
 * (1 new, 2 processing, 3 shipped, 4 terminal) and every per-language label it
 * carries. Type 4 covers cancelled, rejected AND returned, so the labels are what
 * tells a refund from a cancellation.
 *
 * @module libs/integrations/shoper/src/domain/types
 */
export interface ShoperOrderStatusInfo {
  readonly type: number;
  readonly labels: readonly string[];
  /**
   * Whether the shop offers the status. Absent when the row did not say (or the
   * entry was cached by a release that did not read it), which reads as active.
   */
  readonly active?: boolean;
}

/** One `/statuses` row with its id, for callers that pick a status rather than look one up. */
export interface ShoperOrderStatusEntry extends ShoperOrderStatusInfo {
  readonly statusId: string;
}

/**
 * Shoper's coarse status `type`, the only part of a status that means the same
 * in every shop (the labels are the merchant's own words).
 */
export const SHOPER_STATUS_TYPE = {
  New: 1,
  InProgress: 2,
  Completed: 3,
  NotCompleted: 4,
} as const;

/** The two lifecycle events the status writeback expresses by moving the order to a status. */
export type ShoperStatusWritebackTarget = 'cancelled' | 'in-progress';

/** What the order's current status means for a status writeback, decided before anything is written. */
export type ShoperStatusWritebackPlan =
  | { readonly kind: 'write' }
  | { readonly kind: 'already-applied' }
  | { readonly kind: 'refused'; readonly reason: string };
