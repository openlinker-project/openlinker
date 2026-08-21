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
import {
  EAN_CATEGORY_MATCHER_STREAMING_CAPABILITY,
  isEanCategoryMatcherStreaming,
  type EanCategoryMatcherStreaming,
  type OfferManagerPort,
  type ResolveConcurrencyCeiling,
} from '@openlinker/core/listings';
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

    // Read on BOTH paths below. A resolve ceiling is applied inside the
    // adapter, below the shared limiter, so it is exactly the connection with
    // no limiter policy — the one that used to answer a bare
    // `{ enabled: false }` — whose ceiling the operator most needs to see
    // (#2229).
    const resolveConcurrency = await this.resolveConcurrencyCeiling(connectionId, connection);

    if (!effective || (effective.requestsPerMinute === undefined && effective.maxConcurrent === undefined)) {
      return resolveConcurrency ? { enabled: false, resolveConcurrency } : { enabled: false };
    }

    const live = this.rateLimiterRegistry.getStatus(connectionId);

    return {
      enabled: true,
      requestsPerMinute: effective.requestsPerMinute,
      maxConcurrent: effective.maxConcurrent,
      inFlight: live?.inFlight ?? 0,
      queued: live?.queued ?? 0,
      lastAcquiredAt: live?.lastAcquiredAt ?? null,
      ...(resolveConcurrency ? { resolveConcurrency } : {}),
    };
  }

  /**
   * Ask the connection's own `OfferManager` adapter what ceiling it enforces on
   * a streamed category resolve (#2229). Neutral in both directions: the host
   * never names a platform, and an adapter that declares nothing produces no
   * field rather than a fabricated number.
   *
   * Three outcomes yield no field rather than an error, because this is a
   * supplementary line on a status read and none of them is something the
   * operator can act on here:
   *
   * - **The manifest does not advertise the capability**, or cannot be
   *   resolved at all (a legacy row with an unmapped `platformType`). Checked
   *   first, so the adapter is never built for a destination that could not
   *   report a ceiling anyway.
   * - **Adapter construction throws.** Building a capability adapter resolves
   *   credentials (`AllegroAdapterFactory.resolveCredentials` raises on a
   *   connection that has none yet), so a half-configured connection would
   *   otherwise lose its whole rate-limit readout to a cosmetic addition.
   * - **The method is absent.** `isEanCategoryMatcherStreaming` tests only
   *   `streamCategoriesForBatchByEan`, so an out-of-tree plugin compiled
   *   against an older `libs/core` satisfies the guard without implementing
   *   this method — hence the explicit `typeof` probe, mirroring ADR-046's
   *   description-format resolver.
   */
  private async resolveConcurrencyCeiling(
    connectionId: string,
    connection: { platformType: string; adapterKey?: string }
  ): Promise<ResolveConcurrencyCeiling | undefined> {
    try {
      // Manifest first, adapter second — the advertised-without-dispatch
      // discovery pattern. Building the adapter resolves credentials, so
      // skipping that for a destination whose manifest cannot report a ceiling
      // keeps a settings-page read from touching the credential store for
      // every non-marketplace connection in the deployment.
      const metadata = await this.integrationsService.resolveAdapterMetadata({
        platformType: connection.platformType,
        adapterKey: connection.adapterKey,
      });
      if (!metadata.supportedCapabilities.includes(EAN_CATEGORY_MATCHER_STREAMING_CAPABILITY)) {
        return undefined;
      }

      const adapter = await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(
        connectionId,
        'OfferManager'
      );
      if (!isEanCategoryMatcherStreaming(adapter)) return undefined;

      const streaming: Partial<EanCategoryMatcherStreaming> = adapter;
      if (typeof streaming.getStreamConcurrency !== 'function') return undefined;

      return streaming.getStreamConcurrency();
    } catch (error) {
      this.logger.debug(
        `No resolve-concurrency ceiling reported for connection ${connectionId}: ${(error as Error).message}`
      );
      return undefined;
    }
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
