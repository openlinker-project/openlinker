/**
 * AI Provider Key Missing Exception
 *
 * Thrown by `AiProviderCredentialsPort.getApiKey()` when no API key is
 * resolvable for the active provider — neither in the encrypted credentials
 * store nor in the env-var fallback. The Vercel completion adapter
 * propagates this; admins resolve it by PUT-ing a key through the admin
 * settings endpoint.
 *
 * @module libs/core/src/ai/domain/exceptions
 */
export class AiProviderKeyMissingError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AiProviderKeyMissingError';
    Error.captureStackTrace(this, this.constructor);
  }
}
