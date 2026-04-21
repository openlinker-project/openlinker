/**
 * Seller Policies Service Tests
 *
 * Unit tests for cache hit / miss / stale behaviour, capability gating,
 * and cache-aside resilience (upsert failure does not block the response).
 *
 * @module libs/core/src/listings/application/services/__tests__
 */

import { UnprocessableEntityException } from '@nestjs/common';

import type {
  IIntegrationsService,
  MarketplacePort,
  SellerPolicies,
} from '@openlinker/core/integrations';

import type {
  CachedSellerPolicies,
  SellerPoliciesCacheRepositoryPort,
} from '../../../domain/ports/seller-policies-cache-repository.port';
import { SellerPoliciesService } from '../seller-policies.service';

describe('SellerPoliciesService', () => {
  let service: SellerPoliciesService;
  let integrations: jest.Mocked<IIntegrationsService>;
  let cache: jest.Mocked<SellerPoliciesCacheRepositoryPort>;

  const policies: SellerPolicies = {
    deliveryPolicies: [{ id: 'd1', name: 'Standard' }],
    returnPolicies: [{ id: 'r1', name: '14-day' }],
    warranties: [{ id: 'w1', name: '1-year' }],
    impliedWarranties: [{ id: 'iw1', name: 'Consumer' }],
  };

  const connectionId = 'conn-abc';

  const adapterWith = (fetchSellerPolicies: jest.Mock | undefined): MarketplacePort => ({
    ...(fetchSellerPolicies ? { fetchSellerPolicies } : {}),
  } as unknown as MarketplacePort);

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-21T12:00:00.000Z'));

    integrations = {
      getAdapter: jest.fn(),
      getCapabilityAdapter: jest.fn(),
      listCapabilityAdapters: jest.fn(),
      resolveAdapterMetadata: jest.fn(),
    } as unknown as jest.Mocked<IIntegrationsService>;

    cache = {
      findByConnectionId: jest.fn(),
      upsert: jest.fn().mockResolvedValue(undefined),
    };

    service = new SellerPoliciesService(integrations, cache);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns cached policies when the cache row is fresh (<10 min old)', async () => {
    const fetchedAt = new Date('2026-04-21T11:55:00.000Z'); // 5 min old
    const cached: CachedSellerPolicies = { connectionId, policies, fetchedAt };
    cache.findByConnectionId.mockResolvedValue(cached);

    const result = await service.getSellerPolicies(connectionId);

    expect(result).toBe(policies);
    expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
    expect(cache.upsert).not.toHaveBeenCalled();
  });

  it('refetches when the cache row is stale (>10 min old)', async () => {
    const fetchedAt = new Date('2026-04-21T11:49:00.000Z'); // 11 min old
    cache.findByConnectionId.mockResolvedValue({ connectionId, policies, fetchedAt });
    const fetchSellerPolicies = jest.fn().mockResolvedValue(policies);
    integrations.getCapabilityAdapter.mockResolvedValue(adapterWith(fetchSellerPolicies));

    const result = await service.getSellerPolicies(connectionId);

    expect(result).toBe(policies);
    expect(fetchSellerPolicies).toHaveBeenCalledTimes(1);
    expect(cache.upsert).toHaveBeenCalledWith({
      connectionId,
      policies,
      fetchedAt: new Date('2026-04-21T12:00:00.000Z'),
    });
  });

  it('fetches + caches on an empty cache (no row)', async () => {
    cache.findByConnectionId.mockResolvedValue(null);
    const fetchSellerPolicies = jest.fn().mockResolvedValue(policies);
    integrations.getCapabilityAdapter.mockResolvedValue(adapterWith(fetchSellerPolicies));

    const result = await service.getSellerPolicies(connectionId);

    expect(result).toBe(policies);
    expect(fetchSellerPolicies).toHaveBeenCalledTimes(1);
    expect(cache.upsert).toHaveBeenCalledTimes(1);
  });

  it('throws UnprocessableEntityException when the adapter does not implement fetchSellerPolicies', async () => {
    cache.findByConnectionId.mockResolvedValue(null);
    integrations.getCapabilityAdapter.mockResolvedValue(adapterWith(undefined));

    await expect(service.getSellerPolicies(connectionId)).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(cache.upsert).not.toHaveBeenCalled();
  });

  it('propagates exceptions from getCapabilityAdapter (connection not found / disabled)', async () => {
    cache.findByConnectionId.mockResolvedValue(null);
    integrations.getCapabilityAdapter.mockRejectedValue(new Error('ConnectionNotFoundException'));

    await expect(service.getSellerPolicies(connectionId)).rejects.toThrow(
      'ConnectionNotFoundException',
    );
    expect(cache.upsert).not.toHaveBeenCalled();
  });

  it('returns fresh policies even when the cache upsert fails', async () => {
    cache.findByConnectionId.mockResolvedValue(null);
    const fetchSellerPolicies = jest.fn().mockResolvedValue(policies);
    integrations.getCapabilityAdapter.mockResolvedValue(adapterWith(fetchSellerPolicies));
    cache.upsert.mockRejectedValue(new Error('db transient'));

    const result = await service.getSellerPolicies(connectionId);

    expect(result).toBe(policies);
    // The fetch happened and completed; the upsert error is swallowed
    expect(fetchSellerPolicies).toHaveBeenCalledTimes(1);
  });
});
