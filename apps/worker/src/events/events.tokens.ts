/**
 * Worker Events Module — DI Tokens
 *
 * @module apps/worker/src/events
 */

/** Dedicated blocking Redis client for the master-deletion stream consumer. */
export const MASTER_DELETION_REDIS_CLIENT_BLOCKING_TOKEN = Symbol(
  'MASTER_DELETION_REDIS_CLIENT_BLOCKING'
);
