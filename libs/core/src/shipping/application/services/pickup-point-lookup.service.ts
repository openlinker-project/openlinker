/**
 * Pickup-Point Lookup Service
 *
 * Read-through orchestration the manual paczkomat picker (#769) consumes:
 * resolves the connection's `ShippingProviderManagerPort`, narrows to the
 * `PickupPointFinder` sub-capability, runs a live provider search, and
 * write-throughs each returned point to `PickupPointCachePort` so a later
 * by-id read is a sub-10ms cache hit. Search stays live because lists must be
 * fresh; only individual points are cached (the #727.1 port is by-id only).
 *
 * Cache write-through failures are swallowed (warn-logged) — a degraded cache
 * must never fail a live search.
 *
 * @module libs/core/src/shipping/application/services
 * @implements {IPickupPointLookupService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';

import type { IPickupPointLookupService } from '../interfaces/pickup-point-lookup.service.interface';
import { PickupPointCachePort } from '../../domain/ports/pickup-point-cache.port';
import type { ShippingProviderManagerPort } from '../../domain/ports/shipping-provider-manager.port';
import { isPickupPointFinder } from '../../domain/ports/capabilities/pickup-point-finder.capability';
import type { FindPickupPointsQuery, PickupPoint } from '../../domain/types/pickup-point.types';
import { PickupPointFinderNotSupportedException } from '../../domain/exceptions/pickup-point-finder-not-supported.exception';
import { PICKUP_POINT_CACHE_TOKEN } from '../../shipping.tokens';

/** Capability the connection must declare to host a pickup-point network. */
const SHIPPING_PROVIDER_MANAGER_CAPABILITY = 'ShippingProviderManager';

@Injectable()
export class PickupPointLookupService implements IPickupPointLookupService {
  private readonly logger = new Logger(PickupPointLookupService.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
    @Inject(PICKUP_POINT_CACHE_TOKEN)
    private readonly cache: PickupPointCachePort,
  ) {}

  async search(connectionId: string, query: FindPickupPointsQuery): Promise<PickupPoint[]> {
    const adapter = await this.integrations.getCapabilityAdapter<ShippingProviderManagerPort>(
      connectionId,
      SHIPPING_PROVIDER_MANAGER_CAPABILITY,
    );
    if (!isPickupPointFinder(adapter)) {
      throw new PickupPointFinderNotSupportedException(connectionId);
    }

    const points = await adapter.findPickupPoints(query);
    await this.warmCache(points);
    return points;
  }

  getCachedPoint(providerId: string): Promise<PickupPoint | null> {
    return this.cache.get(providerId);
  }

  private async warmCache(points: readonly PickupPoint[]): Promise<void> {
    await Promise.all(
      points.map(async (point) => {
        try {
          await this.cache.put(point);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(`Failed to cache pickup point ${point.providerId}: ${message}`);
        }
      }),
    );
  }
}
