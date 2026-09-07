/**
 * Sync Worker Module — DI Tokens
 *
 * @module apps/worker/src/sync
 */

/**
 * The Redis client `JobIntakeConsumer` blocks on.
 *
 * Resolves to the worker's shared `'REDIS_CLIENT'` unless
 * `OL_JOB_INTAKE_DEDICATED_REDIS=true`, in which case it is a dedicated
 * connection of its own — see the provider in `sync-worker.module.ts` for why
 * that distinction is measurable rather than cosmetic.
 */
export const JOB_INTAKE_REDIS_CLIENT_TOKEN = Symbol('JOB_INTAKE_REDIS_CLIENT');
