/**
 * Offer Builder Service Tests
 *
 * @module libs/core/src/listings/application/services/__tests__
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';

import { CONNECTION_PORT_TOKEN } from '@openlinker/core/identifier-mapping';
import type { ConnectionPort, Connection } from '@openlinker/core/identifier-mapping';
import { INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import type { OfferManagerPort } from '@openlinker/core/listings';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import { PRODUCTS_SERVICE_TOKEN } from '@openlinker/core/products';
import type { IProductsService, ProductVariant } from '@openlinker/core/products';

import { OfferBuilderService } from '../offer-builder.service';
import {
  ATTRIBUTE_PROJECTION_SERVICE_TOKEN,
  CATEGORY_RESOLUTION_SERVICE_TOKEN,
} from '../../../listings.tokens';
import type { ICategoryResolutionService } from '../../interfaces/category-resolution.service.interface';
import type { IAttributeProjectionService } from '../../interfaces/attribute-projection.service.interface';
import type { AttributeProjectionResult } from '../../types/attribute-projection.types';
import { OfferBuilderValidationException } from '../../../domain/exceptions/offer-builder-validation.exception';
import { MasterCatalogConnectionNotConfiguredException } from '../../../domain/exceptions/master-catalog-connection-not-configured.exception';

describe('OfferBuilderService', () => {
  let service: OfferBuilderService;
  let productsService: jest.Mocked<Pick<IProductsService, 'getVariant'>>;
  let connectionPort: jest.Mocked<Pick<ConnectionPort, 'get'>>;
  let integrationsService: jest.Mocked<Pick<IIntegrationsService, 'getCapabilityAdapter'>>;
  let categoryResolution: jest.Mocked<Pick<ICategoryResolutionService, 'resolveCategory'>>;
  let attributeProjection: jest.Mocked<IAttributeProjectionService>;
  let productMaster: { getProduct: jest.Mock };

  const emptyProjection: AttributeProjectionResult = {
    parameters: [],
    unmappedSourceKeys: [],
    unresolvedRequired: [],
  };

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
    productsService = { getVariant: jest.fn().mockResolvedValue(defaultVariant) };
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
      getCapabilityAdapter: jest
        .fn()
        .mockResolvedValue(productMaster as unknown as OfferManagerPort),
    };
    categoryResolution = {
      resolveCategory: jest
        .fn()
        .mockResolvedValue({
          destinationCategoryId: 'allegro-cat-999',
          provenance: 'owns',
          method: 'auto_detect',
        }),
    };
    attributeProjection = {
      project: jest.fn().mockResolvedValue(emptyProjection),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OfferBuilderService,
        { provide: PRODUCTS_SERVICE_TOKEN, useValue: productsService },
        { provide: CONNECTION_PORT_TOKEN, useValue: connectionPort },
        { provide: INTEGRATIONS_SERVICE_TOKEN, useValue: integrationsService },
        { provide: CATEGORY_RESOLUTION_SERVICE_TOKEN, useValue: categoryResolution },
        { provide: ATTRIBUTE_PROJECTION_SERVICE_TOKEN, useValue: attributeProjection },
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

      expect(productsService.getVariant).toHaveBeenCalledWith(VARIANT_ID);
      expect(connectionPort.get).toHaveBeenCalledWith(MARKETPLACE_CONN_ID);
      expect(integrationsService.getCapabilityAdapter).toHaveBeenCalledWith(
        MASTER_CONN_ID,
        'ProductMaster'
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
        // #431 — barcode threaded through for adapter-side smart-link.
        variantBarcode: '5901234123457',
        // #808 — no pre-resolved card on this input.
        productCardId: null,
      });
    });

    it('lifts overrides.productCardId to the top-level command (#808)', async () => {
      const result = await service.buildCreateOfferCommand({
        internalVariantId: VARIANT_ID,
        connectionId: MARKETPLACE_CONN_ID,
        stock: 1,
        overrides: { categoryId: 'explicit-cat', productCardId: 'allegro-card-42' },
      });

      expect(result.productCardId).toBe('allegro-card-42');
      // Stays a top-level hint (like variantBarcode), not duplicated in overrides.
      expect(result.overrides).not.toHaveProperty('productCardId');
    });

    it('sets productCardId null when no overrides.productCardId is provided (#808)', async () => {
      const result = await service.buildCreateOfferCommand({
        internalVariantId: VARIANT_ID,
        connectionId: MARKETPLACE_CONN_ID,
        stock: 1,
        overrides: { categoryId: 'explicit-cat' },
      });

      expect(result.productCardId).toBeNull();
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
      productsService.getVariant.mockResolvedValue({
        ...(defaultVariant as unknown as Record<string, unknown>),
        ean: undefined,
        gtin: undefined,
      } as unknown as ProductVariant);

      await expect(
        service.buildCreateOfferCommand({
          internalVariantId: VARIANT_ID,
          connectionId: MARKETPLACE_CONN_ID,
          stock: 1,
        })
      ).rejects.toBeInstanceOf(OfferBuilderValidationException);
      expect(categoryResolution.resolveCategory).not.toHaveBeenCalled();
    });

    it('throws OfferBuilderValidationException when resolution returns null', async () => {
      categoryResolution.resolveCategory.mockResolvedValue({
        destinationCategoryId: null,
        provenance: null,
        method: 'manual',
      });

      await expect(
        service.buildCreateOfferCommand({
          internalVariantId: VARIANT_ID,
          connectionId: MARKETPLACE_CONN_ID,
          stock: 1,
        })
      ).rejects.toBeInstanceOf(OfferBuilderValidationException);
    });
  });

  describe('variant and connection lookup', () => {
    it('throws OfferBuilderValidationException when variant is missing', async () => {
      productsService.getVariant.mockResolvedValue(null);

      await expect(
        service.buildCreateOfferCommand({
          internalVariantId: 'missing',
          connectionId: MARKETPLACE_CONN_ID,
          stock: 1,
        })
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
        })
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
        })
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
        })
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

  describe('attribute projection (#1039)', () => {
    it('forwards the master product categories as sourceCategoryIds to resolution', async () => {
      productMaster.getProduct.mockResolvedValue({
        id: 'ol_product_456',
        name: 'Test Product',
        sku: 'SKU-1',
        description: 'desc',
        price: 49.99,
        currency: 'PLN',
        images: ['https://example.com/img1.jpg'],
        categories: ['ps-cat-15', 'ps-cat-22'],
      });

      await service.buildCreateOfferCommand({
        internalVariantId: VARIANT_ID,
        connectionId: MARKETPLACE_CONN_ID,
        stock: 1,
      });

      expect(categoryResolution.resolveCategory).toHaveBeenCalledWith({
        connectionId: MARKETPLACE_CONN_ID,
        barcode: '5901234123457',
        sourceCategoryIds: ['ps-cat-15', 'ps-cat-22'],
      });
    });

    it('projects against the resolved category and puts the parameters on the command', async () => {
      productsService.getVariant.mockResolvedValue({
        ...(defaultVariant as unknown as Record<string, unknown>),
        attributes: { Color: 'Red' },
      } as unknown as ProductVariant);
      attributeProjection.project.mockResolvedValue({
        parameters: [{ id: '224017', valuesIds: ['11954'], section: 'product' }],
        unmappedSourceKeys: [],
        unresolvedRequired: [],
      });

      const result = await service.buildCreateOfferCommand({
        internalVariantId: VARIANT_ID,
        connectionId: MARKETPLACE_CONN_ID,
        stock: 1,
      });

      expect(attributeProjection.project).toHaveBeenCalledWith({
        sourceConnectionId: MASTER_CONN_ID,
        destinationConnectionId: MARKETPLACE_CONN_ID,
        destinationCategoryId: 'allegro-cat-999',
        attributes: { Color: 'Red' },
      });
      expect(result.parameters).toEqual([
        { id: '224017', valuesIds: ['11954'], section: 'product' },
      ]);
    });

    it('omits the parameters field when projection yields none', async () => {
      const result = await service.buildCreateOfferCommand({
        internalVariantId: VARIANT_ID,
        connectionId: MARKETPLACE_CONN_ID,
        stock: 1,
      });

      expect(result).not.toHaveProperty('parameters');
    });

    it('business_failures when an OFFER-section required param is unresolved', async () => {
      attributeProjection.project.mockResolvedValue({
        parameters: [],
        unmappedSourceKeys: [],
        unresolvedRequired: [{ id: 'cond-1', name: 'Stan', section: 'offer' }],
      });

      const error = await service
        .buildCreateOfferCommand({
          internalVariantId: VARIANT_ID,
          connectionId: MARKETPLACE_CONN_ID,
          stock: 1,
        })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(OfferBuilderValidationException);
      expect((error as OfferBuilderValidationException).issues).toEqual([
        expect.objectContaining({ field: 'parameters.Stan', code: 'PARAMETER_REQUIRED' }),
      ]);
    });

    it('does NOT gate PRODUCT-section required params (deferred to adapter / card inheritance)', async () => {
      attributeProjection.project.mockResolvedValue({
        parameters: [],
        unmappedSourceKeys: [],
        unresolvedRequired: [{ id: 'brand-1', name: 'Marka', section: 'product' }],
      });

      const result = await service.buildCreateOfferCommand({
        internalVariantId: VARIANT_ID,
        connectionId: MARKETPLACE_CONN_ID,
        stock: 1,
      });

      expect(result.internalVariantId).toBe(VARIANT_ID);
    });

    it('merges operator overrides.parameters with projected (operator wins by id) (#1071)', async () => {
      attributeProjection.project.mockResolvedValue({
        parameters: [
          { id: 'cond-1', valuesIds: ['proj'], section: 'offer' },
          { id: 'brand-1', valuesIds: ['canon'], section: 'product' },
        ],
        unmappedSourceKeys: [],
        unresolvedRequired: [],
      });

      const result = await service.buildCreateOfferCommand({
        internalVariantId: VARIANT_ID,
        connectionId: MARKETPLACE_CONN_ID,
        stock: 1,
        overrides: {
          parameters: [{ id: 'cond-1', values: ['Operator'], section: 'offer' }],
        },
      });

      expect(result.parameters).toEqual([
        // operator wins for cond-1; projected brand-1 retained.
        { id: 'cond-1', values: ['Operator'], section: 'offer' },
        { id: 'brand-1', valuesIds: ['canon'], section: 'product' },
      ]);
      // S1 — operator params are consumed into command.parameters, not leaked
      // onto command.overrides (the adapter reads only cmd.parameters).
      expect(result.overrides).not.toHaveProperty('parameters');
    });

    it('satisfies Gate 2 from an operator overrides.parameters offer-section param (#1071)', async () => {
      attributeProjection.project.mockResolvedValue({
        parameters: [],
        unmappedSourceKeys: [],
        unresolvedRequired: [{ id: 'cond-1', name: 'Stan', section: 'offer' }],
      });

      const result = await service.buildCreateOfferCommand({
        internalVariantId: VARIANT_ID,
        connectionId: MARKETPLACE_CONN_ID,
        stock: 1,
        overrides: { parameters: [{ id: 'cond-1', values: ['Nowy'], section: 'offer' }] },
      });

      expect(result.internalVariantId).toBe(VARIANT_ID);
    });

    it('hoists legacy platformParams params for pre-#1071 snapshots (fallback, I3)', async () => {
      attributeProjection.project.mockResolvedValue({
        parameters: [],
        unmappedSourceKeys: [],
        unresolvedRequired: [{ id: 'cond-1', name: 'Stan', section: 'offer' }],
      });

      // No overrides.parameters → fallback reads platformParams.{parameters,productParameters}.
      const result = await service.buildCreateOfferCommand({
        internalVariantId: VARIANT_ID,
        connectionId: MARKETPLACE_CONN_ID,
        stock: 1,
        overrides: {
          platformParams: {
            parameters: [{ id: 'cond-1', values: ['Nowy'] }],
            productParameters: [{ id: 'brand-1', valuesIds: ['canon'] }],
          },
        },
      });

      // Gate 2 satisfied (cond-1 hoisted) AND both hoisted into command.parameters.
      expect(result.parameters).toEqual([
        { id: 'cond-1', values: ['Nowy'], section: 'offer' },
        { id: 'brand-1', valuesIds: ['canon'], section: 'product' },
      ]);
    });

    it('builds and warns (no throw) when there are unmapped source keys', async () => {
      const warnSpy = jest
        .spyOn((service as unknown as { logger: { warn: jest.Mock } }).logger, 'warn')
        .mockImplementation(() => undefined);
      attributeProjection.project.mockResolvedValue({
        parameters: [],
        unmappedSourceKeys: ['Material', 'Pattern'],
        unresolvedRequired: [],
      });

      const result = await service.buildCreateOfferCommand({
        internalVariantId: VARIANT_ID,
        connectionId: MARKETPLACE_CONN_ID,
        stock: 1,
      });

      expect(result.internalVariantId).toBe(VARIANT_ID);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Material, Pattern'));
    });

    it('propagates a projection infra error (not swallowed → job retries)', async () => {
      attributeProjection.project.mockRejectedValue(new Error('Allegro category-params fetch failed'));

      await expect(
        service.buildCreateOfferCommand({
          internalVariantId: VARIANT_ID,
          connectionId: MARKETPLACE_CONN_ID,
          stock: 1,
        })
      ).rejects.toThrow('Allegro category-params fetch failed');
    });

    it('does not project when the category is unresolved (Gate 1 throws first)', async () => {
      categoryResolution.resolveCategory.mockResolvedValue({
        destinationCategoryId: null,
        provenance: null,
        method: 'manual',
      });

      await expect(
        service.buildCreateOfferCommand({
          internalVariantId: VARIANT_ID,
          connectionId: MARKETPLACE_CONN_ID,
          stock: 1,
        })
      ).rejects.toBeInstanceOf(OfferBuilderValidationException);
      expect(attributeProjection.project).not.toHaveBeenCalled();
    });
  });
});
