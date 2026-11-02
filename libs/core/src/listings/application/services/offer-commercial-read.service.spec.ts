/**
 * Offer Commercial Read Service Tests (#3621)
 *
 * @module libs/core/src/listings/application/services
 */
import { OfferCommercialSnapshot } from '../../domain/entities/offer-commercial-snapshot.entity';
import type { OfferCommercialSnapshotRepositoryPort } from '../../domain/ports/offer-commercial-snapshot-repository.port';
import { OfferCommercialReadService } from './offer-commercial-read.service';

const snapshot = (
  overrides: Partial<ConstructorParameters<typeof OfferCommercialSnapshot>[0]> = {}
): OfferCommercialSnapshot =>
  new OfferCommercialSnapshot({
    id: 's-1',
    connectionId: 'conn-1',
    externalOfferId: 'o-1',
    internalVariantId: 'var-1',
    price: '10.00',
    currency: 'PLN',
    availableQuantity: 5,
    lastCommercialSyncedAt: new Date('2026-10-26T08:00:00Z'),
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-26T08:00:00Z'),
    ...overrides,
  });

describe('OfferCommercialReadService', () => {
  let repository: jest.Mocked<Pick<OfferCommercialSnapshotRepositoryPort, 'findByVariantIds'>>;
  let service: OfferCommercialReadService;

  beforeEach(() => {
    repository = { findByVariantIds: jest.fn().mockResolvedValue([]) };
    service = new OfferCommercialReadService(
      repository as unknown as OfferCommercialSnapshotRepositoryPort
    );
  });

  it('should return nothing without a read for empty input', async () => {
    await expect(service.getObservedQuantities([])).resolves.toEqual([]);
    expect(repository.findByVariantIds).not.toHaveBeenCalled();
  });

  it('should keep the newest observation per variant and connection', async () => {
    repository.findByVariantIds.mockResolvedValue([
      snapshot({ id: 'old', externalOfferId: 'o-1', availableQuantity: 9 }),
      snapshot({
        id: 'new',
        externalOfferId: 'o-2',
        availableQuantity: 4,
        lastCommercialSyncedAt: new Date('2026-10-26T11:00:00Z'),
      }),
    ]);

    const result = await service.getObservedQuantities(['var-1']);

    expect(result).toEqual([
      expect.objectContaining({ externalOfferId: 'o-2', availableQuantity: 4 }),
    ]);
  });

  it('should ignore a price-only snapshot so it cannot shadow an older real quantity', async () => {
    repository.findByVariantIds.mockResolvedValue([
      snapshot({ availableQuantity: 5 }),
      snapshot({
        id: 'price-only',
        externalOfferId: 'o-2',
        availableQuantity: null,
        lastCommercialSyncedAt: new Date('2026-10-26T12:00:00Z'),
      }),
    ]);

    const result = await service.getObservedQuantities(['var-1']);

    expect(result).toHaveLength(1);
    expect(result[0].availableQuantity).toBe(5);
  });

  it('should report a variant on two connections separately', async () => {
    repository.findByVariantIds.mockResolvedValue([
      snapshot({ connectionId: 'conn-1' }),
      snapshot({ id: 's-2', connectionId: 'conn-2', externalOfferId: 'o-9' }),
    ]);

    const result = await service.getObservedQuantities(['var-1']);

    expect(result.map((r) => r.connectionId).sort()).toEqual(['conn-1', 'conn-2']);
  });
});
