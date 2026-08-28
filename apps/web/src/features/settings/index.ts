/**
 * Settings feature barrel (#2653)
 *
 * @module apps/web/src/features/settings
 */
export { SyncPacingTile } from './components/sync-pacing-tile';
export { SyncPacingConfirmDialog } from './components/sync-pacing-confirm-dialog';
export { SyncPacingImpact } from './components/sync-pacing-impact';
export { useOperationalSettingsQuery } from './hooks/use-operational-settings-query';
export { useUpdateOperationalSettingsMutation } from './hooks/use-update-operational-settings-mutation';
export * from './lib/sync-pacing-model';
export * from './lib/sync-pacing-changes';
export * from './lib/deletion-audit-cadence';
export * from './lib/map-operational-settings-errors';
export type {
  OperationalSettingsView,
  UpdateOperationalSettingsInput,
} from './api/operational-settings.types';
