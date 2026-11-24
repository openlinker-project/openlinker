/**
 * Worker Sync Module - DI Tokens
 *
 * @module apps/worker/src/sync
 */

/**
 * Dedicated Redis client for `JobIntakeConsumer`'s blocking `XREADGROUP` loop.
 *
 * A blocking read occupies its connection for up to `BLOCK_MS`, and every
 * command queued behind it on the same node-redis client waits that long. On
 * the shared `'REDIS_CLIENT'` that starved the cross-process rate limiter,
 * whose calls time out after one second and fall back to per-process limiting,
 * so a shop's request budget silently stopped being shared between the api and
 * the worker.
 */
export const JOB_INTAKE_REDIS_CLIENT_BLOCKING_TOKEN = Symbol('JOB_INTAKE_REDIS_CLIENT_BLOCKING');
