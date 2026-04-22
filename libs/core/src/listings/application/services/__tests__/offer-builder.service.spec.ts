/**
 * Offer Builder Service Tests
 *
 * @module libs/core/src/listings/application/services/__tests__
 */
import { Test, TestingModule } from '@nestjs/testing';

import { CONNECTION_PORT_TOKEN } from '@openlinker/core/identifier-mapping';
import type { ConnectionPort, Connection } from '@openlinker/core/identifier-mapping';
import { INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import type { OfferManagerPort } from '@openlinker/core/listings';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import { PRODUCT_VARIANT_REPOSITORY_TOKEN } from '@openlinker/core/products';
import type { ProductVariant, ProductVariantRepositoryPort } from '@openlinker/core/products';

import { OfferBuilderService } from '../offer-builder.service';
import { CATEGORY_RESOLUTION_SERVICE_TOKEN } from '../../../listings.tokens';
import type { ICategoryResolutionService } from '../../interfaces/category-resolution.service.interface';
import { OfferBuilderValidationException } from '../../../domain/exceptions/offer-builder-validation.exception';
import { MasterCatalogConnectionNotConfiguredException } from '../../../domain/exceptions/master-catalog-connection-not-configured.exception';

describe('OfferBuilderService', () => {
  let service: OfferBuilderService;
  let variantRepo: jest.Mocked<Pick<ProductVariantRepositoryPort, 'findById'>>;
  let connectionPort: jest.Mocked<Pick<ConnectionPort, 'get'>>;
  let integrationsService: jest.Mocked<Pick<IIntegrationsService, 'getCapabilityAdapter'>>;
  let categoryResolution: jest.Mocked<Pick<ICategoryResolutionService, 'resolveCategory'>>;
  let productMaster: { getProduct: jest.Mock };

  const VARIANT_ID = 'ol_variant_123';
  const MARKETPLACE_CONN_ID = 'conn-allegro';
  const MASTER_CONN_ID = 'conn-prestashop';

  const defaultVariant = {
    id: VARIANT_ID,
    productId: 'ol_product_456',
    sku: 'SKU-1',
    ean: '5901234123457',
    gtin: undefined,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  } as unknown as ProductVariant;

  const defaultConnection: Partial<Connection> = {
    id: MARKETPLACE_CONN_ID,
    platformType: 'allegro',
    config: { masterCatalogConnectionId: MASTER_CONN_ID },
  };

  beforeEach(async () => {
    variantRepo = { findById: jest.fn().mockResolvedValue(defaultVariant) };
    connectionPort = {
      get: jest.fn().mockResolvedValue(defaultConnection as Connection),
    };
    productMaster = {
      getProduct: jest.fn().mockResolvedValue({
        id: 'ol_product_456',
        name: 'Test Product',
        sku: 'SKU-1',
        description: 'A test product description.',
        price: 49.99,
        currency: 'PLN',
        images: ['https://example.com/img1.jpg', 'https://example.com/img2.jpg'],
      }),
    };
    integrationsService = {
      getCapabilityAdapter: jest.fn().mockResolvedValue(productMaster as unknown as OfferManagerPort),
    };
    categoryResolution = {
      resolveCategory: jest
        .fn()
        .mockResolvedValue({ allegroCategoryId: 'allegro-cat-999', method: 'auto_detect' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OfferBuilderService,
        { provide: PRODUCT_VARIANT_REPOSITORY_TOKEN, useValue: variantRepo },
        { provide: CONNECTION_PORT_TOKEN, useValue: connectionPort },
        { provide: INTEGRATIONS_SERVICE_TOKEN, useValue: integrationsService },
        { provide: CATEGORY_RESOLUTION_SERVICE_TOKEN, useValue: categoryResolution },
      ],
    }).compile();

    service = module.get(OfferBuilderService);
  });

  describe('happy path', () => {
    it('resolves product, category, price and builds a neutral CreateOfferCommand', async () => {
      const result = await service.buildCreateOfferCommand({
        internalVariantId: VARIANT_ID,
        connectionId: MARKETPLACE_CONN_ID,
        stock: 10,
        publishImmediately: true,
      });

      expect(variantRepo.findById).toHaveBeenCalledWith(VARIANT_ID);
      expect(connectionPort.get).toHaveBeenCalledWith(MARKETPLACE_CONN_ID);
      expect(integrationsService.getCapabilityAdapter).toHaveBeenCalledWith(
        MASTER_CONN_ID,
        'ProductMaster',
      );
      expect(categoryResolution.resolveCategory).toHaveBeenCalledWith({
        connectionId: MARKETPLACE_CONN_ID,
        barcode: '5901234123457',
      });

      expect(result).toEqual({
        internalVariantId: VARIANT_ID,
        connectionId: MARKETPLACE_CONN_ID,
        price: { amount: 49.99, currency: 'PLN' },
        stock: 10,
        publishImmediately: true,
        overrides: {
          title: 'Test Product',
          description: 'A test product description.',
          categoryId: 'allegro-cat-999',
          imageUrls: ['https://example.com/img1.jpg', 'https://example.com/img2.jpg'],
        },
        idempotencyKey: undefined,
      });
    });
  });

  describe('category resolution', () => {
    it('skips CategoryResolutionService when overrides.categoryId is provided', async () => {
      const result = await service.buildCreateOfferCommand({
        internalVariantId: VARIANT_ID,
        connectionId: MARKETPLACE_CONN_ID,
        stock: 1,
        overrides: { categoryId: 'explicit-cat' },
      });

      expect(categoryResolution.resolveCategory).not.toHaveBeenCalled();
      expect(result.overrides?.categoryId).toBe('explicit-cat');
    });

    it('throws OfferBuilderValidationException when no barcode and no override', async () => {
      variantRepo.findById.mockResolvedValue({
        ...(defaultVariant as unknown as Record<string, unknown>),
        ean: undefined,
        gtin: undefined,
      } as unknown as ProductVariant);

      await expect(
        service.buildCreateOfferCommand({
          internalVariantId: VARIANT_ID,
          connectionId: MARKETPLACE_CONN_ID,
          stock: 1,
        }),
      ).rejects.toBeInstanceOf(OfferBuilderValidationException);
      expect(categoryResolution.resolveCategory).not.toHaveBeenCalled();
    });

    it('throws OfferBuilderValidationException when resolution returns null', async () => {
      categoryResolution.resolveCategory.mockResolvedValue({
        allegroCategoryId: null,
        method: 'manual',
      });

      await expect(
        service.buildCreateOfferCommand({
          internalVariantId: VARIANT_ID,
          connectionId: MARKETPLACE_CONN_ID,
          stock: 1,
        }),
      ).rejects.toBeInstanceOf(OfferBuilderValidationException);
    });
  });

  describe('variant and connection lookup', () => {
    it('throws OfferBuilderValidationException when variant is missing', async () => {
      variantRepo.findById.mockResolvedValue(null);

      await expect(
        service.buildCreateOfferCommand({
          internalVariantId: 'missing',
          connectionId: MARKETPLACE_CONN_ID,
          stock: 1,
        }),
      ).rejects.toBeInstanceOf(OfferBuilderValidationException);
      expect(connectionPort.get).not.toHaveBeenCalled();
    });

    it('throws MasterCatalogConnectionNotConfiguredException when config missing the key', async () => {
      connectionPort.get.mockResolvedValue({
        ...defaultConnection,
        config: {},
      } as Connection);

      await expect(
        service.buildCreateOfferCommand({
          internalVariantId: VARIANT_ID,
          connectionId: MARKETPLACE_CONN_ID,
          stock: 1,
        }),
      ).rejects.toBeInstanceOf(MasterCatalogConnectionNotConfiguredException);
      expect(integrationsService.getCapabilityAdapter).not.toHaveBeenCalled();
    });
  });

  describe('price and currency resolution', () => {
    it('uses input.price when provided, ignoring master product price', async () => {
      const result = await service.buildCreateOfferCommand({
        internalVariantId: VARIANT_ID,
        connectionId: MARKETPLACE_CONN_ID,
        stock: 1,
        price: { amount: 99.99, currency: 'EUR' },
      });

      expect(result.price).toEqual({ amount: 99.99, currency: 'EUR' });
    });

    it('throws when no input.price and master product has no currency', async () => {
      productMaster.getProduct.mockResolvedValue({
        id: 'ol_product_456',
        name: 'Test',
        sku: 'SKU-1',
        price: 49.99,
        // no currency
      });

      await expect(
        service.buildCreateOfferCommand({
          internalVariantId: VARIANT_ID,
          connectionId: MARKETPLACE_CONN_ID,
          stock: 1,
        }),
      ).rejects.toBeInstanceOf(OfferBuilderValidationException);
    });

    it('throws when no input.price and master product has no positive price', async () => {
      productMaster.getProduct.mockResolvedValue({
        id: 'ol_product_456',
        name: 'Test',
        sku: 'SKU-1',
        price: 0,
        currency: 'PLN',
      });

      await expect(
        service.buildCreateOfferCommand({
          internalVariantId: VARIANT_ID,
          connectionId: MARKETPLACE_CONN_ID,
          stock: 1,
        }),
      ).rejects.toBeInstanceOf(OfferBuilderValidationException);
    });
  });

  describe('passthrough fields', () => {
    it('forwards overrides.platformParams untouched', async () => {
      const platformParams = {
        deliveryPolicyId: 'deliv-1',
        returnPolicyId: 'ret-1',
        warrantyId: 'war-1',
      };

      const result = await service.buildCreateOfferCommand({
        internalVariantId: VARIANT_ID,
        connectionId: MARKETPLACE_CONN_ID,
        stock: 1,
        overrides: { platformParams },
      });

      expect(result.overrides?.platformParams).toBe(platformParams);
    });

    it('forwards idempotencyKey untouched', async () => {
      const result = await service.buildCreateOfferCommand({
        internalVariantId: VARIANT_ID,
        connectionId: MARKETPLACE_CONN_ID,
        stock: 1,
        idempotencyKey: 'idem-abc',
      });

      expect(result.idempotencyKey).toBe('idem-abc');
    });

    it('defaults publishImmediately to false when not set', async () => {
      const result = await service.buildCreateOfferCommand({
        internalVariantId: VARIANT_ID,
        connectionId: MARKETPLACE_CONN_ID,
        stock: 1,
      });

      expect(result.publishImmediately).toBe(false);
    });
  });

  describe('title/description/imageUrls overrides', () => {
    it('prefers overrides.title/description/imageUrls over master product values', async () => {
      const result = await service.buildCreateOfferCommand({
        internalVariantId: VARIANT_ID,
        connectionId: MARKETPLACE_CONN_ID,
        stock: 1,
        overrides: {
          title: 'Custom Title',
          description: 'Custom desc',
          imageUrls: ['https://example.com/custom.jpg'],
        },
      });

      expect(result.overrides?.title).toBe('Custom Title');
      expect(result.overrides?.description).toBe('Custom desc');
      expect(result.overrides?.imageUrls).toEqual(['https://example.com/custom.jpg']);
    });

    it('strips description and imageUrls from command when product has null values and no overrides', async () => {
      productMaster.getProduct.mockResolvedValue({
        id: 'ol_product_456',
        name: 'Test Product',
        sku: 'SKU-1',
        description: null,
        price: 49.99,
        currency: 'PLN',
        images: null,
      });

      const result = await service.buildCreateOfferCommand({
        internalVariantId: VARIANT_ID,
        connectionId: MARKETPLACE_CONN_ID,
        stock: 1,
      });

      expect(result.overrides).not.toBeUndefined();
      expect(result.overrides).not.toHaveProperty('description');
      expect(result.overrides).not.toHaveProperty('imageUrls');
      // Title + categoryId still populated, so overrides object still exists.
      expect(result.overrides?.title).toBe('Test Product');
      expect(result.overrides?.categoryId).toBe('allegro-cat-999');
    });

    it('treats null overrides.description/imageUrls as "no override" and falls back to product values', async () => {
      const result = await service.buildCreateOfferCommand({
        internalVariantId: VARIANT_ID,
        connectionId: MARKETPLACE_CONN_ID,
        stock: 1,
        overrides: {
          description: null,
          imageUrls: null,
        },
      });

      expect(result.overrides?.description).toBe('A test product description.');
      expect(result.overrides?.imageUrls).toEqual([
        'https://example.com/img1.jpg',
        'https://example.com/img2.jpg',
      ]);
    });
  });
});
