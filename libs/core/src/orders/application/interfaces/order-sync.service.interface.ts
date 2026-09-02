/**
 * Order Sync Service Interface
 *
 * Defines the contract for order synchronization operations. Implemented by
 * OrderSyncService to provide order routing from sources to destination processors.
 *
 * @module libs/core/src/orders/application/interfaces
 * @see {@link OrderSyncService} for the implementation
 */
import type { HoldReason } from '@openlinker/core/order-lifecycle';
import type { Order } from '../../domain/types/order.types';

/**
 * Order sync request metadata
 *
 * Contains source connection information for order synchronization.
 */
export interface OrderSyncRequest {
  /**
   * Unified order with internal OpenLinker IDs
   */
  order: Order;

  /**
   * Source connection ID (where the order originated)
   */
  sourceConnectionId: string;

  /**
   * Optional source event ID (for tracking the event that triggered this sync)
   */
  sourceEventId?: string;

  /**
   * Optional routing filter — the destinations a router selected for this order
   * (#2397, design §5.5).
   *
   * THREE STATES, and they must never be collapsed into two:
   *
   * - **absent** — no routing answer. The fan-out is unfiltered: every active
   *   `OrderProcessorManager` connection except the source, exactly as every
   *   install behaves today.
   * - **present, non-empty** — the fan-out is narrowed to these connection ids.
   * - **present, EMPTY** — a router positively selected nobody. No destination
   *   is provisioned and no `syncStatus[]` entry is written.
   *
   * A caller with no routing answer — no router configured, no decision
   * recorded, a decision it could not resolve — MUST omit this field and must
   * never pass `[]`. Getting that backwards silently stops destination
   * provisioning on every install in existence.
   *
   * Ids naming a connection that is not an eligible destination (unknown,
   * inactive, or the source itself) are not silently dropped — see
   * `syncOrder`'s `@throws`.
   */
  readonly destinationConnectionIds?: readonly string[];
}

/**
 * Order sync result
 *
 * Discriminated union describing the outcome of syncing an order to a single
 * destination processor. `status: 'success'` carries the destination order
 * reference; `status: 'failed'` carries the error message so callers can
 * surface partial failures without losing track of successful destinations.
 *
 * `status: 'skipped_cancelled'` (#2284) is a THIRD, terminal arm rather than a
 * `'failed'` with a code: nothing went wrong, and a distinct arm is what stops
 * any consumer routing the skip into a retry.
 *
 * `status: 'skipped_held'` (#2339) is a FOURTH arm and is the one that is NOT
 * terminal. An open hold is a state an operator removes; the moment they do,
 * the next provisioning run proceeds with no manual repair. So it must never be
 * collapsed into `'skipped_cancelled'` (which asserts the order is over) nor
 * into `'failed'` (which asserts something broke and invites a retry loop
 * against a condition retrying cannot change).
 */
export type OrderSyncResult =
  | {
      destinationConnectionId: string;
      status: 'success';
      orderRef: {
        orderId: string;
        orderNumber?: string;
      };
    }
  | {
      destinationConnectionId: string;
      status: 'failed';
      error: {
        message: string;
        code?: string;
      };
    }
  | {
      destinationConnectionId: string;
      status: 'skipped_cancelled';
      /** When the source cancellation was first recorded (first-write-wins). */
      cancelledAt: Date;
    }
  | {
      destinationConnectionId: string;
      status: 'skipped_held';
      /** The hold that withheld provisioning, for the operator-facing reason. */
      holdId: string;
      holdReason: HoldReason;
    };

/**
 * Order Sync Service Interface
 *
 * Application service for synchronizing orders from sources to destination processors.
 * Routes unified orders (with internal IDs) to configured OrderProcessorManager adapters.
 */
export interface IOrderSyncService {
  /**
   * Sync order to destination processor(s)
   *
   * Resolves all active OrderProcessorManager adapters (excluding the source
   * connection) and dispatches the order to each in parallel. Per-destination
   * failures are isolated — a failed destination yields a `status: 'failed'`
   * result rather than aborting the entire sync.
   *
   * When `request.destinationConnectionIds` is supplied the fan-out is narrowed
   * to those connections (#2397); when it is absent every eligible destination
   * is dispatched to, exactly as before.
   *
   * @param request - Order sync request with order and source metadata
   * @returns Array of sync results — one per DISPATCHED destination. A
   *   filtered-out destination yields no entry at all, by design. The array is
   *   **empty** when a routing decision deliberately named no destination
   *   (`destinationConnectionIds: []`): that is a non-event, not a failure, and
   *   is warn-logged rather than thrown.
   * @throws {NoOrderDestinationsAvailableException} when no eligible
   *   destination could be resolved AND that was not a deliberate empty routing
   *   decision — i.e. either nothing is configured/active (the exception
   *   carries no ids), or a routing decision named connections none of which is
   *   an eligible destination (the exception carries them in
   *   `unresolvedDestinationConnectionIds`). Never thrown for the empty-decision
   *   case above.
   */
  syncOrder(request: OrderSyncRequest): Promise<OrderSyncResult[]>;
}
