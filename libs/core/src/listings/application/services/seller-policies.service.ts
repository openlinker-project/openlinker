/**
 * Seller Policies Service
 *
 * Cache-aside read service for marketplace seller policies. Memoises the
 * adapter's `fetchSellerPolicies()` result in a DB-backed cache table
 * (`seller_policies_cache`) with a 10-minute TTL so repeated wizard loads
 * do not hammer the marketplace API.
 *
 * @module libs/core/src/listings/application/services
 * @implements {ISellerPoliciesService}
 * @see {@link ISellerPoliciesService} for the service contract
 * @see {@link SellerPoliciesCacheRepositoryPort} for the cache persistence port
 */

import { Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';

import { isSellerPoliciesReader } from '@openlinker/core/listings';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import type { SellerPolicies, OfferManagerPort } from '@openlinker/core/listings';
import { Logger } from '@openlinker/shared/logging';

import { SellerPoliciesCacheRepositoryPort } from '../../domain/ports/seller-policies-cache-repository.port';
import { SELLER_POLICIES_CACHE_TOKEN } from '../../listings.tokens';
import type { ISellerPoliciesService } from '../interfaces/seller-policies.service.interface';

const SELLER_POLICIES_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class SellerPoliciesService implements ISellerPoliciesService {
  private readonly logger = new Logger(SellerPoliciesService.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(SELLER_POLICIES_CACHE_TOKEN)
    private readonly cache: SellerPoliciesCacheRepositoryPort
  ) {}

  async getSellerPolicies(connectionId: string): Promise<SellerPolicies> {
    const cached = await this.cache.findByConnectionId(connectionId);
    if (cached && this.isFresh(cached.fetchedAt)) {
      return cached.policies;
    }

    // Throws ConnectionNotFoundException (404) / ConnectionDisabledException (409) /
    // CapabilityNotSupportedException (422) for upstream connection-level issues.
    const adapter = await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(
      connectionId,
      'OfferManager'
    );

    if (!isSellerPoliciesReader(adapter)) {
      throw new UnprocessableEntityException(
        `Adapter for connection ${connectionId} does not support seller-policy listing`
      );
    }

    const policies = await adapter.fetchSellerPolicies();
    try {
      await this.cache.upsert({
        connectionId,
        policies,
        fetchedAt: new Date(),
      });
    } catch (error) {
      // Cache-aside resilience: a transient cache-write failure must not mask
      // a successful adapter fetch. Log and return the fresh value.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `seller_policies_cache_upsert_failed connectionId=${connectionId} reason=${message}`
      );
    }

    return policies;
  }

  private isFresh(fetchedAt: Date): boolean {
    return Date.now() - fetchedAt.getTime() < SELLER_POLICIES_TTL_MS;
  }
}
