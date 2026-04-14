/**
 * Worker Health Constants
 *
 * Shared constants for worker health monitoring between worker and API.
 * Both apps reference the same Redis key to maintain consistency.
 *
 * @module libs/shared/src/worker
 */

/**
 * Redis key where worker writes its heartbeat timestamp.
 * Worker writes this every 10 seconds with 120s TTL.
 * API reads this to determine worker health status.
 */
export const WORKER_HEARTBEAT_REDIS_KEY = 'openlinker:worker:heartbeat';
