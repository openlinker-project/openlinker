/**
 * Inventory Locations Controller - Unit Tests
 *
 * Covers what the controller itself decides: the country-filter uppercasing,
 * the null-to-404 read, the verbatim create delegation, the omitted-vs-null
 * partial-update distinction, the count-BEFORE-delete ordering behind the 409,
 * the response allowlist, and the `inventory-locations:write` lockstep.
 *
 * @module apps/api/src/inventory/http
 */
import 'reflect-metadata';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { NotFoundException, RequestMethod } from '@nestjs/common';
import {
  InventoryLocation,
  LOCATION_SERVICE_TOKEN,
  LocationInUseError,
  type ILocationService,
} from '@openlinker/core/inventory';
import { ROLE_PERMISSIONS, UserRoleValues } from '@openlinker/core/users';
import { InventoryLocationsController } from './inventory-locations.controller';
import { ROLES_KEY } from '../../auth/decorators/roles.decorator';

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
      countActiveLocations: jest.fn(),
      bootstrapDefaultLocations: jest.fn(),
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

  describe('bootstrap (#2407)', () => {
    it('reports what it created and what was already there', async () => {
      const location = makeLocation();
      service.bootstrapDefaultLocations.mockResolvedValue({
        created: [location],
        existingCodes: [],
      });

      const result = await controller.bootstrap();

      expect(result.created).toHaveLength(1);
      expect(result.created[0].code).toBe(location.code);
      expect(result.existingCodes).toEqual([]);
    });

    it('reports a re-run as having created nothing, rather than as an empty success', async () => {
      // `created: []` on its own reads identically to a write that failed
      // silently. `existingCodes` is what makes the no-op legible.
      service.bootstrapDefaultLocations.mockResolvedValue({ created: [], existingCodes: ['MAIN'] });

      const result = await controller.bootstrap();

      expect(result.created).toEqual([]);
      expect(result.existingCodes).toEqual(['MAIN']);
    });
  });
});

/**
 * `inventory-locations:write` is a DISPLAY predicate only - no permission guard
 * exists, so the FE reads it to decide whether to render a control while the
 * controller's own `@Roles` is what actually refuses. The two must agree, or an
 * operator is shown an enabled button that answers 403.
 *
 * The earlier form of this assertion read `ROLE_PERMISSIONS` against a
 * hardcoded `['admin']` literal, which is only the GRANT half: changing the
 * controller to `@Roles('admin', 'operator')` left it green, i.e. it could not
 * fail on the drift its own name promised to catch (#3198 review; the #2673
 * check-that-cannot-fail shape). Both halves are now read from source - the
 * grant from `ROLE_PERMISSIONS`, the requirement from the controller's own
 * decorator metadata, the `route-authorization-coverage.spec.ts` technique.
 */
const WRITE_METHODS: readonly RequestMethod[] = [
  RequestMethod.POST,
  RequestMethod.PUT,
  RequestMethod.PATCH,
  RequestMethod.DELETE,
];

/** Deliberately a literal, as in `route-authorization-coverage.spec.ts`. */
const METHOD_METADATA = 'method';

interface WriteRoute {
  readonly handler: string;
  /** Sorted, so the comparison does not depend on decorator argument order. */
  readonly roles: readonly string[];
}

function discoverWriteRoutes(): WriteRoute[] {
  const proto = InventoryLocationsController.prototype as unknown as Record<string, unknown>;
  const routes: WriteRoute[] = [];

  for (const handler of Object.getOwnPropertyNames(proto)) {
    if (handler === 'constructor') continue;
    const fn = proto[handler];
    if (typeof fn !== 'function') continue;

    // `RequestMethod.GET` is 0, so emptiness is `undefined`, never falsiness.
    const verb = Reflect.getMetadata(METHOD_METADATA, fn) as RequestMethod | undefined;
    if (verb === undefined || !WRITE_METHODS.includes(verb)) continue;

    const roles = (Reflect.getMetadata(ROLES_KEY, fn) as string[] | undefined) ?? [];
    routes.push({ handler, roles: [...roles].sort() });
  }

  return routes.sort((a, b) => a.handler.localeCompare(b.handler));
}

function rolesGrantedWritePermission(): string[] {
  return UserRoleValues.filter((role) =>
    ROLE_PERMISSIONS[role].includes('inventory-locations:write')
  )
    .slice()
    .sort();
}

describe('inventory-locations:write permission lockstep', () => {
  it('should be granted to exactly the roles every write route of this controller @Roles', () => {
    const routes = discoverWriteRoutes();

    // Discovery guard: a vacuous or shrunken route set would make the
    // comparison below pass while asserting nothing, which is the failure this
    // whole block exists to remove. Handler names, not a count, so a renamed
    // or newly added write route is a visible diff line here.
    expect(routes.map((route) => route.handler)).toEqual([
      'bootstrap',
      'create',
      'remove',
      'update',
    ]);

    const granted = rolesGrantedWritePermission();
    const drifted = routes.filter((route) => route.roles.join() !== granted.join());

    // Empty-array comparison rather than a loop: a failure prints the offending
    // handlers together with the roles they actually carry.
    expect(drifted).toEqual([]);
  });

  it('should keep every write route admin-only', () => {
    // The lockstep above only proves the two halves AGREE; this is the anchor
    // that says which value they must agree on (#2316: the location register is
    // configuration, so its writes are admin-only).
    expect(rolesGrantedWritePermission()).toEqual(['admin']);
    expect(discoverWriteRoutes().map((route) => route.roles)).toEqual([
      ['admin'],
      ['admin'],
      ['admin'],
      ['admin'],
    ]);
  });
});
