/**
 * Unit tests for OfferStatusReadService (#1760).
 */
import type { IProductsService } from '@openlinker/core/products';
import type { OfferStatusSnapshot } from '../../domain/entities/offer-status-snapshot.entity';
import type { OfferStatusSnapshotRepositoryPort } from '../../domain/ports/offer-status-snapshot-repository.port';
import { OfferStatusReadService } from './offer-status-read.service';

describe('OfferStatusReadService', () => {
  let products: jest.Mocked<Pick<IProductsService, 'getVariantsByProductId'>>;
  let snapshots: jest.Mocked<Pick<OfferStatusSnapshotRepositoryPort, 'findByVariantIds'>>;
  let service: OfferStatusReadService;

  beforeEach(() => {
    products = { getVariantsByProductId: jest.fn() };
    snapshots = { findByVariantIds: jest.fn() };
    service = new OfferStatusReadService(
      products as unknown as IProductsService,
      snapshots as unknown as OfferStatusSnapshotRepositoryPort
    );
  });

  it('should return [] without querying snapshots when the product has no variants', async () => {
    products.getVariantsByProductId.mockResolvedValue([]);

    const result = await service.getPublicationStatusForProduct('ol_product_1');

    expect(result).toEqual([]);
    expect(snapshots.findByVariantIds).not.toHaveBeenCalled();
  });

  it('should resolve variant ids and fetch their snapshots scoped to the connection', async () => {
    products.getVariantsByProductId.mockResolvedValue([
      { id: 'ol_variant_1' },
      { id: 'ol_variant_2' },
    ] as never);
    const snapshot = { externalOfferId: '7781896308' } as OfferStatusSnapshot;
    snapshots.findByVariantIds.mockResolvedValue([snapshot]);

    const result = await service.getPublicationStatusForProduct('ol_product_1', 'conn-1');

    expect(products.getVariantsByProductId).toHaveBeenCalledWith('ol_product_1');
    expect(snapshots.findByVariantIds).toHaveBeenCalledWith(
      ['ol_variant_1', 'ol_variant_2'],
      'conn-1'
    );
    expect(result).toEqual([snapshot]);
  });
});
