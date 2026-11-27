/**
 * MappingsController role-metadata tests (#1653)
 *
 * Asserts the @Roles posture of every route handler after #1652 (reads opened
 * to viewer) and #1653 (writes opened to operator):
 *   - read (GET) handlers grant admin/operator/viewer
 *   - write (PUT/DELETE) handlers grant admin/operator
 *
 * Reads decorator metadata off the prototype via Reflect.getMetadata — no DI or
 * database required, mirroring write-guard-coverage.spec.ts. The class-level
 * @Roles('admin') deny-by-default default is intentionally not asserted here;
 * every handler carries its own override.
 *
 * @module apps/api/src/mappings/http/__tests__
 */
import 'reflect-metadata';
import { BadRequestException, RequestMethod } from '@nestjs/common';

import { ROLES_KEY } from '../../../auth/decorators/roles.decorator';
import { MappingsController } from '../mappings.controller';
import {
  CategoryMapping,
  CategoryMappingReassignSameConnectionException,
  type IMappingConfigService,
} from '@openlinker/core/mappings';
import type { IIntegrationsService } from '@openlinker/core/integrations';

const METHOD_METADATA = 'method';

const WRITE_METHODS = new Set<RequestMethod>([
  RequestMethod.POST,
  RequestMethod.PUT,
  RequestMethod.PATCH,
  RequestMethod.DELETE,
]);

type HandlerRoles = { method: RequestMethod; roles: string[] };

function collectHandlers(): Record<string, HandlerRoles> {
  const proto = MappingsController.prototype as unknown as Record<string, unknown>;
  const handlers: Record<string, HandlerRoles> = {};

  for (const methodName of Object.getOwnPropertyNames(proto)) {
    if (methodName === 'constructor') continue;
    if (typeof proto[methodName] !== 'function') continue;

    const fn = proto[methodName] as object;
    const httpMethod = Reflect.getMetadata(METHOD_METADATA, fn) as RequestMethod | undefined;
    if (httpMethod === undefined) continue;

    const roles = (Reflect.getMetadata(ROLES_KEY, fn) as string[] | undefined) ?? [];
    handlers[methodName] = { method: httpMethod, roles };
  }

  return handlers;
}

describe('MappingsController role metadata (#1652 / #1653)', () => {
  const handlers = collectHandlers();

  it('exposes both read and write handlers', () => {
    const methods = Object.values(handlers).map((h) => h.method);
    expect(methods).toContain(RequestMethod.GET);
    expect(methods.some((m) => WRITE_METHODS.has(m))).toBe(true);
  });

  it('read (GET) handlers grant admin/operator/viewer', () => {
    const offenders = Object.entries(handlers)
      .filter(([, h]) => h.method === RequestMethod.GET)
      .filter(([, h]) => {
        const set = new Set(h.roles);
        return !(set.has('admin') && set.has('operator') && set.has('viewer'));
      })
      .map(([name, h]) => `${name}: [${h.roles.join(', ')}]`);

    expect(offenders).toEqual([]);
  });

  it('write (PUT/DELETE) handlers grant admin and operator', () => {
    const offenders = Object.entries(handlers)
      .filter(([, h]) => WRITE_METHODS.has(h.method))
      .filter(([, h]) => {
        const set = new Set(h.roles);
        return !(set.has('admin') && set.has('operator'));
      })
      .map(([name, h]) => `${name}: [${h.roles.join(', ')}]`);

    expect(offenders).toEqual([]);
  });

  it('does not grant viewer write access', () => {
    const viewerWrites = Object.entries(handlers)
      .filter(([, h]) => WRITE_METHODS.has(h.method))
      .filter(([, h]) => h.roles.includes('viewer'))
      .map(([name]) => name);

    expect(viewerWrites).toEqual([]);
  });
});

