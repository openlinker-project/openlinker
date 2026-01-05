/**
 * Dependency Injection Tokens
 *
 * Symbol tokens for dependency injection in the events module.
 * These tokens are used to inject interfaces (which can't be used as values)
 * into services and other providers.
 *
 * @module libs/core/src/events
 */

// Token for dependency injection (interfaces can't be used as values)
export const EVENT_PUBLISHER_TOKEN = Symbol('EventPublisherPort');




