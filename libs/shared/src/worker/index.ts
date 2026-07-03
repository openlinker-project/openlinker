/**
 * Worker Concern Barrel
 *
 * Public entry point for worker-health primitives shared between the worker
 * (heartbeat writer) and the API (heartbeat reader). Consumers import from
 * `@openlinker/shared/worker`, never the internal file paths.
 *
 * @module libs/shared/src/worker
 */
export * from './worker-health.constants';
