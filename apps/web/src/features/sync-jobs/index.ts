/**
 * Sync Jobs — public surface
 *
 * Public barrel for the sync-jobs feature (#609). Cross-feature consumers
 * (today: `features/connections` for the trigger-sync dialog on the
 * connection action panel) import from here.
 */
export { TriggerSyncDialog } from './components/TriggerSyncDialog';
