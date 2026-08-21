/**
 * SalesDocumentThresholdRepository — Unit Tests (#2170)
 *
 * @module libs/core/src/sales-documents/infrastructure/persistence/repositories
 */
import type { Repository } from 'typeorm';
import { SalesDocumentThresholdRepository } from './sales-document-threshold.repository';
import type { SalesDocumentThresholdOrmEntity } from '../entities/sales-document-threshold.orm-entity';

function ormRow(overrides: Partial<SalesDocumentThresholdOrmEntity> = {}): SalesDocumentThresholdOrmEntity {
  return {
    ref: 'pl-simplified-invoice-2026',
    amount: '450.00',
    currency: 'PLN',
    comparisonOp: 'lt',
    versionEffectiveFrom: '2020-01-01',
    versionEffectiveTo: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as SalesDocumentThresholdOrmEntity;
}

describe('SalesDocumentThresholdRepository', () => {
  let ormRepository: jest.Mocked<Repository<SalesDocumentThresholdOrmEntity>>;
  let repository: SalesDocumentThresholdRepository;

  beforeEach(() => {
    ormRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((v: unknown) => v),
      save: jest.fn(),
    } as unknown as jest.Mocked<Repository<SalesDocumentThresholdOrmEntity>>;
    repository = new SalesDocumentThresholdRepository(ormRepository);
  });

  describe('findByRef', () => {
    it('should return null when no threshold is registered for the ref', async () => {
      ormRepository.findOne.mockResolvedValue(null);

      await expect(repository.findByRef('missing-ref')).resolves.toBeNull();
    });

    it('should map amount from a numeric string to a number', async () => {
      ormRepository.findOne.mockResolvedValue(ormRow());

      const threshold = await repository.findByRef('pl-simplified-invoice-2026');

      expect(threshold).toMatchObject({ ref: 'pl-simplified-invoice-2026', amount: 450, currency: 'PLN' });
    });
  });

  describe('findByRefs', () => {
    it('should return an empty array without querying when refs is empty', async () => {
      const results = await repository.findByRefs([]);

      expect(results).toEqual([]);
      expect(ormRepository.find).not.toHaveBeenCalled();
    });

    it('should map every matching row', async () => {
      ormRepository.find.mockResolvedValue([ormRow(), ormRow({ ref: 'other-ref' })]);

      const results = await repository.findByRefs(['pl-simplified-invoice-2026', 'other-ref']);

      expect(results).toHaveLength(2);
    });
  });

  describe('create', () => {
    it('should format amount to two decimal places for storage', async () => {
      ormRepository.save.mockResolvedValue(ormRow({ amount: '1000.00' }));

      await repository.create({
        ref: 'pl-simplified-invoice-2026',
        amount: 1000,
        currency: 'PLN',
        comparisonOp: 'lt',
        versionEffectiveFrom: new Date('2020-01-01T00:00:00Z'),
        versionEffectiveTo: null,
      });

      expect(ormRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ amount: '1000.00', versionEffectiveFrom: '2020-01-01' }),
      );
    });
  });
});
