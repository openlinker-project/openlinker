/**
 * Fulfilment — public surface (#2411)
 *
 * The order-detail panel is the only export, because it is the only symbol any
 * module outside this folder imports. #2410's standalone worklist is the second
 * consumer of this slice's api/hooks/lib and adds its own line when it lands —
 * exporting them now would be a public surface with nothing behind it, which is
 * the `frontend-architecture.md § Feature Public Surface` start-narrow rule.
 *
 * @module apps/web/src/features/fulfillment
 */
export { OrderFulfillmentTasksPanel } from './components/order-fulfillment-tasks-panel';
export type { OrderFulfillmentTasksPanelProps } from './components/order-fulfillment-tasks-panel';
