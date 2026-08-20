/**
 * SalesDocumentCountryAcknowledgmentRepository — Unit Tests (#2186, review
 * finding 10 applied to this repository too — see its own `upsert` doc
 * comment)
 *
 * @module libs/core/src/sales-documents/infrastructure/persistence/repositories
 */
import type { Repository } from 'typeorm';
import { SalesDocumentCountryAcknowledgmentRepository } from './sales-document-country-acknowledgment.repository';
import type { SalesDocumentCountryAcknowledgmentOrmEntity } from '../entities/sales-document-country-acknowledgment.orm-entity';

function ormRow(
  overrides: Partial<SalesDocumentCountryAcknowledgmentOrmEntity> = {},
): SalesDocumentCountryAcknowledgmentOrmEntity {
  return {
    country: 'DE',
    acknowledgedAt: new Date('2026-08-14T06:00:00Z'),
    ...overrides,
  } as SalesDocumentCountryAcknowledgmentOrmEntity;
}

describe('SalesDocumentCountryAcknowledgmentRepository', () => {
  let ormRepository: jest.Mocked<Repository<SalesDocumentCountryAcknowledgmentOrmEntity>>;
  let repository: SalesDocumentCountryAcknowledgmentRepository;

  beforeEach(() => {
    ormRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      findOneOrFail: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<Repository<SalesDocumentCountryAcknowledgmentOrmEntity>>;
    repository = new SalesDocumentCountryAcknowledgmentRepository(ormRepository);
  });

  describe('upsert', () => {
    it('should upsert on the country conflict path and re-read the row', async () => {
      ormRepository.findOneOrFail.mockResolvedValue(ormRow());

      const result = await repository.upsert('DE');

      expect(ormRepository.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ country: 'DE', acknowledgedAt: expect.any(Date) }),
        { conflictPaths: ['country'] },
      );
      expect(ormRepository.findOneOrFail).toHaveBeenCalledWith({ where: { country: 'DE' } });
      expect(result.country).toBe('DE');
    });

    it('should never fall back to findOne + create/save (no TOCTOU window)', async () => {
      ormRepository.findOneOrFail.mockResolvedValue(ormRow());

      await repository.upsert('FR');

      expect(ormRepository.findOne).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('should map every acknowledged country', async () => {
      ormRepository.find.mockResolvedValue([ormRow(), ormRow({ country: 'FR' })]);

      const results = await repository.findAll();

      expect(results).toHaveLength(2);
    });
  });

  describe('delete', () => {
    it('should delete by country', async () => {
      await repository.delete('DE');

      expect(ormRepository.delete).toHaveBeenCalledWith({ country: 'DE' });
    });
  });
});
