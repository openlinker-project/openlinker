/**
 * Unit tests for OfferStatusReadService (#1760, extended by #2039).
 */
import type { IProductsService } from '@openlinker/core/products';
import type { IdentifierMapping } from '@openlinker/core/identifier-mapping';
import type { OfferStatusSnapshot } from '../../domain/entities/offer-status-snapshot.entity';
import type { OfferMappingRepositoryPort } from '../../domain/ports/offer-mapping-repository.port';
import type { OfferStatusSnapshotRepositoryPort } from '../../domain/ports/offer-status-snapshot-repository.port';
import { OfferStatusReadService } from './offer-status-read.service';

const syncedAt = new Date('2026-08-12T10:00:00Z');

function makeSnapshot(overrides: Partial<OfferStatusSnapshot> = {}): OfferStatusSnapshot {
  return {
    connectionId: 'conn-1',
    externalOfferId: '7781896308',
    internalVariantId: 'ol_variant_1',
    publicationStatus: 'active',
    statusDetails: null,
    lastStatusSyncedAt: syncedAt,
    ...overrides,
  } as OfferStatusSnapshot;
}

function makeMapping(overrides: Partial<IdentifierMapping> = {}): IdentifierMapping {
  return {
    connectionId: 'conn-1',
    externalId: '7781896308',
    internalId: 'ol_variant_1',
    ...overrides,
  } as IdentifierMapping;
}

describe('OfferStatusReadService', () => {
  let products: jest.Mocked<Pick<IProductsService, 'getVariantsByProductId'>>;
  let snapshots: jest.Mocked<Pick<OfferStatusSnapshotRepositoryPort, 'findByVariantIds'>>;
  let offerMappings: jest.Mocked<Pick<OfferMappingRepositoryPort, 'findMany'>>;
  let service: OfferStatusReadService;

  beforeEach(() => {
    products = { getVariantsByProductId: jest.fn() };
    snapshots = { findByVariantIds: jest.fn().mockResolvedValue([]) };
    offerMappings = {
      findMany: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    } as unknown as jest.Mocked<Pick<OfferMappingRepositoryPort, 'findMany'>>;
    service = new OfferStatusReadService(
      products as unknown as IProductsService,
      snapshots as unknown as OfferStatusSnapshotRepositoryPort,
      offerMappings as unknown as OfferMappingRepositoryPort
    );
  });

  it('should return [] without querying snapshots when the product has no variants', async () => {
    products.getVariantsByProductId.mockResolvedValue([]);

    const result = await service.getPublicationStatusForProduct('ol_product_1');

    expect(result).toEqual([]);
    expect(snapshots.findByVariantIds).not.toHaveBeenCalled();
    expect(offerMappings.findMany).not.toHaveBeenCalled();
  });

  it('should resolve variant ids and fetch their snapshots scoped to the connection', async () => {
    products.getVariantsByProductId.mockResolvedValue([
      { id: 'ol_variant_1' },
      { id: 'ol_variant_2' },
    ] as never);
    snapshots.findByVariantIds.mockResolvedValue([makeSnapshot()]);
    // One mapping per variant — the second variant simply isn't listed.
    offerMappings.findMany.mockImplementation((filters) =>
      Promise.resolve(
        filters.internalId === 'ol_variant_1'
          ? ({ items: [makeMapping()], total: 1 } as never)
          : ({ items: [], total: 0 } as never)
      )
    );

    const result = await service.getPublicationStatusForProduct('ol_product_1', 'conn-1');

    expect(products.getVariantsByProductId).toHaveBeenCalledWith('ol_product_1');
    expect(snapshots.findByVariantIds).toHaveBeenCalledWith(
      ['ol_variant_1', 'ol_variant_2'],
      'conn-1'
    );
    expect(result).toEqual([
      {
        connectionId: 'conn-1',
        externalOfferId: '7781896308',
        internalVariantId: 'ol_variant_1',
        publicationStatus: 'active',
        validationMessages: [],
        validationProblems: [],
        lastStatusSyncedAt: syncedAt,
      },
    ]);
  });

  it('should report a mapped offer that has no snapshot yet with a null status (#2039)', async () => {
    products.getVariantsByProductId.mockResolvedValue([{ id: 'ol_variant_1' }] as never);
    snapshots.findByVariantIds.mockResolvedValue([]);
    offerMappings.findMany.mockResolvedValue({ items: [makeMapping()], total: 1 } as never);

    const result = await service.getPublicationStatusForProduct('ol_product_1');

    // The row must exist: it is what makes the per-offer manual refresh
    // reachable for exactly the offers that need it.
    expect(result).toEqual([
      {
        connectionId: 'conn-1',
        externalOfferId: '7781896308',
        internalVariantId: 'ol_variant_1',
        publicationStatus: null,
        validationMessages: [],
        validationProblems: [],
        lastStatusSyncedAt: null,
      },
    ]);
  });

  it('should still report a snapshot whose offer mapping has been removed', async () => {
    products.getVariantsByProductId.mockResolvedValue([{ id: 'ol_variant_1' }] as never);
    snapshots.findByVariantIds.mockResolvedValue([makeSnapshot({ externalOfferId: 'gone-1' })]);
    offerMappings.findMany.mockResolvedValue({ items: [], total: 0 } as never);

    const result = await service.getPublicationStatusForProduct('ol_product_1');

    expect(result).toHaveLength(1);
    expect(result[0].externalOfferId).toBe('gone-1');
    expect(result[0].publicationStatus).toBe('active');
  });

  it('should carry snapshot validation messages onto the view', async () => {
    products.getVariantsByProductId.mockResolvedValue([{ id: 'ol_variant_1' }] as never);
    snapshots.findByVariantIds.mockResolvedValue([
      makeSnapshot({ statusDetails: { validationMessages: ['Missing parameter'] } }),
    ]);
    offerMappings.findMany.mockResolvedValue({ items: [makeMapping()], total: 1 } as never);

    const result = await service.getPublicationStatusForProduct('ol_product_1');

    expect(result[0].validationMessages).toEqual(['Missing parameter']);
  });

  it('should not double-report an offer that has both a mapping and a snapshot', async () => {
    products.getVariantsByProductId.mockResolvedValue([{ id: 'ol_variant_1' }] as never);
    snapshots.findByVariantIds.mockResolvedValue([makeSnapshot()]);
    offerMappings.findMany.mockResolvedValue({ items: [makeMapping()], total: 1 } as never);

    const result = await service.getPublicationStatusForProduct('ol_product_1');

    expect(result).toHaveLength(1);
  });

  it('should report one row per offer even if the same offer id is mapped to two variants', async () => {
    products.getVariantsByProductId.mockResolvedValue([
      { id: 'ol_variant_1' },
      { id: 'ol_variant_2' },
    ] as never);
    snapshots.findByVariantIds.mockResolvedValue([]);
    offerMappings.findMany.mockResolvedValue({ items: [makeMapping()], total: 1 } as never);

    const result = await service.getPublicationStatusForProduct('ol_product_1');

    expect(result).toHaveLength(1);
  });
});
