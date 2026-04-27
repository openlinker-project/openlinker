/**
 * Cache Module
 *
 * Binds CachePort (via CACHE_PORT_TOKEN) to RedisCacheAdapter. Marked @Global
 * so adapters across the monorepo can inject the port without importing
 * CacheModule into every feature module. Imports RedisConfigModule for the
 * underlying 'REDIS_CLIENT' provider.
 *
 * @module libs/shared/src/cache
 */
import { Global, Module } from '@nestjs/common';
import { RedisConfigModule } from '../redis';
import { CACHE_PORT_TOKEN } from './cache.types';
import { RedisCacheAdapter } from './redis-cache.adapter';

@Global()
@Module({
  imports: [RedisConfigModule],
  providers: [
    RedisCacheAdapter,
    { provide: CACHE_PORT_TOKEN, useExisting: RedisCacheAdapter },
  ],
  exports: [CACHE_PORT_TOKEN],
})
export class CacheModule {}
