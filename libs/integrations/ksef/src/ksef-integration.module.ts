/**
 * KSeF Integration Module
 *
 * Host wiring for the KSeF Public API v2 plugin. It uses the SDK's
 * `createNestAdapterModule`: the helper imports the
 * integrations/sync/identifier-mapping modules, builds the `HostServices` bag
 * from DI, and registers the manifest + factory + the descriptor's
 * side-registrations (the config/credentials validators).
 *
 * One plugin-scoped provider (DEF-06): it hands the host's Redis client to the
 * shared KSeF rate limiter, so the api and every worker replica count against
 * ONE rolling-hour log per seller, as KSeF does. The provider is `optional` on
 * `REDIS_CLIENT`: a host without Redis keeps the in-process log, which is exact
 * for a single process.
 *
 * Added to `apps/api/src/plugins.ts` and `apps/worker/src/plugins.ts` as the
 * single edit point that enables the plugin in both hosts.
 *
 * @module libs/integrations/ksef/src
 */
import type { DynamicModule } from '@nestjs/common';
import { createNestAdapterModule } from '@openlinker/plugin-sdk';
import { createKsefPlugin } from './ksef-plugin';
import { getSharedKsefRateLimiter } from './infrastructure/http/ksef-rate-limiter';
import {
  RedisKsefRateLimitStore,
  type KsefRateLimitRedisClient,
} from './infrastructure/http/ksef-rate-limit-stores';

/** Token of the provider whose only job is the side effect of wiring the store. */
export const KSEF_SHARED_RATE_LIMIT_STORE = Symbol('KsefSharedRateLimitStore');

export const KsefIntegrationModule: DynamicModule = createNestAdapterModule({
  plugin: createKsefPlugin(),
  providers: [
    {
      provide: KSEF_SHARED_RATE_LIMIT_STORE,
      useFactory: (redis?: KsefRateLimitRedisClient): boolean => {
        if (!redis) {
          return false;
        }
        getSharedKsefRateLimiter().useStore(new RedisKsefRateLimitStore(redis));
        return true;
      },
      inject: [{ token: 'REDIS_CLIENT', optional: true }],
    },
  ],
});
