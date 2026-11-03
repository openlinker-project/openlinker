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

// #2301, D48
export const STREAM_DEAD_LETTER_REPOSITORY_TOKEN = Symbol('StreamDeadLetterRepositoryPort');
export const STREAM_DEAD_LETTERS_SERVICE_TOKEN = Symbol('IStreamDeadLettersService');






