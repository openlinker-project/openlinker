/**
 * Sync Worker Module — DI Tokens
 *
 * @module apps/worker/src/sync
 */

/**
 * The Redis client `JobIntakeConsumer` blocks on.
 *
 * Always a dedicated connection of its own, never the worker's shared
 * `'REDIS_CLIENT'` - a client parked in a blocking `xReadGroup` serves no
 * other commands, and the shared one is the outbound rate limiter's. See the
 * provider in `sync-worker.module.ts` for the mechanism and the measurement
 * (#2840). There is no configuration that shares it.
 */
export const JOB_INTAKE_REDIS_CLIENT_TOKEN = Symbol('JOB_INTAKE_REDIS_CLIENT');
