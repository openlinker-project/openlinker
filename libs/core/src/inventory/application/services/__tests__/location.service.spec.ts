/**
 * Location Service - Unit Tests
 *
 * The service's only real responsibility is normalisation and not-found
 * translation, so that is what is covered: `code` is normalised in exactly one
 * place (the case-sensitive unique index depends on it), and a missing row
 * becomes a domain exception rather than a `null` a caller might act on.
 *
 * @module libs/core/src/inventory/application/services
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';

import { InventoryLocation } from '../../../domain/entities/inventory-location.entity';
import { LocationNotFoundException } from '../../../domain/exceptions/location-not-found.exception';
import { LocationInUseError } from '../../../domain/exceptions/location-in-use.error';
import type { LocationRepositoryPort } from '../../../domain/ports/location-repository.port';
import { LOCATION_REPOSITORY_TOKEN } from '../../../inventory.tokens';
import { LocationService } from '../location.service';

describe('LocationService', () => {
  let service: LocationService;
  let repository: jest.Mocked<LocationRepositoryPort>;

  const sample = new InventoryLocation(
    'ol_location_0123456789abcdef0123456789abcdef',
    'WH1',
    'Main warehouse',
    'warehouse',
    null,
    null,
    'active',
    'PL',
    '00-001',
    null,
    null,
    new Date('2026-08-24T00:00:00Z'),
    new Date('2026-08-24T00:00:00Z')
  );

  beforeEach(async () => {
    repository = {
      create: jest.fn().mockResolvedValue(sample),
      update: jest.fn().mockResolvedValue(sample),
      findById: jest.fn().mockResolvedValue(sample),
      list: jest.fn(),
      delete: jest.fn().mockResolvedValue(true),
      countPositionsAtLocation: jest.fn().mockResolvedValue(0),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LocationService,
        { provide: LOCATION_REPOSITORY_TOKEN, useValue: repository },
      ],
    }).compile();

    service = module.get<LocationService>(LocationService);
  });

  describe('createLocation', () => {
    it('should uppercase and trim the code before it reaches the repository', async () => {
      await service.createLocation({ code: '  wh1 ', name: 'Main', kind: 'warehouse' });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'WH1' })
      );
    });

    it('should uppercase countryIso2 when one is supplied', async () => {
      await service.createLocation({
        code: 'WH1',
        name: 'Main',
        kind: 'warehouse',
        countryIso2: 'pl',
      });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ countryIso2: 'PL' })
      );
    });

    it('should pass a null country through as null rather than a string', async () => {
      await service.createLocation({
        code: 'WH1',
        name: 'Main',
        kind: 'warehouse',
        countryIso2: null,
      });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ countryIso2: null })
      );
    });

    it('should propagate a duplicate-code failure from the repository', async () => {
      const duplicate = new Error('dup');
      repository.create.mockRejectedValue(duplicate);

      await expect(
        service.createLocation({ code: 'WH1', name: 'Main', kind: 'warehouse' })
      ).rejects.toBe(duplicate);
    });
  });

  describe('updateLocation', () => {
    it('should throw LocationNotFoundException when the repository reports no row', async () => {
      repository.update.mockResolvedValue(null);

      await expect(service.updateLocation('missing', { name: 'x' })).rejects.toBeInstanceOf(
        LocationNotFoundException
      );
    });

    it('should not send a countryIso2 key when the patch omits it', async () => {
      await service.updateLocation('ol_location_x', { name: 'Renamed' });

      const patch = repository.update.mock.calls[0][1];
      expect('countryIso2' in patch).toBe(false);
    });

    it('should normalise countryIso2 when the patch carries it', async () => {
      await service.updateLocation('ol_location_x', { countryIso2: 'de' });

      expect(repository.update).toHaveBeenCalledWith(
        'ol_location_x',
        expect.objectContaining({ countryIso2: 'DE' })
      );
    });
  });

  describe('deleteLocation', () => {
    it('should throw LocationNotFoundException when nothing was deleted', async () => {
      repository.delete.mockResolvedValue(false);

      await expect(service.deleteLocation('missing')).rejects.toBeInstanceOf(
        LocationNotFoundException
      );
    });

    it('should resolve when a row was removed', async () => {
      await expect(service.deleteLocation('ol_location_x')).resolves.toBeUndefined();
    });

    // I8 — the refusal belongs HERE, not in the controller: `inventory_items`
    // has no FK to `inventory_locations`, so nothing in the database refuses
    // the delete and a controller-only guard protected the HTTP caller alone.
    it('should refuse with LocationInUseError while positions still reference it', async () => {
      repository.countPositionsAtLocation.mockResolvedValue(3);

      await expect(service.deleteLocation('ol_location_x')).rejects.toBeInstanceOf(
        LocationInUseError
      );
      // Refused BEFORE the delete — the positions must not be stranded.
      expect(repository.delete).not.toHaveBeenCalled();
    });

    it('should still report 404 for an unknown id rather than a spurious in-use refusal', async () => {
      // An unknown id counts 0 positions, so the ordering never masks a
      // missing row.
      repository.countPositionsAtLocation.mockResolvedValue(0);
      repository.delete.mockResolvedValue(false);

      await expect(service.deleteLocation('missing')).rejects.toBeInstanceOf(
        LocationNotFoundException
      );
    });
  });

  describe('getLocation', () => {
    it('should return null without throwing when no location carries the id', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.getLocation('missing')).resolves.toBeNull();
    });
  });

  describe('countPositionsAtLocation', () => {
    it('should delegate to the repository unchanged', async () => {
      repository.countPositionsAtLocation.mockResolvedValue(4);

      await expect(service.countPositionsAtLocation('ol_location_x')).resolves.toBe(4);
      expect(repository.countPositionsAtLocation).toHaveBeenCalledWith('ol_location_x');
    });
  });
});
