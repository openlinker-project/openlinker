/**
 * Product Cost Controller - coverage and work-list reads (#3588)
 *
 * Roles, route order against the `:id` / `variants/:variantId` routes, query
 * validation and the `withTotal` contract of the four read routes.
 *
 * @module apps/api/src/products/http
 */
import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { IProductsService } from '@openlinker/core/products';
import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import type { IProductCostReadsService } from '../application/services/product-cost-reads.service.interface';
import { ProductsApiModule } from '../products.module';
import {
  CostCoverageQueryDto,
  CostWorklistCountQueryDto,
  CostWorklistQueryDto,
} from './dto/cost-coverage.dto';
import { ProductCostController } from './product-cost.controller';
import { ProductsController, VariantsController } from './products.controller';

const proto = ProductCostController.prototype as unknown as Record<string, object>;
const READ_ROUTES = [
  ['getCostCoverage', 'cost-coverage'],
  ['getCostSummary', 'cost-coverage/summary'],
  ['getCostWorklist', 'variants/cost-worklist'],
  ['countCostWorklist', 'variants/cost-worklist/count'],
] as const;

describe('ProductCostController read routes', () => {
  let reads: jest.Mocked<IProductCostReadsService>;
  let controller: ProductCostController;

  beforeEach(() => {
    reads = {
      getCostCoverage: jest.fn(),
      getSummary: jest.fn(),
      getWorklist: jest.fn(),
      countWorklist: jest.fn(),
    };
    controller = new ProductCostController({} as unknown as IProductsService, reads);
  });

  it.each(READ_ROUTES)('should let admin, operator and viewer read %s, never a packer', (route) => {
    expect(Reflect.getMetadata(ROLES_KEY, proto[route])).toEqual(['admin', 'operator', 'viewer']);
  });

  it.each(READ_ROUTES)('should declare %s as a GET on its literal path', (route, path) => {
    expect(Reflect.getMetadata(PATH_METADATA, proto[route])).toBe(path);
    expect(Reflect.getMetadata(METHOD_METADATA, proto[route])).toBe(RequestMethod.GET);
  });

  it('should be registered before the controllers whose :id / variants/:variantId GET routes would swallow these paths', () => {
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, ProductsApiModule) as unknown[];
    expect(controllers.indexOf(ProductCostController)).toBeLessThan(
      controllers.indexOf(ProductsController)
    );
    expect(controllers.indexOf(ProductCostController)).toBeLessThan(
      controllers.indexOf(VariantsController)
    );
  });

  it('should not share a literal path with any route of the products controller', () => {
    const existing = Object.getOwnPropertyNames(ProductsController.prototype)
      .map((n) => (ProductsController.prototype as unknown as Record<string, object>)[n])
      .filter((f) => typeof f === 'function')
      .map((f) => Reflect.getMetadata(PATH_METADATA, f) as string | undefined);
    for (const [, path] of READ_ROUTES) {
      expect(existing).not.toContain(path);
    }
  });

  it('should default the coverage window to 30 days', async () => {
    await controller.getCostCoverage({});
    expect(reads.getCostCoverage).toHaveBeenCalledWith(30);
  });

  it('should default the work list to the sold tab, 20 rows and offset 0 with a total', async () => {
    await controller.getCostWorklist({});
    expect(reads.getWorklist).toHaveBeenCalledWith(
      { tab: 'sold', q: undefined, channel: undefined, limit: 20, offset: 0 },
      true
    );
  });

  it('should skip the total when withTotal=false', async () => {
    await controller.getCostWorklist({ tab: 'all', withTotal: false, limit: 5, offset: 10 });
    expect(reads.getWorklist).toHaveBeenCalledWith(
      { tab: 'all', q: undefined, channel: undefined, limit: 5, offset: 10 },
      false
    );
  });

  it('should answer the count route with the same filters and no paging', async () => {
    reads.countWorklist.mockResolvedValue(7);
    const result = await controller.countCostWorklist({ tab: 'has-cost', q: 'cup' });
    expect(reads.countWorklist).toHaveBeenCalledWith({ tab: 'has-cost', q: 'cup', channel: undefined });
    expect(result).toEqual({ total: 7 });
  });
});

describe('cost read query DTOs', () => {
  const check = async <T extends object>(cls: new () => T, payload: Record<string, unknown>) =>
    validate(plainToInstance(cls, payload));

  it.each([1, 30, 366])('should accept days=%s', async (days) => {
    expect(await check(CostCoverageQueryDto, { days: String(days) })).toHaveLength(0);
  });

  it.each(['0', '367', '1.5', 'abc'])('should reject days=%s', async (days) => {
    const errors = await check(CostCoverageQueryDto, { days });
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('days');
  });

  it('should accept the three tabs and reject another', async () => {
    for (const tab of ['sold', 'all', 'has-cost']) {
      expect(await check(CostWorklistQueryDto, { tab })).toHaveLength(0);
    }
    expect((await check(CostWorklistQueryDto, { tab: 'nope' }))[0].property).toBe('tab');
  });

  it('should cap limit at 100 and refuse a non-uuid channel', async () => {
    expect((await check(CostWorklistQueryDto, { limit: '101' }))[0].property).toBe('limit');
    expect((await check(CostWorklistQueryDto, { channel: 'x' }))[0].property).toBe('channel');
    expect(await check(CostWorklistQueryDto, { limit: '100' })).toHaveLength(0);
  });

  it('should parse withTotal=false and refuse a stray value', async () => {
    const parsed = plainToInstance(CostWorklistQueryDto, { withTotal: 'false' });
    expect(parsed.withTotal).toBe(false);
    expect((await check(CostWorklistQueryDto, { withTotal: 'maybe' }))[0].property).toBe('withTotal');
  });

  it('should leave paging and withTotal off the count DTO', () => {
    const parsed = plainToInstance(CostWorklistCountQueryDto, { tab: 'all', q: 'x' });
    expect(parsed).toMatchObject({ tab: 'all', q: 'x' });
  });
});
