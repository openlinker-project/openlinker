/**
 * Rate Limit Module
 *
 * `@Global()` process-wide provider of `HttpTransportFactoryPort`, backed
 * by one shared, Redis-backed `RateLimiterRegistry` (#1810, cross-process
 * sharing landed in #2015) — every integration module that builds a
 * `HostServices` bag imports this module and wires the resolved instance
 * in as `host.http`, so every plugin's connection-bound transport shares
 * the same per-connection limiter state rather than each module
 * constructing its own (which would silently multiply the effective cap).
 * Mirrors the existing `'REDIS_CLIENT'` `@Global()` pattern in
 * `RedisConfigModule` — this module depends on that token being available
 * somewhere in the host's module graph (already true for both `apps/api`
 * and `apps/worker`).
 *
 * Because the registry is now Redis-backed, `apps/api` and `apps/worker`
 * (and any horizontally-scaled replica of either) throttle the same
 * connection against ONE shared bucket. The static `OL_WORKER_REPLICAS`
 * cap-division this module used to apply is gone — dividing an
 * already-shared cap further would only shrink the operator's configured
 * rate for no reason. See ADR-038 § "Cross-process coordination" for the
 * full history of the gap this closes.
 *
 * The underlying `RateLimiterRegistry` is ALSO exported under its own token
 * (`RATE_LIMITER_REGISTRY_TOKEN`) — this is the seam a platform-neutral
 * observability read (`apps/api`'s `RateLimitStatusService`, #1941) uses to
 * pull the *same* live limiter state the transport is pacing against,
 * without going through `HttpTransportFactoryPort.for()` (which would
 * construct a limiter as a side effect of a read). Note that under the
 * Redis-backed registry, that read reflects only what THIS process
 * instance has locally observed, not a live cross-process count — see
 * `RedisRateLimiterAdapter`'s file header.
 *
 * This module wires ONLY the Redis-backed factory - see
 * `rate-limiter-registry.ts`'s doc comment for why the in-memory factory
 * has no production caller here (it isn't dead: `RateLimiter` is still
 * composed inside `RedisRateLimiterAdapter` as its degraded-mode fallback).
 * This factory resolves the `'REDIS_CLIENT'` token that `RedisConfigModule`
 * provides - imported below (rather than merely documented as a required
 * host-graph member) so the dependency is structural: `RedisConfigModule` is
 * `@Global()`, so importing it here is a no-op if a host already imports it
 * elsewhere, and provides the token directly for a host that doesn't.
 *
 * @module libs/plugin-sdk/src
 */
import { Global, Module } from '@nestjs/common';
import { createRedisRateLimiterRegistry } from '@openlinker/shared/rate-limit';
import type { RateLimiterRegistry } from '@openlinker/shared/rate-limit';
import { HttpTransportFactory } from '@openlinker/shared/http';
import type { HttpTransportFactoryPort } from '@openlinker/shared/http';
import { RedisConfigModule } from '@openlinker/shared/redis';

export const HTTP_TRANSPORT_FACTORY_TOKEN = Symbol('HttpTransportFactoryPort');
export const RATE_LIMITER_REGISTRY_TOKEN = Symbol('RateLimiterRegistry');

/**
 * Inferred from `createRedisRateLimiterRegistry`'s own parameter rather than
 * importing `RedisClientType` from `redis` directly — `plugin-sdk` has no
 * dependency on the `redis` package (only `@openlinker/shared` does), and a
 * type-only import would still require declaring one.
 */
type RedisClient = Parameters<typeof createRedisRateLimiterRegistry>[0];

@Global()
@Module({
  imports: [RedisConfigModule],
  providers: [
    {
      provide: RATE_LIMITER_REGISTRY_TOKEN,
      inject: ['REDIS_CLIENT'],
      useFactory: (redisClient: RedisClient): RateLimiterRegistry =>
        createRedisRateLimiterRegistry(redisClient),
    },
    {
      provide: HTTP_TRANSPORT_FACTORY_TOKEN,
      inject: [RATE_LIMITER_REGISTRY_TOKEN],
      useFactory: (registry: RateLimiterRegistry): HttpTransportFactoryPort =>
        new HttpTransportFactory({ registry }),
    },
  ],
  exports: [HTTP_TRANSPORT_FACTORY_TOKEN, RATE_LIMITER_REGISTRY_TOKEN],
})
export class RateLimitModule {}
