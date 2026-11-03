/**
 * Fulfillment Order Edit Service Interface (#3542, D-C)
 *
 * The seam an order edit uses to reach the work objects a routed order already
 * has. `FulfillmentWorkRepositoryPort` may not cross a context boundary, so a
 * sibling asks this instead.
 *
 * @module libs/core/src/fulfillment/application/interfaces
 */
import type { FulfillmentRequestStatus } from '../../domain/types/fulfillment-request-status.types';
import type { FulfillmentWorkStatus } from '../../domain/types/fulfillment-work-status.types';

/** What the order's work objects say about whether its lines may still change. */
export interface OrderWorkEditAssessment {
  /** Any work whose parcel the packer has already closed. Nothing can change a closed parcel. */
  readonly anyParcelClosed: boolean;
  /** Works already offered to or accepted by a holder, with the holder, for the handoff gates. */
  readonly handedOff: ReadonlyArray<{
    readonly workId: string;
    readonly assignedConnectionId: string | null;
    readonly status: FulfillmentWorkStatus;
    readonly requestStatus: FulfillmentRequestStatus;
  }>;
  /** Works that have started (`in_progress`) or been accepted: lowering a line cancels units underneath someone. */
  readonly underway: boolean;
  /** Units already fulfilled per order line, across every work. A line cannot go below this. */
  readonly fulfilledByLine: Readonly<Record<string, number>>;
  /** The order has no work at all (not routed). */
  readonly unrouted: boolean;
}

export type LowerLineOutcome = 'applied' | 'unrouted' | 'unchanged';

export interface LowerLineQuantityInput {
  readonly orderId: string;
  readonly orderLineId: string;
  /** The line's new total quantity across every work, always lower than today's. */
  readonly newQuantity: number;
}

export interface LowerLineQuantityResult {
  readonly outcome: LowerLineOutcome;
  /** Units newly cancelled by this call; `0` on a replay. */
  readonly cancelledUnits: number;
  readonly workIds: readonly string[];
}

export interface IFulfillmentOrderEditService {
  /** Read-only; never writes. */
  assessForEdit(orderId: string): Promise<OrderWorkEditAssessment>;

  /**
   * Cancel units on the work line(s) carrying one order line so that its total
   * required quantity becomes `newQuantity`: a narrower work object, never a
   * rewrite of `totalQuantity` and never a cancel-and-reroute.
   *
   * Computed from the CURRENT counters and not from a delta, so a retried edit
   * cancels nothing twice (`outcome: 'unchanged'`). It writes the counters
   * through the repository directly and reports NO relay or re-route intent:
   * that is the progress service's job for a holder's progress event, and an
   * operator's own edit is not one.
   *
   * @throws {RangeError} `newQuantity` would fall below what is already fulfilled.
   */
  lowerLineQuantity(input: LowerLineQuantityInput): Promise<LowerLineQuantityResult>;
}
