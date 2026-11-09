/**
 * Order Source Amendment Effects Service Interface (#3961)
 *
 * Carries a line change the order source reported AFTER the order was routed
 * into its packing work, or - when that would need a decision - holds the box
 * and tells the operator. The sibling of `IOrderCancellationEffectsService`,
 * and in core for the same reason: ingestion runs it, and core may not import
 * `apps/api`.
 *
 * @module libs/core/src/orders/application/interfaces
 */
import type { ClosedParcelReport } from '@openlinker/core/fulfillment';

import type {
  SourceAmendmentLine,
  SourceChangeHoldCause,
} from '../../domain/types/source-amendment-plan.types';

export interface ReconcileSourceAmendmentInput {
  /**
   * The order to compare. Its effective lines are read from the stored record
   * (`OrderRecord.orderItems`, the operator overlay applied), so ingestion and
   * an operator's "Check again" run the same comparison.
   */
  readonly internalOrderId: string;
}

export interface AcceptSourceChangeInput {
  readonly internalOrderId: string;
  /** The operator accepting; `null` only for a system caller. */
  readonly actorUserId: string | null;
}

export type SourceAmendmentReconcileOutcome =
  /** Not routed, cancelled, or nothing differs: nothing was written. */
  | 'nothing-to-do'
  /** The work, reservation and master stock were moved to the new quantities. */
  | 'applied'
  /** The box was held and the operator told why. */
  | 'held'
  /** The parcel already left; the change was only reported. */
  | 'shipped'
  /** An operator already accepted exactly this mismatch; the box was released. */
  | 'accepted'
  /** Another writer held the order's edit lock; the next ingestion retries. */
  | 'contended'
  /** A step failed; the attention entry stays and the next ingestion retries. */
  | 'failed';

export interface SourceAmendmentReconcileResult {
  readonly outcome: SourceAmendmentReconcileOutcome;
  readonly lines: readonly SourceAmendmentLine[];
  readonly cause: SourceChangeHoldCause | null;
  /**
   * Parcels the applied change left exactly full and therefore closed. Each is
   * already recorded as shipped, so the relay sweep reports it; a host holding
   * the parcel-closure notifier relays it at once instead. Empty on every
   * outcome except `applied`.
   */
  readonly closedParcels: readonly ClosedParcelReport[];
}

export interface IOrderSourceAmendmentEffectsService {
  /**
   * Compare the order's effective line quantities with its packing work and act
   * on the difference (see `planSourceAmendment`).
   *
   * Safe to call on every ingestion: an order that agrees with its work writes
   * nothing, and every step is idempotent toward a target quantity. Never
   * throws; a failure is reported as `failed` and retried by the next call.
   */
  reconcile(input: ReconcileSourceAmendmentInput): Promise<SourceAmendmentReconcileResult>;

  /**
   * Keep the packing work as it is although the source changed it ("Ship as
   * packed", or "Mark as handled" after shipping). Records the decision as a
   * confirmed `order.source_change_accept` keyed by the exact mismatch, then
   * releases the hold and clears the attention entry. A later, different change
   * from the source is raised again.
   *
   * Answers `nothing-to-do` when there is no mismatch left to accept, and
   * `contended` while another writer holds the order.
   */
  accept(input: AcceptSourceChangeInput): Promise<SourceAmendmentReconcileResult>;
}
