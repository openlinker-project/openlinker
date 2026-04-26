/**
 * AI Provider Settings Not Applicable Exception
 *
 * Thrown by `AiProviderSettingsService.set()` / `clear()` when the active
 * provider does not require an API key (e.g. `OL_AI_PROVIDER=fake`). The
 * admin controller catches this and translates it to HTTP 400 so the
 * frontend can surface a clear "this provider doesn't take a key" message.
 *
 * @module libs/core/src/ai/domain/exceptions
 */
import type { AiProvider } from '../types/ai-completion.types';

export class AiProviderSettingsNotApplicableError extends Error {
  constructor(public readonly provider: AiProvider) {
    super(`Active AI provider '${provider}' does not require an API key.`);
    this.name = 'AiProviderSettingsNotApplicableError';
    Error.captureStackTrace(this, this.constructor);
  }
}
