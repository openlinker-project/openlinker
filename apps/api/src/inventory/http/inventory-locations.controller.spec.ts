/**
 * Inventory Locations Controller - Unit Tests
 *
 * Covers what the controller itself decides: the country-filter uppercasing,
 * the null-to-404 read, the verbatim create delegation, the omitted-vs-null
 * partial-update distinction, the count-BEFORE-delete ordering behind the 409,
 * and the response allowlist.
 *
 * @module apps/api/src/inventory/http
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import {
  InventoryLocation,
  LOCATION_SERVICE_TOKEN,
  LocationInUseError,
  type ILocationService,
} from '@openlinker/core/inventory';
import { InventoryLocationsController } from './inventory-locations.controller';

function makeLocation(
  overrides: Partial<Pick<InventoryLocation, 'name' | 'postcode'>> = {}
): InventoryLocation {
  return new InventoryLocation(
    'ol_location_1',
    'WH1',
    overrides.name ?? 'Main warehouse',
    'warehouse',
    null,
    null,
    'active',
    'PL',
    overrides.postcode === undefined ? '00-001' : overrides.postcode,
    52.2297,
    21.0122,
    new Date('2026-08-24T10:00:00.000Z'),
    new Date('2026-08-24T11:00:00.000Z')
  );
}

describe('InventoryLocationsController', () => {
  let controller: InventoryLocationsController;
  let service: jest.Mocked<ILocationService>;

  beforeEach(async () => {
    service = {
      createLocation: jest.fn(),
      updateLocation: jest.fn(),
      getLocation: jest.fn(),
      listLocations: jest.fn(),
      deleteLocation: jest.fn(),
      countPositionsAtLocation: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [InventoryLocationsController],
      providers: [{ provide: LOCATION_SERVICE_TOKEN, useValue: service }],
    }).compile();

    controller = module.get<InventoryLocationsController>(InventoryLocationsController);
  });

  describe('list', () => {
    it('should apply page/limit defaults and echo the service pagination back', async () => {
      service.listLocations.mockResolvedValue({
        items: [makeLocation()],
        total: 1,
        page: 1,
        limit: 25,
      });

      const result = await controller.list({});

      expect(service.listLocations).toHaveBeenCalledWith(
        { kind: undefined, status: undefined, codePrefix: undefined },
        { page: 1, limit: 25 }
      );
      expect(result).toMatchObject({ total: 1, page: 1, limit: 25 });
      expect(result.items).toHaveLength(1);
    });

    it('should uppercase countryIso2 before it reaches the equality filter', async () => {
      service.listLocations.mockResolvedValue({ items: [], total: 0, page: 2, limit: 10 });

      await controller.list({ countryIso2: 'pl', codePrefix: 'wh', page: 2, limit: 10 });

      expect(service.listLocations).toHaveBeenCalledWith(
        expect.objectContaining({ countryIso2: 'PL', codePrefix: 'wh' }),
        { page: 2, limit: 10 }
      );
    });
  });

  describe('get', () => {
    it('should map the location when found', async () => {
      service.getLocation.mockResolvedValue(makeLocation());

      await expect(controller.get('ol_location_1')).resolves.toMatchObject({
        id: 'ol_location_1',
        code: 'WH1',
      });
    });

    it('should throw NotFoundException when the service returns null', async () => {
      service.getLocation.mockResolvedValue(null);

      await expect(controller.get('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('create', () => {
    it('should delegate the body verbatim, normalising nothing controller-side', async () => {
      service.createLocation.mockResolvedValue(makeLocation());

      await controller.create({ code: ' wh1 ', name: 'Main', kind: 'warehouse' });

      expect(service.createLocation).toHaveBeenCalledWith({
        code: ' wh1 ',
        name: 'Main',
        kind: 'warehouse',
      });
    });
  });

  describe('update', () => {
    it('should forward an explicit null so a nullable column is cleared', async () => {
      service.updateLocation.mockResolvedValue(makeLocation({ postcode: null }));

      await controller.update('ol_location_1', { postcode: null });

      expect(service.updateLocation).toHaveBeenCalledWith('ol_location_1', { postcode: null });
    });

    it('should forward only the keys present, leaving omitted fields untouched', async () => {
      service.updateLocation.mockResolvedValue(makeLocation({ name: 'Renamed' }));

      await controller.update('ol_location_1', { name: 'Renamed' });

      const [, input] = service.updateLocation.mock.calls[0];
      expect(Object.keys(input)).toEqual(['name']);
    });
  });

  describe('remove', () => {
    it('should delegate the delete to the service', async () => {
      service.deleteLocation.mockResolvedValue(undefined);

      await expect(controller.remove('ol_location_1')).resolves.toBeUndefined();
      expect(service.deleteLocation).toHaveBeenCalledWith('ol_location_1');
    });

    // I8 — the in-use guard MOVED into `LocationService.deleteLocation`, so
    // the controller must not re-implement it: it counts nothing and simply
    // lets the domain error through to the global filter (409). Asserting the
    // absence of the count is the point — a guard restored here would protect
    // the HTTP caller only, which is the shape being retired.
    it('should not count positions itself and should propagate LocationInUseError', async () => {
      service.deleteLocation.mockRejectedValue(new LocationInUseError('ol_location_1', 3));

      await expect(controller.remove('ol_location_1')).rejects.toBeInstanceOf(LocationInUseError);
      expect(service.countPositionsAtLocation).not.toHaveBeenCalled();
    });
  });

  describe('response projection', () => {
    it('should emit ISO dates and only the allowlisted fields', async () => {
      const extra = makeLocation() as InventoryLocation & { secret?: string };
      extra.secret = 'must-not-leak';
      service.getLocation.mockResolvedValue(extra);

      const dto = await controller.get('ol_location_1');

      expect(dto.createdAt).toBe('2026-08-24T10:00:00.000Z');
      expect(dto.updatedAt).toBe('2026-08-24T11:00:00.000Z');
      expect(dto.latitude).toBe(52.2297);
      expect(Object.keys(dto).sort()).toEqual(
        [
          'code',
          'countryIso2',
          'createdAt',
          'externalRef',
          'id',
          'kind',
          'latitude',
          'longitude',
          'name',
          'ownerConnectionId',
          'postcode',
          'status',
          'updatedAt',
        ].sort()
      );
    });
  });
});
