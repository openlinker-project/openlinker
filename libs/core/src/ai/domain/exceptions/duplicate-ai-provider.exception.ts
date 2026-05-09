/**
 * Duplicate AI Provider Exception
 *
 * Thrown when two adapters attempt to register themselves under the same
 * `AiProvider` key on the multi-provider router. Each provider must have at
 * most one registered completion adapter — a collision is a configuration
 * error (typically a copy-paste in `AiIntegrationModule.register()`), so
 * the router fails loudly at boot rather than silently overwriting.
 *
 * Mirrors the integrations-bounded-context pattern introduced in #570 for
 * `AdapterRegistryService.register()` (`DuplicateAdapterKeyException`).
 * Class suffix is `Error` to match the local AI-module convention
 * (`AiCompletionError`); file suffix is `.exception.ts` per
 * `engineering-standards.md` §Naming.
 *
 * @module libs/core/src/ai/domain/exceptions
 */
import type { AiProvider } from '../types/ai-completion.types';

export class DuplicateAiProviderError extends Error {
  constructor(provider: AiProvider) {
    super(
      `AI completion adapter for provider '${provider}' is already registered. ` +
        `Each provider must have exactly one registered adapter.`,
    );
    this.name = 'DuplicateAiProviderError';
    Error.captureStackTrace(this, this.constructor);
  }
}
