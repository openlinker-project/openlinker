/**
 * Pickup-Point Refresh Service
 *
 * Background re-warm orchestration (#849): for a connection, reads the top-N
 * most-frequently-queried pickup-point searches from `PickupPointQueryStatsPort`
 * and re-runs each via `IPickupPointLookupService.refreshSearch` (which fetches
 * fresh provider results and re-warms the per-point + result caches WITHOUT
 * recording frequency — so the re-warm doesn't reinforce its own counts).
 *
 * Capability-scoped: guards `isPickupPointFinder` up front so a connection that
 * is a `ShippingProviderManager` but has no locker network (e.g. courier-only)
 * is a clean no-op, and a stray recorded query can't surface
 * `PickupPointFinderNotSupportedException` mid-loop. Per-query failures are
 * isolated — a single dead query must not abort the batch.
 *
 * @module libs/core/src/shipping/application/services
 * @implements {IPickupPointRefreshService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';

import type { IPickupPointRefreshService } from '../interfaces/pickup-point-refresh.service.interface';
import { IPickupPointLookupService } from '../interfaces/pickup-point-lookup.service.interface';
import type { PickupPointRefreshResult } from '../types/pickup-point-refresh.types';
import { PickupPointQueryStatsPort } from '../../domain/ports/pickup-point-query-stats.port';
import type { ShippingProviderManagerPort } from '../../domain/ports/shipping-provider-manager.port';
import { isPickupPointFinder } from '../../domain/ports/capabilities/pickup-point-finder.capability';
import {
  PICKUP_POINT_LOOKUP_SERVICE_TOKEN,
  PICKUP_POINT_QUERY_STATS_TOKEN,
} from '../../shipping.tokens';

/** Capability the connection must declare to host a pickup-point network. */
const SHIPPING_PROVIDER_MANAGER_CAPABILITY = 'ShippingProviderManager';

const DEFAULT_REFRESH_TOP_N = 50;
const MIN_REFRESH_TOP_N = 1;
const MAX_REFRESH_TOP_N = 500;

function resolveTopN(): number {
  const raw = process.env.OL_PICKUP_POINT_REFRESH_TOP_N;
  const parsed = raw !== undefined && raw !== '' ? Number(raw) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return DEFAULT_REFRESH_TOP_N;
  }
  return Math.min(MAX_REFRESH_TOP_N, Math.max(MIN_REFRESH_TOP_N, Math.trunc(parsed)));
}

@Injectable()
export class PickupPointRefreshService implements IPickupPointRefreshService {
  private readonly logger = new Logger(PickupPointRefreshService.name);
  private readonly topN = resolveTopN();

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
    @Inject(PICKUP_POINT_QUERY_STATS_TOKEN)
    private readonly stats: PickupPointQueryStatsPort,
    @Inject(PICKUP_POINT_LOOKUP_SERVICE_TOKEN)
    private readonly lookup: IPickupPointLookupService,
  ) {}

  async refreshFrequentForConnection(connectionId: string): Promise<PickupPointRefreshResult> {
    const adapter = await this.integrations.getCapabilityAdapter<ShippingProviderManagerPort>(
      connectionId,
      SHIPPING_PROVIDER_MANAGER_CAPABILITY,
    );
    if (!isPickupPointFinder(adapter)) {
      this.logger.debug(
        `Pickup-point refresh skipped for connection ${connectionId}: adapter has no pickup-point finder`,
      );
      return { refreshed: 0, failed: 0 };
    }

    const queries = await this.stats.topQueries(connectionId, this.topN);
    if (queries.length === 0) {
      return { refreshed: 0, failed: 0 };
    }

    let refreshed = 0;
    let failed = 0;
    for (const query of queries) {
      // Defensive: never re-warm an unfiltered query (the stats adapter already
      // declines to track it, but historical entries could still surface).
      if (!query.city && !query.postalCode && !query.searchText) {
        continue;
      }
      try {
        await this.lookup.refreshSearch(connectionId, query);
        refreshed += 1;
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Pickup-point refresh failed for connection ${connectionId}, query ${JSON.stringify(query)}: ${message}`,
        );
      }
    }

    this.logger.log(
      `Pickup-point refresh for connection ${connectionId}: ${refreshed} refreshed, ${failed} failed (of ${queries.length} top queries)`,
    );
    return { refreshed, failed };
  }
}
