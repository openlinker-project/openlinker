/**
 * Order Work Summary (#3482)
 *
 * What an order list row needs to say about the pack-bench work that covers an
 * order: that OpenLinker is handling it, and how far the packing has got. A
 * PRESENTATION projection of `FulfillmentWorkStatus`, never persisted: the
 * status stays the one source of truth and this folds it for a list row.
 *
 * ## `null` is "no work", never "not routed for sure"
 *
 * An order with no row here carries no live work object. That covers an order
 * that was never routed, one whose work was cancelled, and one that was routed
 * to nobody; a caller must not read the absence as a positive claim about any
 * of them.
 *
 * ## Why the stage is the EARLIEST one across a split order's works
 *
 * An order split over several works is only as far along as its least-advanced
 * parcel: one packed work beside one still to pack reads `to-pack`, because
 * calling the order "packed" would claim the goods are ready when part of them
 * are not.
 *
 * @module libs/core/src/fulfillment/domain/types
 */
import type { FulfillmentWorkStatus } from './fulfillment-work-status.types';

/**
 * The packing position, in time order. One member per line, no computed keys:
 * the mirror scripts in this repo read arrays textually.
 */
export const OrderWorkStageValues = [
  'to-pack',
  'packing',
  'packed',
] as const;

export type OrderWorkStage = (typeof OrderWorkStageValues)[number];

export interface OrderWorkSummary {
  readonly stage: OrderWorkStage;
  /** How many live works the order has (a split order has several). */
  readonly workCount: number;
}

/**
 * The facts of one work that decide its packing position (#3482).
 *
 * `status` alone is NOT enough: the pack bench records its progress in its OWN
 * columns and never moves `status` (a parcel closed on the bench keeps
 * `status = 'open'`; only the executor-driven events `picked` / `closed` do).
 * Reading only the status therefore reported "To pack" for a parcel that was
 * already shut and labelled.
 */
export interface FulfillmentWorkProgress {
  readonly status: FulfillmentWorkStatus;
  /** Set when the bench shut the box (D18). The bench's own "packed" fact. */
  readonly parcelClosedAt: Date | null;
}

/**
 * Where one work sits in the packing flow, or `null` when it takes no part in it.
 *
 * - A closed parcel is **packed**, whatever `status` says: the bench never
 *   moves `status`, so `parcelClosedAt` is the only fact that says so.
 * - `closed` is packed too (the executor-driven path).
 * - `in_progress` is packing.
 * - `open` / `scheduled` / `on_hold` are still waiting to be packed.
 * - `cancelled` and `incomplete` are not a position in the flow: a cancelled
 *   work is gone, and a short-picked one waits for the router to re-source it,
 *   so neither may make an order look packed - **even with a closed parcel**.
 *
 * Known gap: scanning at the bench BEFORE the box is shut writes no column on
 * the work, so that window still reads `to-pack`.
 */
export const stageOfFulfillmentWork = (work: FulfillmentWorkProgress): OrderWorkStage | null => {
  switch (work.status) {
    case 'cancelled':
    case 'incomplete':
      return null;
    case 'closed':
      return 'packed';
    case 'in_progress':
      return work.parcelClosedAt ? 'packed' : 'packing';
    case 'open':
    case 'scheduled':
    case 'on_hold':
      return work.parcelClosedAt ? 'packed' : 'to-pack';
    default:
      // `status` is a plain `text` column cast at the repository boundary, so a
      // value outside the union is reachable at runtime. Without this arm the
      // function returns `undefined`, which passes the `!== null` filter in
      // `summarizeOrderWork` and inflates `workCount`. An unknown status takes no
      // part in the flow, exactly like `cancelled`.
      return null;
  }
};

/**
 * Fold an order's works into one summary, or `null` when none of them takes part
 * in the packing flow.
 *
 * PURE - no I/O, so the multiplicity rule can be asserted exhaustively without a
 * repository.
 */
export const summarizeOrderWork = (
  works: readonly FulfillmentWorkProgress[]
): OrderWorkSummary | null => {
  const stages = works
    .map(stageOfFulfillmentWork)
    .filter((stage): stage is OrderWorkStage => stage !== null);
  if (stages.length === 0) return null;

  const earliest = OrderWorkStageValues.find((stage) => stages.includes(stage));
  // `stages` is non-empty and holds only members of the union, so `find` cannot
  // miss; the guard keeps the return type honest without a non-null assertion.
  if (earliest === undefined) return null;

  return { stage: earliest, workCount: stages.length };
};
