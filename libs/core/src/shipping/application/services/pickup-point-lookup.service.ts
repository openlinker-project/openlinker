/**
 * Pickup-Point Lookup Service
 *
 * Read-through orchestration the manual paczkomat picker (#769) consumes, plus
 * the query-result caching + frequency tracking added in #849:
 *
 * - `search` (operator path): records query frequency, then serves from the
 *   result cache when warm (skipping the live provider call within the short
 *   TTL); on a miss runs a live `PickupPointFinder` search and write-throughs
 *   the whole result list (`PickupPointSearchCachePort`) **and** each point by
 *   id (`PickupPointCachePort`, #766).
 * - `refreshSearch` (background re-warm, #849): always live, write-throughs
 *   both caches, but bypasses the result-cache read and does NOT record
 *   frequency — so the daily re-warm can't reinforce its own counts.
 *
 * Cache + frequency side effects are swallowed (warn-logged): a degraded cache
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
import { PickupPointSearchCachePort } from '../../domain/ports/pickup-point-search-cache.port';
import { PickupPointQueryStatsPort } from '../../domain/ports/pickup-point-query-stats.port';
import type { ShippingProviderManagerPort } from '../../domain/ports/shipping-provider-manager.port';
import { isPickupPointFinder } from '../../domain/ports/capabilities/pickup-point-finder.capability';
import type { FindPickupPointsQuery, PickupPoint } from '../../domain/types/pickup-point.types';
import { PickupPointFinderNotSupportedException } from '../../domain/exceptions/pickup-point-finder-not-supported.exception';
import {
  PICKUP_POINT_CACHE_TOKEN,
  PICKUP_POINT_QUERY_STATS_TOKEN,
  PICKUP_POINT_SEARCH_CACHE_TOKEN,
} from '../../shipping.tokens';

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
    @Inject(PICKUP_POINT_SEARCH_CACHE_TOKEN)
    private readonly searchCache: PickupPointSearchCachePort,
    @Inject(PICKUP_POINT_QUERY_STATS_TOKEN)
    private readonly stats: PickupPointQueryStatsPort,
  ) {}

  async search(connectionId: string, query: FindPickupPointsQuery): Promise<PickupPoint[]> {
    await this.recordFrequencySafe(connectionId, query);

    const cached = await this.readSearchCacheSafe(connectionId, query);
    if (cached !== null) {
      return cached;
    }

    return this.runLiveSearchAndCache(connectionId, query);
  }

  async refreshSearch(connectionId: string, query: FindPickupPointsQuery): Promise<void> {
    // No frequency record, no result-cache read — always fetch fresh and re-warm.
    await this.runLiveSearchAndCache(connectionId, query);
  }

  getCachedPoint(providerId: string): Promise<PickupPoint | null> {
    return this.cache.get(providerId);
  }

  /** Live provider search + write-through to both the result and per-point caches. */
  private async runLiveSearchAndCache(
    connectionId: string,
    query: FindPickupPointsQuery,
  ): Promise<PickupPoint[]> {
    const adapter = await this.integrations.getCapabilityAdapter<ShippingProviderManagerPort>(
      connectionId,
      SHIPPING_PROVIDER_MANAGER_CAPABILITY,
    );
    if (!isPickupPointFinder(adapter)) {
      throw new PickupPointFinderNotSupportedException(connectionId);
    }

    const points = await adapter.findPickupPoints(query);
    await this.warmPointCache(points);
    await this.warmSearchCache(connectionId, query, points);
    return points;
  }

  private async recordFrequencySafe(
    connectionId: string,
    query: FindPickupPointsQuery,
  ): Promise<void> {
    try {
      await this.stats.record(connectionId, query);
    } catch (error) {
      this.logger.warn(`Failed to record pickup-point query frequency: ${messageOf(error)}`);
    }
  }

  private async readSearchCacheSafe(
    connectionId: string,
    query: FindPickupPointsQuery,
  ): Promise<PickupPoint[] | null> {
    try {
      return await this.searchCache.get(connectionId, query);
    } catch (error) {
      this.logger.warn(`Failed to read pickup-point search cache: ${messageOf(error)}`);
      return null;
    }
  }

  private async warmSearchCache(
    connectionId: string,
    query: FindPickupPointsQuery,
    points: readonly PickupPoint[],
  ): Promise<void> {
    try {
      await this.searchCache.put(connectionId, query, points);
    } catch (error) {
      this.logger.warn(`Failed to cache pickup-point search result: ${messageOf(error)}`);
    }
  }

  private async warmPointCache(points: readonly PickupPoint[]): Promise<void> {
    await Promise.all(
      points.map(async (point) => {
        try {
          await this.cache.put(point);
        } catch (error) {
          this.logger.warn(`Failed to cache pickup point ${point.providerId}: ${messageOf(error)}`);
        }
      }),
    );
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
