/**
 * AI Bounded Context — Public Surface
 *
 * Exports the capability port, types, exceptions, and DI token. Implemented
 * by adapters in libs/integrations/ai. The bounded context intentionally has
 * no application services — the port is the surface application code consumes.
 *
 * @module libs/core/src/ai
 */
export * from './domain/ports/ai-completion.port';
export * from './domain/types/ai-completion.types';
export * from './domain/exceptions/ai-completion.exception';
export * from './domain/exceptions/ai-rate-limit.exception';
export * from './domain/exceptions/ai-timeout.exception';
export * from './domain/exceptions/ai-invalid-response.exception';
export * from './ai.tokens';
