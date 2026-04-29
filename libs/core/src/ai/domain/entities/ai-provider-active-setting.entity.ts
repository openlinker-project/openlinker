/**
 * AI Provider Active Setting Domain Entity
 *
 * Singleton-row representation of which AI provider is currently active for
 * completion routing. The active provider is read on every completion call
 * by `MultiProviderAiCompletionAdapter`; rotation is admin-driven via the
 * `/ai-provider-settings/active` HTTP endpoint.
 *
 * @module libs/core/src/ai/domain/entities
 */
import type { AiProvider } from '../types/ai-completion.types';

export const AI_PROVIDER_ACTIVE_SETTING_SINGLETON_ID = 'singleton';

export class AiProviderActiveSetting {
  constructor(
    public readonly activeProvider: AiProvider,
    public readonly updatedAt: Date,
    public readonly updatedBy: string | null,
  ) {}
}
