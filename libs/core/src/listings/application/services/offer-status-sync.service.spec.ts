/**
 * Unit tests for OfferStatusSyncService.refreshOne (#1760).
 */
import type { IIntegrationsService } from '@openlinker/core/integrations';
import { OfferNotFoundOnMarketplaceException } from '@openlinker/core/listings';
import type { OfferMappingRepositoryPort } from '@openlinker/core/listings';
import type { OfferStatusSnapshotRepositoryPort } from '../../domain/ports/offer-status-snapshot-repository.port';
import { OfferStatusSyncService } from './offer-status-sync.service';

describe('OfferStatusSyncService.refreshOne', () => {
  let integrations: { getCapabilityAdapter: jest.Mock };
  let offerMappings: jest.Mocked<Pick<OfferMappingRepositoryPort, 'findMany'>>;
  let snapshots: jest.Mocked<Pick<OfferStatusSnapshotRepositoryPort, 'upsert'>>;
  let service: OfferStatusSyncService;

  const target = { externalOfferId: '7781896308', internalVariantId: 'ol_variant_1' };

  beforeEach(() => {
    integrations = { getCapabilityAdapter: jest.fn() };
    offerMappings = { findMany: jest.fn() };
    snapshots = { upsert: jest.fn() };
    service = new OfferStatusSyncService(
      integrations as unknown as IIntegrationsService,
      offerMappings as unknown as OfferMappingRepositoryPort,
      snapshots as unknown as OfferStatusSnapshotRepositoryPort
    );
  });

  it('should upsert and return the live status when the adapter supports OfferStatusReader', async () => {
    const adapter = {
      getOfferStatus: jest.fn().mockResolvedValue({ publicationStatus: 'active', validationErrors: [] }),
    };
    integrations.getCapabilityAdapter.mockResolvedValue(adapter);
    snapshots.upsert.mockResolvedValue({ snapshot: {} as never, previousStatus: 'inactive' });

    const result = await service.refreshOne('conn-1', target);

    expect(adapter.getOfferStatus).toHaveBeenCalledWith('7781896308');
    expect(snapshots.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: 'conn-1',
        externalOfferId: '7781896308',
        internalVariantId: 'ol_variant_1',
        publicationStatus: 'active',
      })
    );
    expect(result).toBe('active');
  });

  it('should return null when the adapter does not support OfferStatusReader', async () => {
    integrations.getCapabilityAdapter.mockResolvedValue({ updateOfferQuantity: jest.fn() });

    const result = await service.refreshOne('conn-1', target);

    expect(result).toBeNull();
    expect(snapshots.upsert).not.toHaveBeenCalled();
  });

  it('should return null and not upsert when the offer is not found on the marketplace', async () => {
    const adapter = {
      getOfferStatus: jest
        .fn()
        .mockRejectedValue(new OfferNotFoundOnMarketplaceException('7781896308', 'conn-1')),
    };
    integrations.getCapabilityAdapter.mockResolvedValue(adapter);

    const result = await service.refreshOne('conn-1', target);

    expect(result).toBeNull();
    expect(snapshots.upsert).not.toHaveBeenCalled();
  });
});
