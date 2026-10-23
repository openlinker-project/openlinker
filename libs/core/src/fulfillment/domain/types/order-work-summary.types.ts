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
  /**
   * Who packs it, for a stage before `packed` (#3482, mockup: "To pack ·
   * Unassigned", "Packing · <name>").
   *
   * - `single`: every live work agrees; `assignedToUserId` is that packer, or
   *   `null` for "Unassigned".
   * - `mixed`: a split order whose works are assigned to different people (or
   *   some to nobody); no single name is true, so none is reported.
   */
  readonly assignment: 'single' | 'mixed';
  readonly assignedToUserId: string | null;
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
  /**
   * At least one NON-voided verification (a scan) exists on the work. The bench
   * writes one per scan and never moves `status`, so this is the only fact that
   * says "someone is packing this box right now".
   */
  readonly hasVerification: boolean;
  /** The packer the work is assigned to, `null` when nobody is (ADR-074). */
  readonly assignedToUserId: string | null;
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
 * - A scan on the work (`hasVerification`) with the box still open is packing:
 *   the bench records scans in its verification ledger, not in `status`.
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
      if (work.parcelClosedAt) return 'packed';
      return work.hasVerification ? 'packing' : 'to-pack';
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
  const live = works.filter((work) => stageOfFulfillmentWork(work) !== null);
  const stages = live.map((work) => stageOfFulfillmentWork(work) as OrderWorkStage);
  if (stages.length === 0) return null;

  const earliest = OrderWorkStageValues.find((stage) => stages.includes(stage));
  // `stages` is non-empty and holds only members of the union, so `find` cannot
  // miss; the guard keeps the return type honest without a non-null assertion.
  if (earliest === undefined) return null;

  const assignees = new Set(live.map((work) => work.assignedToUserId));
  const [onlyAssignee] = [...assignees];
  return assignees.size === 1
    ? { stage: earliest, workCount: stages.length, assignment: 'single', assignedToUserId: onlyAssignee ?? null }
    : { stage: earliest, workCount: stages.length, assignment: 'mixed', assignedToUserId: null };
};
