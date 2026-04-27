/**
 * Cache Module Exports
 *
 * Public API for the shared cache abstraction. Adapters depend on
 * `CachePort` injected via `CACHE_PORT_TOKEN`.
 *
 * @module libs/shared/src/cache
 */
export type { CachePort } from './cache.port';
export { CACHE_PORT_TOKEN } from './cache.types';
export { CacheModule } from './cache.module';
export { RedisCacheAdapter } from './redis-cache.adapter';
