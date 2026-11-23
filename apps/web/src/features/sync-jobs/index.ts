/**
 * Sync Jobs — public surface
 *
 * Public barrel for the sync-jobs feature (#609). Cross-feature consumers
 * (today: `features/connections` for the trigger-sync dialog on the
 * connection action panel) import from here.
 */
export { TriggerSyncDialog } from './components/TriggerSyncDialog';
export { useEnqueueSyncJobMutation } from './hooks/use-enqueue-sync-job-mutation';
export { useRetryGroupedSyncJobsMutation } from './hooks/use-retry-grouped-sync-jobs-mutation';
export { OrderRangeFields } from './components/order-range-fields';
export {
  ORDER_RANGE_DEFAULT_VALUE,
  toOrderImportPayload,
  validateOrderRange,
  type OrderRangeValue,
} from './lib/order-range';
export { syncJobsQueryKeys } from './api/sync.query-keys';
