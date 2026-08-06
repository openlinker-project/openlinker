/**
 * Rate Limit Status Service
 *
 * Read-only projection of ANY connection's live, in-memory outbound
 * rate-limit status — platform-neutral (#1810 Phase 4 rebase of the
 * PrestaShop-only #1815 prerequisite; the previous PrestaShop-scoped
 * `platformType === 'prestashop'` guard is gone). Reads the *effective*
 * policy the shared transport is actually pacing against —
 * `Connection.config.rateLimit` if explicitly set, else the resolved
 * adapter's `AdapterMetadata.defaultRateLimit` fallback (mirroring
 * `HttpTransportFactory`'s own resolution order) — then pulls live
 * in-flight/queued counters from the same `RateLimiterRegistry` instance
 * `HttpTransportFactory` is backed by. Never calls the destination
 * platform, never consumes a rate-limit slot.
 *
 * @module apps/api/src/integrations/application/services
 * @implements {IRateLimitStatusService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { ConnectionPort, CONNECTION_PORT_TOKEN } from '@openlinker/core/identifier-mapping';
import type { ConnectionRateLimit } from '@openlinker/core/identifier-mapping';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import { RATE_LIMITER_REGISTRY_TOKEN } from '@openlinker/plugin-sdk';
// Non-type-only import: RateLimiterRegistry is the type of a constructor
// parameter on an @Injectable() class, and `emitDecoratorMetadata` requires
// a non-erased reference (mirrors the HttpTransportFactoryPort convention).
import { RateLimiterRegistry } from '@openlinker/shared/rate-limit';
import { Logger } from '@openlinker/shared/logging';
import type { IRateLimitStatusService } from '../interfaces/rate-limit-status.service.interface';
import type { EffectiveRateLimitStatus } from '../types/rate-limit-status.types';

@Injectable()
export class RateLimitStatusService implements IRateLimitStatusService {
  private readonly logger = new Logger(RateLimitStatusService.name);

  constructor(
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connectionPort: ConnectionPort,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(RATE_LIMITER_REGISTRY_TOKEN)
    private readonly rateLimiterRegistry: RateLimiterRegistry
  ) {}

  async getStatus(connectionId: string): Promise<EffectiveRateLimitStatus> {
    const connection = await this.connectionPort.get(connectionId);

    const explicit = connection.config?.rateLimit;
    const effective = explicit ?? (await this.resolveDefaultRateLimit(connection));

    if (!effective || (effective.requestsPerMinute === undefined && effective.maxConcurrent === undefined)) {
      return { enabled: false };
    }

    const live = this.rateLimiterRegistry.getStatus(connectionId);

    return {
      enabled: true,
      requestsPerMinute: effective.requestsPerMinute,
      maxConcurrent: effective.maxConcurrent,
      inFlight: live?.inFlight ?? 0,
      queued: live?.queued ?? 0,
      lastAcquiredAt: live?.lastAcquiredAt ?? null,
    };
  }

  /**
   * Falls back to the resolved adapter's manifest default (#1810 Phase 4) —
   * mirrors `HttpTransportFactory`'s own `config.rateLimit ?? defaultRateLimit`
   * resolution so this read never reports "unlimited" for a connection the
   * transport is actually pacing.
   */
  private async resolveDefaultRateLimit(connection: {
    platformType: string;
    adapterKey?: string;
  }): Promise<ConnectionRateLimit | undefined> {
    try {
      const metadata = await this.integrationsService.resolveAdapterMetadata({
        platformType: connection.platformType,
        adapterKey: connection.adapterKey,
      });
      return metadata.defaultRateLimit;
    } catch (error) {
      this.logger.warn(
        `Could not resolve adapter metadata while reading rate-limit status (platformType=${connection.platformType}, adapterKey=${connection.adapterKey ?? '<derived>'}): ${(error as Error).message}`
      );
      return undefined;
    }
  }
}
