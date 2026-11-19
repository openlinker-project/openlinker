/**
 * Order Refund Relay Service Interface
 *
 * @module application/interfaces
 */
import type { SourceRefundObservation } from '../../domain/types/source-refund-observation.types';
import type { OrderSyncStatus } from '../../domain/types/order-sync.types';

export interface RelayObservedRefundsInput {
  internalOrderId: string;
  /** The channel the refund was observed on; never a relay target (ADR-056). */
  sourceConnectionId: string;
  /** The order's per-destination sync rows: which destinations hold a copy. */
  destinations: readonly OrderSyncStatus[];
  observations: readonly SourceRefundObservation[];
}

export interface RefundRelayResult {
  /** Refund requests the destinations settled or accepted. */
  relayed: number;
  /** Destinations that hold a copy but cannot refund it, reported once each. */
  unsupportedDestinations: number;
  /** Requests a destination refused terminally (nothing moved). */
  denied: number;
  /** Requests that threw or could not be sent; retried by the next poll. */
  failed: number;
}

export interface IOrderRefundRelayService {
  /**
   * Mirror refunds a source channel made onto each destination copy of the
   * order that can refund. Best-effort: never throws, one destination or one
   * refund failing does not stop the others.
   */
  relayObservedRefunds(input: RelayObservedRefundsInput): Promise<RefundRelayResult>;
}
