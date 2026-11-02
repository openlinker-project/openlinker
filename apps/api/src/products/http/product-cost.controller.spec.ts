/**
 * Product Cost Controller Unit Tests (#3588)
 *
 * @module apps/api/src/products/http
 */
import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA, MODULE_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { InvalidVariantCostError, ProductVariantNotFoundError } from '@openlinker/core/products';
import type { IProductsService, Product, ProductVariant } from '@openlinker/core/products';
import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../auth/auth.types';
import type { IProductCostReadsService } from '../application/services/product-cost-reads.service.interface';
import { ProductCostController } from './product-cost.controller';
import { ProductsController, VariantsController } from './products.controller';
import { ProductsApiModule } from '../products.module';

const proto = ProductCostController.prototype as unknown as Record<string, object>;
const user = { id: 'user-1' } as AuthenticatedUser;

function variant(overrides: Partial<ProductVariant> = {}): ProductVariant {
  return {
    id: 'ol_variant_1',
    productId: 'ol_product_1',
    sku: 'SKU-1',
    attributes: null,
    ean: null,
    gtin: null,
    netUnitCost: '0.0000',
    costCurrency: 'PLN',
    costUpdatedAt: new Date('2026-10-01T00:00:00Z'),
    costUpdatedByUserId: 'user-1',
    ...overrides,
  };
}

describe('ProductCostController', () => {
  let service: jest.Mocked<
    Pick<
      IProductsService,
      | 'recordVariantCost'
      | 'fillVariantCostsIfAbsent'
      | 'getVariant'
      | 'getProduct'
      | 'getVariantsByProductId'
    >
  >;
  let controller: ProductCostController;

  beforeEach(() => {
    service = {
      recordVariantCost: jest.fn(),
      fillVariantCostsIfAbsent: jest.fn(),
      getVariant: jest.fn(),
      getProduct: jest.fn(),
      getVariantsByProductId: jest.fn(),
    };
    controller = new ProductCostController(
      service as unknown as IProductsService,
      {} as unknown as IProductCostReadsService
    );
  });

  describe('authorization metadata', () => {
    it.each([['setVariantCost'], ['bulkFillCost']])('should restrict %s to admin', (route) => {
      expect(Reflect.getMetadata(ROLES_KEY, proto[route])).toEqual(['admin']);
    });

    it('should let admin, operator and viewer read variant costs, never a packer', () => {
      expect(Reflect.getMetadata(ROLES_KEY, proto.listVariantCosts)).toEqual([
        'admin',
        'operator',
        'viewer',
      ]);
    });
  });

  describe('route order', () => {
    it('should register the cost controller before the products controller', () => {
      const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, ProductsApiModule) as unknown[];

      expect(controllers.indexOf(ProductCostController)).toBeLessThan(
        controllers.indexOf(ProductsController)
      );
      expect(controllers.indexOf(ProductCostController)).toBeLessThan(
        controllers.indexOf(VariantsController)
      );
    });

    it('should declare the literal bulk route before the :variantId route', () => {
      const paths = ['bulkFillCost', 'setVariantCost'].map((m) => ({
        m,
        path: Reflect.getMetadata(PATH_METADATA, proto[m]) as string,
        method: Reflect.getMetadata(METHOD_METADATA, proto[m]) as RequestMethod,
      }));

      expect(paths[0].path).toBe('variants/cost');
      expect(paths[1].path).toBe('variants/:variantId/cost');
      expect(paths.every((p) => p.method === RequestMethod.PATCH)).toBe(true);
      const names = Object.getOwnPropertyNames(ProductCostController.prototype);
      expect(names.indexOf('bulkFillCost')).toBeLessThan(names.indexOf('setVariantCost'));
    });

    it('should not collide with the existing products GET routes', () => {
      expect(Reflect.getMetadata(PATH_METADATA, proto.listVariantCosts)).toBe(
        ':productId/variant-costs'
      );
      const existing = Object.getOwnPropertyNames(ProductsController.prototype)
        .map((n) => (ProductsController.prototype as unknown as Record<string, object>)[n])
        .filter((f) => typeof f === 'function')
        .map((f) => Reflect.getMetadata(PATH_METADATA, f) as string | undefined);
      expect(existing).not.toContain(':productId/variant-costs');
      expect(existing).not.toContain('variants/cost');
    });
  });

  describe('setVariantCost', () => {
    it('should record a cost and return the stored row', async () => {
      service.getVariant.mockResolvedValue(variant());

      const result = await controller.setVariantCost(
        'ol_variant_1',
        { netUnitCost: '0.00', currency: 'PLN' },
        user
      );

      expect(service.recordVariantCost).toHaveBeenCalledWith(
        'ol_variant_1',
        { netUnitCost: '0.00', currency: 'PLN' },
        'user-1'
      );
      expect(result).toEqual({
        variantId: 'ol_variant_1',
        netUnitCost: '0.0000',
        costCurrency: 'PLN',
        costUpdatedAt: '2026-10-01T00:00:00.000Z',
        costUpdatedByUserId: 'user-1',
      });
    });

    it('should clear with a null pair', async () => {
      service.getVariant.mockResolvedValue(variant({ netUnitCost: null, costCurrency: null }));

      await controller.setVariantCost('ol_variant_1', { netUnitCost: null, currency: null }, user);

      expect(service.recordVariantCost).toHaveBeenCalledWith('ol_variant_1', null, 'user-1');
    });

    it('should answer 404 for an unknown variant', async () => {
      service.recordVariantCost.mockRejectedValue(new ProductVariantNotFoundError('nope'));

      await expect(
        controller.setVariantCost('nope', { netUnitCost: '1', currency: 'PLN' }, user)
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('should answer 400 for an invalid cost', async () => {
      service.recordVariantCost.mockRejectedValue(new InvalidVariantCostError('bad'));

      await expect(
        controller.setVariantCost('v', { netUnitCost: '1', currency: 'PLN' }, user)
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('bulkFillCost', () => {
    it('should return the three buckets', async () => {
      const buckets = { filled: ['a'], skippedAlreadySet: ['b'], notFound: ['c'] };
      service.fillVariantCostsIfAbsent.mockResolvedValue(buckets);

      const result = await controller.bulkFillCost(
        { variantIds: ['a', 'b', 'c'], netUnitCost: '1.00', currency: 'PLN' },
        user
      );

      expect(result).toEqual(buckets);
      expect(service.fillVariantCostsIfAbsent).toHaveBeenCalledWith(
        ['a', 'b', 'c'],
        '1.00',
        'PLN',
        'user-1'
      );
    });
  });

  describe('listVariantCosts', () => {
    it('should list every variant with its cost and sku', async () => {
      service.getProduct.mockResolvedValue({ id: 'ol_product_1' } as Product);
      service.getVariantsByProductId.mockResolvedValue([
        variant(),
        variant({ id: 'ol_variant_2', sku: null, netUnitCost: null, costCurrency: null, costUpdatedAt: null, costUpdatedByUserId: null }),
      ]);

      const result = await controller.listVariantCosts('ol_product_1');

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ variantId: 'ol_variant_1', sku: 'SKU-1', netUnitCost: '0.0000' });
      expect(result[1]).toMatchObject({ variantId: 'ol_variant_2', netUnitCost: null, costUpdatedAt: null });
    });

    it('should answer 404 for an unknown product', async () => {
      service.getProduct.mockResolvedValue(null);

      await expect(controller.listVariantCosts('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
