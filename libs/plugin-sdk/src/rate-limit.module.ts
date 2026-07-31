/**
 * Rate Limit Module
 *
 * `@Global()` process-wide provider of `HttpTransportFactoryPort`, backed
 * by one shared `RateLimiterRegistry` (#1810) — every integration module
 * that builds a `HostServices` bag imports this module and wires the
 * resolved instance in as `host.http`, so every plugin's connection-bound
 * transport shares the same per-connection limiter state rather than each
 * module constructing its own (which would silently multiply the
 * effective cap). Mirrors the existing `'REDIS_CLIENT'` `@Global()`
 * pattern in `RedisConfigModule`.
 *
 * The underlying `RateLimiterRegistry` is ALSO exported under its own token
 * (`RATE_LIMITER_REGISTRY_TOKEN`) — this is the seam a platform-neutral
 * observability read (`apps/api`'s `RateLimitStatusService`, rebased from
 * the PrestaShop-only #1815 prerequisite) uses to pull the *same* live
 * limiter state the transport is pacing against, without going through
 * `HttpTransportFactoryPort.for()` (which would construct a limiter as a
 * side effect of a read).
 *
 * @module libs/plugin-sdk/src
 */
import { Global, Module } from '@nestjs/common';
import { createRateLimiterRegistry } from '@openlinker/shared/rate-limit';
import type { RateLimiterRegistry } from '@openlinker/shared/rate-limit';
import { HttpTransportFactory } from '@openlinker/shared/http';
import type { HttpTransportFactoryPort } from '@openlinker/shared/http';

export const HTTP_TRANSPORT_FACTORY_TOKEN = Symbol('HttpTransportFactoryPort');
export const RATE_LIMITER_REGISTRY_TOKEN = Symbol('RateLimiterRegistry');

/**
 * Static multi-replica cap division (#1810 v1) — an operator running N
 * worker/API replicas divides each connection's configured cap so the
 * *effective* aggregate rate stays at the configured value instead of N×
 * multiplying it (the failure mode #1772 reported). A future Redis-backed
 * shared-cap upgrade is a documented follow-up behind the same
 * `RateLimiterPort`; this is deliberately not that.
 */
function resolveReplicaCount(): number {
  const raw = process.env.OL_WORKER_REPLICAS;
  if (!raw) return 1;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

@Global()
@Module({
  providers: [
    {
      provide: RATE_LIMITER_REGISTRY_TOKEN,
      useFactory: (): RateLimiterRegistry => createRateLimiterRegistry(),
    },
    {
      provide: HTTP_TRANSPORT_FACTORY_TOKEN,
      inject: [RATE_LIMITER_REGISTRY_TOKEN],
      useFactory: (registry: RateLimiterRegistry): HttpTransportFactoryPort =>
        new HttpTransportFactory({
          registry,
          replicas: resolveReplicaCount(),
        }),
    },
  ],
  exports: [HTTP_TRANSPORT_FACTORY_TOKEN, RATE_LIMITER_REGISTRY_TOKEN],
})
export class RateLimitModule {}
