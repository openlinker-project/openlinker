/**
 * Operational Settings Repository Port
 *
 * Persistence contract for the singleton-row `operational_settings` table.
 * Implemented by `OperationalSettingsRepository`; consumed by
 * `OperationalSettingsService`. Mirrors `PosthogSettingsRepositoryPort`.
 *
 * @module libs/core/src/operational-settings/domain/ports
 */
import type { OperationalSettings } from '../entities/operational-settings.entity';
import type { OperationalSettingsInput } from '../types/operational-settings.types';

export interface OperationalSettingsRepositoryPort {
  /**
   * Read the singleton row. `null` when no row exists yet - callers fall back
   * to env-var resolution.
   */
  findSettings(): Promise<OperationalSettings | null>;

  /**
   * Idempotently upsert the singleton row, creating it if absent.
   *
   * A field the input omits is left as it was; a field explicitly set to
   * `null` is cleared. That distinction is the whole write contract, so it
   * lives in the port doc rather than in one implementation's comment.
   */
  upsertSettings(
    input: OperationalSettingsInput,
    updatedBy: string | null
  ): Promise<OperationalSettings>;
}
