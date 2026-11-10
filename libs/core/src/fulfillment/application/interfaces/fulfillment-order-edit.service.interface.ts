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

/**
 * One component of a bundle line (#3607, ADR-083 decision 6). `fulfillment` is a
 * zero-sibling-edge leaf, so the caller hands the mapping in as data: the work
 * lines of a bundle line carry the COMPONENT line ids, and `perUnit` is the
 * component units per ONE bundle unit.
 */
export interface LineComponentRef {
  readonly componentLineId: string;
  readonly perUnit: number;
}

/** Bundle line id -> its components. Absent / empty for an ordinary line. */
export type LineComponentsByLine = Readonly<Record<string, readonly LineComponentRef[]>>;

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
  /**
   * Units each order line still requires across its non-terminal works
   * (`totalQuantity - cancelledQuantity`, the bench's own definition). A line no
   * live work carries is ABSENT, never present with a zero (#3961).
   */
  readonly requiredByLine: Readonly<Record<string, number>>;
  /**
   * Units the packer has already verified into a box, per order line, across
   * non-terminal works. Absent means none (#3961). A source change that would
   * leave fewer units than this cannot be applied silently: the box holds more.
   */
  readonly verifiedByLine: Readonly<Record<string, number>>;
}

export interface HoldForSourceChangeInput {
  readonly orderId: string;
}

export interface HoldForSourceChangeResult {
  /** Works this call newly held; a work already carrying the hold is skipped. */
  readonly heldWorkIds: readonly string[];
}

export interface ReleaseSourceChangeHoldsResult {
  readonly releasedHoldIds: readonly string[];
}

export type LowerLineOutcome = 'applied' | 'unrouted' | 'unchanged';

export interface LowerLineQuantityInput {
  readonly orderId: string;
  readonly orderLineId: string;
  /** The line's components when it is a bundle line; the target scales per component. */
  readonly components?: readonly LineComponentRef[];
  /** The line's new total quantity across every work, always lower than today's. */
  readonly newQuantity: number;
}

/**
 * A parcel the lowered quantity left exactly full, and that this call therefore
 * closed (#3961).
 *
 * The close is already recorded as `shipped` progress, so the #2728 relay sweep
 * tells the order's channel even when nobody acts on this. A host that holds
 * the parcel-closure notifier relays it immediately instead of waiting for the
 * sweep - `fulfillment` may not reach `orders` or `shipping`, so it can only
 * report the close, never relay it itself.
 */
export interface ClosedParcelReport {
  readonly workId: string;
  readonly closedAt: Date;
}

export interface LowerLineQuantityResult {
  readonly outcome: LowerLineOutcome;
  /** Units newly cancelled by this call; `0` on a replay. */
  readonly cancelledUnits: number;
  readonly workIds: readonly string[];
  /** Parcels this call closed; empty unless a box was left exactly full. */
  readonly closedParcels: readonly ClosedParcelReport[];
}

export interface IFulfillmentOrderEditService {
  /**
   * Read-only; never writes. `components` maps bundle lines to their component
   * lines, so `fulfilledByLine` still answers per COMMERCIAL line, in bundle
   * units (the fewest whole bundles every component has fulfilled).
   */
  assessForEdit(
    orderId: string,
    components?: LineComponentsByLine
  ): Promise<OrderWorkEditAssessment>;

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

  /**
   * Hold every non-terminal work of the order because the order source changed
   * a line and the change cannot be applied without a decision (#3961). A held
   * box is refused at the bench, which is the point.
   *
   * Idempotent: a work already carrying an active hold placed by
   * `SOURCE_CHANGE_HOLD_ACTOR` is skipped, so a repeated ingestion of the
   * same state places nothing.
   */
  holdForSourceChange(input: HoldForSourceChangeInput): Promise<HoldForSourceChangeResult>;

  /**
   * Release the holds {@link holdForSourceChange} placed, and only those: an
   * operator's own hold on the same work stays. Idempotent.
   */
  releaseSourceChangeHolds(orderId: string): Promise<ReleaseSourceChangeHoldsResult>;
}
