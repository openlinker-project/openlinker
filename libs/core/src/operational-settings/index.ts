/**
 * Operational Settings Context Public API
 *
 * The operator-settable sweep budgets and deletion-audit cadence (#2651): one
 * singleton row, resolution `DB row -> env var -> code default`, and a view
 * that reports which rung answered.
 *
 * A LEAF context - nothing here imports a sibling `@openlinker/core/*`
 * context, and nothing here speaks HTTP.
 *
 * @module libs/core/src/operational-settings
 */

// Types + the pure rules that belong to them
export {
  DELETION_AUDIT_CADENCE_DEFAULT,
  DELETION_AUDIT_CADENCE_ENV_VAR,
  OPERATIONAL_SETTING_BOUNDS,
  OPERATIONAL_SETTING_KEYS,
  OPERATIONAL_SETTING_SOURCES,
  checkOperationalSettingBound,
  clampToAdapterPageSize,
  readOperationalSettingEnv,
  resolveOperationalSetting,
} from './domain/types/operational-settings.types';
export type {
  OperationalSettingBound,
  OperationalSettingKey,
  OperationalSettingSource,
  OperationalSettingsInput,
  OperationalSettingsView,
  ResolvedOperationalNumber,
  ResolvedOperationalSetting,
} from './domain/types/operational-settings.types';

// Entities
export {
  OperationalSettings,
  OPERATIONAL_SETTINGS_SINGLETON_ID,
} from './domain/entities/operational-settings.entity';

// Ports
export type { OperationalSettingsRepositoryPort } from './domain/ports/operational-settings-repository.port';

// Exceptions
export { InvalidOperationalSettingError } from './domain/exceptions/operational-settings.exception';

// Application service interfaces
export type { IOperationalSettingsService } from './application/services/operational-settings.service.interface';

// Module + tokens
export { OperationalSettingsModule } from './operational-settings.module';
export * from './operational-settings.tokens';
