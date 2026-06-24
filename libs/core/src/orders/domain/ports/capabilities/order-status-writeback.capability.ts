/**
 * Order Status Writeback Capability (event-as-data)
 *
 * The single, **platform-neutral, role-agnostic** writeback capability of the
 * Posture-A lifecycle relay (#1157 / ADR-027). Every order participant adapter
 * — a source marketplace *or* a destination shop — declares `implements
 * OrderStatusWriteback` and maps each {@link OrderLifecycleEvent} onto its own
 * API. The relay dispatches through this one contract via {@link
 * isOrderStatusWriteback}, with **zero platform-type branching**, so
 * marketplace↔shop and shop→shop are served by construction.
 *
 * Collapses the writeback role of the earlier `OrderDispatchNotifier`
 * (source-side, event-specific) and `OrderFulfillmentUpdater` (destination-side,
 * generic status setter): the lifecycle event is carried as **data**, and
 * per-participant support is reported via {@link OrderWritebackResult} rather
 * than the type signature. `OrderFulfillmentUpdater` is retained for order
 * *provisioning* (OL driving an order it created), outside the relay path.
 *
 * The guard is generic over the resolved adapter type because the same adapter
 * object may be resolved as an `OrderProcessorManager` (destination) or an
 * `OrderSource` (source) depending on the order's topology.
 *
 * @module libs/core/src/orders/domain/ports/capabilities
 * @see {@link OrderLifecycleEvent} for the event payload
 */
import type {
  OrderLifecycleEvent,
  OrderWritebackResult,
} from '../../types/order-lifecycle-event.types';

export interface OrderStatusWriteback {
  /**
   * Apply a lifecycle event to this participant's order. Best-effort and
   * idempotent at the adapter level (a re-applied event that's already in
   * effect is a no-op `applied`). Returns the per-participant outcome; the
   * relay surfaces non-`applied` outcomes to the operator.
   */
  write(event: OrderLifecycleEvent): Promise<OrderWritebackResult>;
}

export function isOrderStatusWriteback<T extends object>(
  adapter: T,
): adapter is T & OrderStatusWriteback {
  return typeof (adapter as Partial<OrderStatusWriteback>).write === 'function';
}
