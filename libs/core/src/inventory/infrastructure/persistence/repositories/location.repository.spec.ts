/**
 * Location Repository - Unit Tests
 *
 * Covers the three things the repository decides on its own: the `ol_location_*`
 * id shape, the `numeric` -> `number` geo coercion (including the guard that
 * keeps a NULL column `null` rather than `0`), and the conversion of the
 * driver's unique violation into a domain error.
 *
 * @module libs/core/src/inventory/infrastructure/persistence/repositories
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError, type Repository } from 'typeorm';

import { DuplicateLocationCodeError } from '../../../domain/exceptions/duplicate-location-code.error';
import { InventoryItemOrmEntity } from '../entities/inventory-item.orm-entity';
import { InventoryLocationOrmEntity } from '../entities/inventory-location.orm-entity';
import { LocationRepository } from './location.repository';

describe('LocationRepository', () => {
  let repository: LocationRepository;
  let ormRepository: jest.Mocked<
    Pick<Repository<InventoryLocationOrmEntity>, 'save' | 'findOne' | 'findAndCount' | 'delete'>
  >;
  let inventoryItemsRepository: jest.Mocked<Pick<Repository<InventoryItemOrmEntity>, 'count'>>;

  beforeEach(async () => {
    ormRepository = {
      save: jest.fn(),
      findOne: jest.fn(),
      findAndCount: jest.fn(),
      delete: jest.fn(),
    };
    inventoryItemsRepository = { count: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LocationRepository,
        {
          provide: getRepositoryToken(InventoryLocationOrmEntity),
          useValue: ormRepository,
        },
        {
          provide: getRepositoryToken(InventoryItemOrmEntity),
          useValue: inventoryItemsRepository,
        },
      ],
    }).compile();

    repository = module.get<LocationRepository>(LocationRepository);
  });

  function ormRow(overrides: Partial<InventoryLocationOrmEntity> = {}): InventoryLocationOrmEntity {
    const entity = new InventoryLocationOrmEntity();
    entity.id = 'ol_location_0123456789abcdef0123456789abcdef';
    entity.code = 'WH1';
    entity.name = 'Main warehouse';
    entity.kind = 'warehouse';
    entity.ownerConnectionId = null;
    entity.externalRef = null;
    entity.status = 'active';
    entity.countryIso2 = 'PL';
    entity.postcode = '00-001';
    entity.latitude = null;
    entity.longitude = null;
    entity.createdAt = new Date('2026-08-24T00:00:00Z');
    entity.updatedAt = new Date('2026-08-24T00:00:00Z');
    return Object.assign(entity, overrides);
  }

  describe('create', () => {
    it('should mint an ol_location_ prefixed internal id when creating a location', async () => {
      ormRepository.save.mockImplementation((entity) =>
        Promise.resolve(entity as InventoryLocationOrmEntity)
      );

      const created = await repository.create({
        code: 'WH1',
        name: 'Main warehouse',
        kind: 'warehouse',
      });

      expect(created.id).toMatch(/^ol_location_[0-9a-f]{32}$/);
    });

    it('should default status to active when the caller omits it', async () => {
      ormRepository.save.mockImplementation((entity) =>
        Promise.resolve(entity as InventoryLocationOrmEntity)
      );

      const created = await repository.create({
        code: 'WH1',
        name: 'Main warehouse',
        kind: 'warehouse',
      });

      expect(created.status).toBe('active');
    });

    it('should write geo as a string so pg never round-trips a float', async () => {
      ormRepository.save.mockImplementation((entity) =>
        Promise.resolve(entity as InventoryLocationOrmEntity)
      );

      await repository.create({
        code: 'WH1',
        name: 'Main warehouse',
        kind: 'warehouse',
        latitude: 52.229676,
        longitude: 21.012229,
      });

      const saved = ormRepository.save.mock.calls[0][0] as InventoryLocationOrmEntity;
      expect(saved.latitude).toBe('52.229676');
      expect(saved.longitude).toBe('21.012229');
    });

    it('should throw DuplicateLocationCodeError when the unique index fires', async () => {
      ormRepository.save.mockRejectedValue(
        new QueryFailedError(
          'INSERT',
          [],
          new Error('duplicate key value violates unique constraint "UQ_inventory_locations_code"')
        )
      );

      await expect(
        repository.create({ code: 'WH1', name: 'Main warehouse', kind: 'warehouse' })
      ).rejects.toBeInstanceOf(DuplicateLocationCodeError);
    });

    it('should rethrow an unrelated query failure unchanged', async () => {
      const unrelated = new QueryFailedError('INSERT', [], new Error('connection terminated'));
      ormRepository.save.mockRejectedValue(unrelated);

      await expect(
        repository.create({ code: 'WH1', name: 'Main warehouse', kind: 'warehouse' })
      ).rejects.toBe(unrelated);
    });
  });

  describe('toDomain numeric coercion', () => {
    it('should coerce numeric geo strings to numbers when reading a location', async () => {
      ormRepository.findOne.mockResolvedValue(
        ormRow({ latitude: '52.229676', longitude: '21.012229' })
      );

      const found = await repository.findById('ol_location_x');

      expect(found?.latitude).toBe(52.229676);
      expect(found?.longitude).toBe(21.012229);
    });

    it('should keep a null geo column null rather than coercing it to zero', async () => {
      ormRepository.findOne.mockResolvedValue(ormRow({ latitude: null, longitude: null }));

      const found = await repository.findById('ol_location_x');

      expect(found?.latitude).toBeNull();
      expect(found?.longitude).toBeNull();
    });

    it('should preserve a genuine zero coordinate when the column holds "0"', async () => {
      ormRepository.findOne.mockResolvedValue(ormRow({ latitude: '0.000000' }));

      const found = await repository.findById('ol_location_x');

      expect(found?.latitude).toBe(0);
    });
  });

  describe('update', () => {
    it('should return null when no location carries the id', async () => {
      ormRepository.findOne.mockResolvedValue(null);

      await expect(repository.update('missing', { name: 'x' })).resolves.toBeNull();
    });

    it('should leave an omitted field untouched while clearing an explicit null', async () => {
      ormRepository.findOne.mockResolvedValue(ormRow({ externalRef: 'ERP-7' }));
      ormRepository.save.mockImplementation((entity) =>
        Promise.resolve(entity as InventoryLocationOrmEntity)
      );

      const updated = await repository.update('ol_location_x', { externalRef: null });

      expect(updated?.externalRef).toBeNull();
      // `name` was not present on the patch, so it survives.
      expect(updated?.name).toBe('Main warehouse');
    });
  });

  describe('delete', () => {
    it('should report false when no row matched', async () => {
      ormRepository.delete.mockResolvedValue({ affected: 0, raw: [] });

      await expect(repository.delete('missing')).resolves.toBe(false);
    });

    it('should report true when a row was removed', async () => {
      ormRepository.delete.mockResolvedValue({ affected: 1, raw: [] });

      await expect(repository.delete('ol_location_x')).resolves.toBe(true);
    });
  });

  describe('countPositionsAtLocation', () => {
    it('should count the inventory_items rows carrying the location id', async () => {
      inventoryItemsRepository.count.mockResolvedValue(3);

      await expect(repository.countPositionsAtLocation('ol_location_1')).resolves.toBe(3);
      expect(inventoryItemsRepository.count).toHaveBeenCalledWith({
        where: { locationId: 'ol_location_1' },
      });
    });
  });
});
