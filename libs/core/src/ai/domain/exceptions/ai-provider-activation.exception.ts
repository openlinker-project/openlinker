/**
 * AI Provider Activation Exception
 *
 * Thrown by `AiProviderActiveSettingsService.setActive()` when an admin
 * tries to activate a provider that has no API key configured (and that
 * provider requires one). The HTTP layer maps this to 422 Unprocessable
 * Entity so the FE can surface a "configure a key first" affordance.
 *
 * The message lists *both* sources the operator could fix — DB-stored key
 * (`PUT /ai-provider-settings/keys/{provider}`) and env fallback — so the
 * fix is obvious without trial-and-error.
 *
 * @module libs/core/src/ai/domain/exceptions
 */
import type { AiProvider } from '../types/ai-completion.types';

export class AiProviderActivationError extends Error {
  constructor(
    public readonly provider: AiProvider,
    public readonly envVarName: string | null,
  ) {
    const envHint = envVarName
      ? `${envVarName} env unset; no DB row at ai-provider:${provider}`
      : `no DB row at ai-provider:${provider}`;
    super(
      `Cannot activate AI provider '${provider}': no API key configured (${envHint}). ` +
        `Save a key via PUT /ai-provider-settings/keys/${provider} first.`,
    );
    this.name = 'AiProviderActivationError';
    Error.captureStackTrace(this, this.constructor);
  }
}
