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

export interface LowerLineQuantityResult {
  readonly outcome: LowerLineOutcome;
  /** Units newly cancelled by this call; `0` on a replay. */
  readonly cancelledUnits: number;
  readonly workIds: readonly string[];
}

export type AddLineToWorkOutcome = 'added' | 'unrouted' | 'no-eligible-work' | 'unchanged';

export interface AddLineToWorkInput {
  readonly orderId: string;
  /** The added line's own id on the order (e.g. `op-gift:{changeId}`). */
  readonly orderLineId: string;
  readonly productVariantId: string;
  readonly quantity: number;
  /**
   * Whether a holder is one whose pick list reads OpenLinker's own work lines.
   * Supplied by the caller because that is an integration fact this context may
   * not resolve (ADR-053); an outside holder was sent its lines and cannot be told.
   */
  readonly acceptsHolder: (connectionId: string | null) => Promise<boolean>;
}

export interface AddLineToWorkResult {
  readonly outcome: AddLineToWorkOutcome;
  readonly workId: string | null;
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
   * Add one line to the order's open work held by an accepted holder (#3940).
   * Never creates work and never re-routes: an order with no work is
   * `unrouted`, one whose every work is closed, terminal or held elsewhere is
   * `no-eligible-work`, and a repeat is `unchanged`.
   */
  addLineToOpenWork(input: AddLineToWorkInput): Promise<AddLineToWorkResult>;
}
