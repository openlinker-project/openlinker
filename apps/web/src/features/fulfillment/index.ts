/**
 * Fulfilment — public surface (#2411)
 *
 * The order-detail panel is the only export today. #2410's standalone worklist
 * is the second consumer of this slice's api/hooks/lib; those stay internal
 * until it needs them, per the start-narrow rule in
 * `docs/frontend-architecture.md § Feature Public Surface`.
 *
 * @module apps/web/src/features/fulfillment
 */
export { OrderFulfillmentTasksPanel } from './components/order-fulfillment-tasks-panel';
export type { OrderFulfillmentTasksPanelProps } from './components/order-fulfillment-tasks-panel';
export { fulfillmentQueryKeys } from './api/fulfillment.query-keys';
export type {
  FulfillmentTask,
  FulfillmentTaskHold,
  FulfillmentTaskLine,
  FulfillmentTaskPage,
} from './api/fulfillment.types';