describe('MappingsController category mappings (#3993)', () => {
  const service = {
    getCategoryMappings: jest.fn().mockResolvedValue([]),
    upsertCategoryMapping: jest.fn(),
    deleteCategoryMapping: jest.fn().mockResolvedValue(undefined),
    reassignCategoryMappings: jest.fn().mockResolvedValue({ moved: 1, keptSourceCategoryIds: ['7'] }),
  };
  const marketplace = {
    connection: { name: 'Allegro', enabledCapabilities: ['OfferManager'] },
    metadata: { supportedCapabilities: ['OfferManager', 'CategoryBrowser'] },
  };
  const integrations = { getAdapter: jest.fn().mockResolvedValue(marketplace) };
  const controller = new MappingsController(
    service as unknown as IMappingConfigService,
    integrations as unknown as IIntegrationsService
  );

  beforeEach(() => {
    jest.clearAllMocks();
    integrations.getAdapter.mockResolvedValue(marketplace);
  });

  it('should save under the route marketplace with the master as source when upserting', async () => {
    service.upsertCategoryMapping.mockResolvedValue(
      new CategoryMapping('m1', 'master-1', 'alg-1', '7', '258066', 'Phones', null, 'allegro')
    );

    const dto = await controller.upsertCategoryMapping('alg-1', '7', {
      sourceConnectionId: 'master-1',
      allegroCategoryId: '258066',
      allegroCategoryName: 'Phones',
    });

    expect(service.upsertCategoryMapping).toHaveBeenCalledWith('alg-1', {
      sourceConnectionId: 'master-1',
      sourceCategoryId: '7',
      destinationCategoryId: '258066',
      destinationCategoryName: 'Phones',
      destinationCategoryPath: undefined,
    });
    expect(dto.sourceConnectionId).toBe('master-1');
  });

  it('should scope listing and deleting to the source connection when one is given', async () => {
    await controller.getCategoryMappings('alg-1', { sourceConnectionId: 'master-1' });
    await controller.deleteCategoryMapping('alg-1', '7', { sourceConnectionId: 'master-1' });

    expect(service.getCategoryMappings).toHaveBeenCalledWith('alg-1', 'master-1');
    expect(service.deleteCategoryMapping).toHaveBeenCalledWith('alg-1', '7', 'master-1');
  });

  it('should move mappings from the given connection onto the route marketplace when reassigning', async () => {
    const result = await controller.reassignCategoryMappings('alg-1', { fromConnectionId: 'master-1' });

    expect(service.reassignCategoryMappings).toHaveBeenCalledWith('master-1', 'alg-1');
    expect(result).toEqual({ moved: 1, keptSourceCategoryIds: ['7'] });
  });

  it('should still accept a write without sourceConnectionId for one release when an old client sends it', async () => {
    service.upsertCategoryMapping.mockResolvedValue(
      new CategoryMapping('m2', null, 'alg-1', '7', '258066', 'Phones', null, 'allegro')
    );

    await controller.upsertCategoryMapping('alg-1', '7', {
      allegroCategoryId: '258066',
      allegroCategoryName: 'Phones',
    });

    expect(service.upsertCategoryMapping).toHaveBeenCalledWith(
      'alg-1',
      expect.objectContaining({ sourceConnectionId: undefined, sourceCategoryId: '7' })
    );
  });

  it('should answer 400 and move nothing when the route connection is not a marketplace with a category tree', async () => {
    integrations.getAdapter.mockResolvedValue({
      connection: { name: 'Woo shop', enabledCapabilities: ['OfferManager'] },
      metadata: { supportedCapabilities: ['OfferManager'] },
    });

    await expect(
      controller.reassignCategoryMappings('woo-1', { fromConnectionId: 'master-1' })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.reassignCategoryMappings).not.toHaveBeenCalled();
  });

  it('should answer 400 when asked to move mappings onto the connection they already belong to', async () => {
    service.reassignCategoryMappings.mockRejectedValueOnce(
      new CategoryMappingReassignSameConnectionException('alg-1')
    );

    await expect(
      controller.reassignCategoryMappings('alg-1', { fromConnectionId: 'alg-1' })
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
