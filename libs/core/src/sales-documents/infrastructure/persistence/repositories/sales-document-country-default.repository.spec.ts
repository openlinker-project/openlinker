/**
 * SalesDocumentCountryDefaultRepository — Unit Tests (#2170, review finding 10)
 *
 * Pins `upsert` to a single atomic `INSERT ... ON CONFLICT DO UPDATE`
 * statement rather than a `findOne` + `create`/`save` round-trip — the
 * TOCTOU shape that let two concurrent saves for the same
 * `(country, documentKind)` both observe "not found" and both attempt an
 * insert, with the second colliding against the unique index.
 *
 * @module libs/core/src/sales-documents/infrastructure/persistence/repositories
 */
import { In } from 'typeorm';
import type { Repository } from 'typeorm';
import { SalesDocumentCountryDefaultRepository } from './sales-document-country-default.repository';
import type { SalesDocumentCountryDefaultOrmEntity } from '../entities/sales-document-country-default.orm-entity';

function ormRow(
  overrides: Partial<SalesDocumentCountryDefaultOrmEntity> = {},
): SalesDocumentCountryDefaultOrmEntity {
  return {
    id: 'default-1',
    country: 'PL',
    documentKind: 'invoice',
    connectionId: 'conn-infakt',
    createdAt: new Date('2026-08-14T06:00:00Z'),
    updatedAt: new Date('2026-08-14T06:00:00Z'),
    ...overrides,
  } as SalesDocumentCountryDefaultOrmEntity;
}

describe('SalesDocumentCountryDefaultRepository', () => {
  let ormRepository: jest.Mocked<Repository<SalesDocumentCountryDefaultOrmEntity>>;
  let repository: SalesDocumentCountryDefaultRepository;

  beforeEach(() => {
    ormRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      findOneOrFail: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<Repository<SalesDocumentCountryDefaultOrmEntity>>;
    repository = new SalesDocumentCountryDefaultRepository(ormRepository);
  });

  describe('upsert', () => {
    it('should upsert on the (country, documentKind) conflict path and re-read the row', async () => {
      ormRepository.findOneOrFail.mockResolvedValue(ormRow({ connectionId: 'conn-eparagony' }));

      const saved = await repository.upsert({
        country: 'PL',
        documentKind: 'invoice',
        connectionId: 'conn-eparagony',
      });

      expect(ormRepository.upsert).toHaveBeenCalledWith(
        { country: 'PL', documentKind: 'invoice', connectionId: 'conn-eparagony' },
        { conflictPaths: ['country', 'documentKind'] },
      );
      expect(ormRepository.findOneOrFail).toHaveBeenCalledWith({
        where: { country: 'PL', documentKind: 'invoice' },
      });
      expect(saved.connectionId).toBe('conn-eparagony');
    });

    it('should never fall back to findOne + create/save (no TOCTOU window)', async () => {
      ormRepository.findOneOrFail.mockResolvedValue(ormRow());

      await repository.upsert({ country: 'DE', documentKind: 'fiscal-receipt', connectionId: 'conn-1' });

      expect(ormRepository.findOne).not.toHaveBeenCalled();
    });
  });

  describe('findByCountryAndKind', () => {
    it('should return null when no default is configured', async () => {
      ormRepository.findOne.mockResolvedValue(null);

      await expect(repository.findByCountryAndKind('DE', 'invoice')).resolves.toBeNull();
    });

    it('should map the row onto the domain entity', async () => {
      ormRepository.findOne.mockResolvedValue(ormRow());

      const result = await repository.findByCountryAndKind('PL', 'invoice');

      expect(result).toMatchObject({ country: 'PL', documentKind: 'invoice', connectionId: 'conn-infakt' });
    });
  });

  describe('findByCountry / findAll', () => {
    it('should map every row for one country', async () => {
      ormRepository.find.mockResolvedValue([ormRow(), ormRow({ id: 'default-2', documentKind: 'fiscal-receipt' })]);

      const results = await repository.findByCountry('PL');

      expect(results).toHaveLength(2);
      expect(ormRepository.find).toHaveBeenCalledWith({ where: { country: 'PL' } });
    });

    it('should map every row across every country', async () => {
      ormRepository.find.mockResolvedValue([ormRow(), ormRow({ id: 'default-2', country: 'DE' })]);

      const results = await repository.findAll();

      expect(results).toHaveLength(2);
      expect(ormRepository.find).toHaveBeenCalledWith();
    });
  });

  describe('delete', () => {
    it('should delete by id', async () => {
      await repository.delete('default-1');

      expect(ormRepository.delete).toHaveBeenCalledWith({ id: 'default-1' });
    });
  });

  describe('findByCountries (#2516)', () => {
    it('reads nothing for an empty input', async () => {
      await expect(repository.findByCountries([])).resolves.toEqual([]);
      expect(ormRepository.find).not.toHaveBeenCalled();
    });

    it('issues ONE query for every country in the batch', async () => {
      ormRepository.find.mockResolvedValue([ormRow()]);

      const defaults = await repository.findByCountries(['PL', '*']);

      expect(ormRepository.find).toHaveBeenCalledTimes(1);
      expect(ormRepository.find).toHaveBeenCalledWith({
        where: { country: In(['PL', '*']) },
      });
      expect(defaults.map((row) => row.id)).toEqual(['default-1']);
    });
  });
});
