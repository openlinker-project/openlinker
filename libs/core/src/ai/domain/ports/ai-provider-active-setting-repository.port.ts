/**
 * AI Provider Active Setting Repository Port
 *
 * Persistence contract for the singleton-row `ai_provider_active_setting`
 * table. Implemented by `AiProviderActiveSettingRepository` in the
 * infrastructure layer; consumed by `AiProviderActiveSettingsService`.
 *
 * @module libs/core/src/ai/domain/ports
 */
import type { AiProvider } from '../types/ai-completion.types';
import type { AiProviderActiveSetting } from '../entities/ai-provider-active-setting.entity';

export interface AiProviderActiveSettingRepositoryPort {
  /**
   * Read the singleton row. Returns `null` when no row exists yet — callers
   * are expected to fall back to env-var resolution and create the row on
   * first admin write.
   */
  findActive(): Promise<AiProviderActiveSetting | null>;

  /**
   * Idempotently set the active provider on the singleton row. Creates the
   * row if absent.
   */
  upsertActive(activeProvider: AiProvider, updatedBy: string | null): Promise<AiProviderActiveSetting>;
}
