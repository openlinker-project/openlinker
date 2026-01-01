/**
 * Dependency Injection Tokens
 *
 * Symbol tokens for dependency injection in the sync module.
 * These tokens are used to inject interfaces (which can't be used as values)
 * into services and other providers.
 *
 * @module libs/core/src/sync
 */

// Token for dependency injection (interfaces can't be used as values)
export const JOB_ENQUEUE_TOKEN = Symbol('JobEnqueuePort');

