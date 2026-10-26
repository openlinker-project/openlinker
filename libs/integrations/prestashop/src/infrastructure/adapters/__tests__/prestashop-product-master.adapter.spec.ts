/**
 * PrestaShop Product Master Adapter Tests
 *
 * Unit tests for PrestashopProductMasterAdapter. Tests product fetching,
 * variant retrieval, identifier mapping, and error handling.
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters/__tests__
 */
import { PrestashopProductMasterAdapter } from '../prestashop-product-master.adapter';
import { createMockHttpClient } from '../../../__tests__/mocks/mock-http-client.factory';
import { createMockIdentifierMapping } from '../../../__tests__/mocks/mock-identifier-mapping.factory';
import { createTestConnection } from '../../../__tests__/fixtures/connection.fixture';
import { samplePrestashopProduct } from '../../../__tests__/fixtures/prestashop-product.fixture';
import { PrestashopProductMapper } from '../../mappers/prestashop-product.mapper';
import { PrestashopAttributeResolver } from '../../provisioners/prestashop-attribute.resolver';
import { PrestashopFeatureResolver } from '../../provisioners/prestashop-feature.resolver';
import { PrestashopCategoryPathResolver } from '../../provisioners/prestashop-category-path.resolver';
import {
  PrestashopResourceNotFoundException,
  PrestashopNotSupportedException,
  PrestashopTruncatedReadException,
} from '@openlinker/integrations-prestashop';
import { MasterProductNotFoundError } from '@openlinker/core/products';
import { PrestashopApiException } from '@openlinker/integrations-prestashop';
import type {
  PrestashopProduct,
  PrestashopCombination,
} from '../../mappers/prestashop.mapper.interface';
import type { IPrestashopWebserviceClient } from '../../http/prestashop-webservice.client.interface';
import type { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import type { PrestashopTaxRateResolver } from '../../provisioners/prestashop-tax-rate.resolver';
import type { PrestashopSalesCountryResolver } from '../../provisioners/prestashop-sales-country.resolver';
import type { PrestashopSalesCountry } from '../../provisioners/prestashop-sales-country.types';
import type {
  PrestashopTaxRateResolution,
  PrestashopTaxRateUnknownReason,
  PrestashopTaxRuleMatch,
} from '../../provisioners/prestashop-tax-rate.types';
import { Logger } from '@openlinker/shared/logging';

type SalesCountryResolverMock = jest.Mocked<Pick<PrestashopSalesCountryResolver, 'resolve'>>;
type GrossTaxRateResolverMock = jest.Mocked<
  Pick<PrestashopTaxRateResolver, 'resolveProductTaxRate'>
>;

/** Poland as the connection's sales country (ADR-077). */
const SALES_COUNTRY_PL: PrestashopSalesCountry = {
  countryId: 14,
  iso2: 'PL',
  source: 'setting',
  taxesEnabled: true,
};

/**
 * The gross price field asked for on a product read: `product_attribute=0`
 * prices the bare product, without the default combination's impact.
 */
const PRODUCT_GROSS_FIELDS = [
  { name: 'ol_gross', countryId: 14, useTax: true, productAttribute: 0 },
];

/** A combination row prices itself, so no `product_attribute` is sent. */
const COMBINATION_GROSS_FIELDS = [{ name: 'ol_gross', countryId: 14, useTax: true }];

/**
 * A product row as PrestaShop answers it with the gross price field asked for:
 * 100.00 net in a 23% group, 123.00 for a Polish buyer.
 */
function grossProductRow(overrides: Partial<PrestashopProduct> = {}): PrestashopProduct {
  return {
    ...samplePrestashopProduct,
    id: '42',
    price: '100.000000',
    ol_gross: '123.000000',
    ...overrides,
  };
}

function makeSalesCountryResolver(
  country: PrestashopSalesCountry | null = SALES_COUNTRY_PL
): SalesCountryResolverMock {
  const resolver: SalesCountryResolverMock = { resolve: jest.fn() };
  resolver.resolve.mockResolvedValue(country);
  return resolver;
}

function makeGrossTaxRateResolver(
  resolution: PrestashopTaxRateResolution = { kind: 'resolved', rate: 0.23, matchedBy: 'country' }
): GrossTaxRateResolverMock {
  const resolver: GrossTaxRateResolverMock = { resolveProductTaxRate: jest.fn() };
  resolver.resolveProductTaxRate.mockResolvedValue(resolution);
  return resolver;
}

describe('PrestashopProductMasterAdapter', () => {
  let adapter: PrestashopProductMasterAdapter;
  let mockHttpClient: jest.Mocked<IPrestashopWebserviceClient>;
  let mockIdentifierMapping: jest.Mocked<IdentifierMappingPort>;
  let connection: ReturnType<typeof createTestConnection>;
  let productMapper: PrestashopProductMapper;

  beforeEach(() => {
    mockHttpClient = createMockHttpClient();
    mockIdentifierMapping = createMockIdentifierMapping();
    connection = createTestConnection();
    productMapper = new PrestashopProductMapper({ storefrontBaseUrl: 'https://shop.test' });

    adapter = new PrestashopProductMasterAdapter(
      mockHttpClient,
      mockIdentifierMapping,
      productMapper,
      connection
    );
  });

  /**
   * An adapter wired the way the factory wires it for gross prices (ADR-077).
   * Both resolvers are positional and explicit so a test can leave either one
   * out on purpose.
   */
  function createGrossAdapter(
    salesCountryResolver: SalesCountryResolverMock | undefined,
    taxRateResolver: GrossTaxRateResolverMock | undefined,
    connectionUnderTest: ReturnType<typeof createTestConnection> = connection
  ): PrestashopProductMasterAdapter {
    return new PrestashopProductMasterAdapter(
      mockHttpClient,
      mockIdentifierMapping,
      productMapper,
      connectionUnderTest,
      undefined,
      undefined,
      undefined,
      taxRateResolver as unknown as PrestashopTaxRateResolver | undefined,
      undefined,
      salesCountryResolver as unknown as PrestashopSalesCountryResolver | undefined
    );
  }

  describe('getProduct', () => {
    it('should fetch and map a product successfully', async () => {
      const internalId = 'internal-product-123';
      const externalId = '42';

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([
        {
          connectionId: connection.id,
          externalId,
          entityType: 'Product',
        },
      ]);

      mockHttpClient.getResource = jest.fn().mockResolvedValue(samplePrestashopProduct);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      const result = await adapter.getProduct(internalId);

      expect(mockIdentifierMapping.getExternalIds).toHaveBeenCalledWith('Product', internalId);
      expect(mockHttpClient.getResource).toHaveBeenCalledWith('products', externalId);
      expect(result.id).toBe(internalId);
      expect(result.name).toBe('Test Product');
      expect(result.sku).toBe('TEST-001');
    });

    it('should throw MasterProductNotFoundError when no external ID mapping exists (#1599)', async () => {
      const internalId = 'internal-product-123';

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([]);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- test mock: narrowing dynamic spy / fixture / response shape
      await expect(adapter.getProduct(internalId)).rejects.toThrow(MasterProductNotFoundError);
    });

    it('should throw MasterProductNotFoundError when external ID not found for this connection (#1599)', async () => {
      const internalId = 'internal-product-123';

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([
        {
          connectionId: 'other-connection-id',
          externalId: '42',
          entityType: 'Product',
        },
      ]);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- test mock: narrowing dynamic spy / fixture / response shape
      await expect(adapter.getProduct(internalId)).rejects.toThrow(MasterProductNotFoundError);
    });

    it('should use connection langId from config', async () => {
      const internalId = 'internal-product-123';
      const externalId = '42';
      const connectionWithLang = createTestConnection({
        config: { ...connection.config, langId: 2 },
      });

      const adapterWithLang = new PrestashopProductMasterAdapter(
        mockHttpClient,
        mockIdentifierMapping,
        productMapper,
        connectionWithLang
      );

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([
        {
          connectionId: connectionWithLang.id,
          externalId,
          entityType: 'Product',
        },
      ]);

      mockHttpClient.getResource = jest.fn().mockResolvedValue(samplePrestashopProduct);

      await adapterWithLang.getProduct(internalId);

      // Verify mapper was called with langId 2
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(mockHttpClient.getResource).toHaveBeenCalled();
    });
  });

  describe('getProduct — features & category path (#1096)', () => {
    const internalId = 'internal-product-123';
    const externalId = '42';

    function mapExternalId(): void {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock
      mockIdentifierMapping.getExternalIds = jest
        .fn()
        .mockResolvedValue([{ connectionId: connection.id, externalId, entityType: 'Product' }]);
    }

    it('enriches the product with resolved features when a feature resolver is wired (F2)', async () => {
      mapExternalId();
      const productWithFeatures: PrestashopProduct = {
        ...samplePrestashopProduct,
        associations: {
          ...(samplePrestashopProduct.associations as Record<string, unknown>),
          product_features: [{ id: '1', id_feature_value: '10' }],
        },
      };

      mockHttpClient.getResource = jest.fn().mockResolvedValue(productWithFeatures);
      mockHttpClient.listResources = jest.fn((resource: string) => {
        if (resource === 'product_features') return Promise.resolve([{ id: '1', name: 'Material' }]);
        if (resource === 'product_feature_values')
          return Promise.resolve([{ id: '10', value: 'Ceramic' }]);
        return Promise.resolve([]);
      }) as unknown as jest.Mocked<IPrestashopWebserviceClient>['listResources'];

      const featureResolver = new PrestashopFeatureResolver();
      const adapterWithResolver = new PrestashopProductMasterAdapter(
        mockHttpClient,
        mockIdentifierMapping,
        productMapper,
        connection,
        new PrestashopAttributeResolver(),
        featureResolver
      );

      const result = await adapterWithResolver.getProduct(internalId);

      expect(result.features).toEqual([{ name: 'Material', value: 'Ceramic' }]);
    });

    it('leaves features unset when no feature resolver is wired (F2)', async () => {
      mapExternalId();
      mockHttpClient.getResource = jest.fn().mockResolvedValue(samplePrestashopProduct);

      const result = await adapter.getProduct(internalId);

      expect(result.features).toBeUndefined();
    });

    it('does not break sync when the feature resolver throws (F2)', async () => {
      mapExternalId();
      const productWithFeatures: PrestashopProduct = {
        ...samplePrestashopProduct,
        associations: { product_features: [{ id: '1', id_feature_value: '10' }] },
      };
      mockHttpClient.getResource = jest.fn().mockResolvedValue(productWithFeatures);
      mockHttpClient.listResources = jest
        .fn()
        .mockRejectedValue(new Error('boom')) as unknown as jest.Mocked<IPrestashopWebserviceClient>['listResources'];

      const adapterWithResolver = new PrestashopProductMasterAdapter(
        mockHttpClient,
        mockIdentifierMapping,
        productMapper,
        connection,
        new PrestashopAttributeResolver(),
        new PrestashopFeatureResolver()
      );

      const result = await adapterWithResolver.getProduct(internalId);

      expect(result.features).toBeUndefined();
      expect(result.id).toBe(internalId);
    });

    it('enriches the product with a full category breadcrumb (F3)', async () => {
      mapExternalId();
      const productWithCategory: PrestashopProduct = {
        ...samplePrestashopProduct,
        id_category_default: '12',
      };
      const categories: Record<string, { id: string; name: string; id_parent: string }> = {
        '5': { id: '5', name: 'Home & Garden', id_parent: '2' },
        '12': { id: '12', name: 'Mugs', id_parent: '5' },
      };
      mockHttpClient.getResource = jest.fn((resource: string, id: string | number) => {
        if (resource === 'categories') return Promise.resolve(categories[String(id)]);
        return Promise.resolve(productWithCategory);
      }) as unknown as jest.Mocked<IPrestashopWebserviceClient>['getResource'];

      const adapterWithResolver = new PrestashopProductMasterAdapter(
        mockHttpClient,
        mockIdentifierMapping,
        productMapper,
        connection,
        new PrestashopAttributeResolver(),
        new PrestashopFeatureResolver(),
        new PrestashopCategoryPathResolver()
      );

      const result = await adapterWithResolver.getProduct(internalId);

      expect(result.categoryBreadcrumb).toEqual([
        { id: '5', name: 'Home & Garden' },
        { id: '12', name: 'Mugs' },
      ]);
    });

    it('leaves categoryBreadcrumb unset when no path resolver is wired (F3)', async () => {
      mapExternalId();
      mockHttpClient.getResource = jest
        .fn()
        .mockResolvedValue({ ...samplePrestashopProduct, id_category_default: '12' });

      const result = await adapter.getProduct(internalId);

      expect(result.categoryBreadcrumb).toBeUndefined();
    });
  });

  /**
   * ADR-077: a catalogue price is the GROSS amount a buyer pays in the
   * connection's sales country. PrestaShop's own computed price is taken only
   * when it agrees with `net x (1 + rate)` for a rate the shop's rules name for
   * that country; anything else reports no price - never the net field.
   */
  describe('gross catalogue price gate (ADR-077)', () => {
    const internalId = 'internal-product-123';
    const externalId = '42';
    let warnSpy: jest.SpyInstance<void, Parameters<Logger['warn']>>;

    beforeEach(() => {
      mockIdentifierMapping.getExternalIds = jest
        .fn()
        .mockResolvedValue([{ connectionId: connection.id, externalId, entityType: 'Product' }]);
      warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    function grossUnavailableWarnings(): string[] {
      return warnSpy.mock.calls
        .map((call) => String(call[0]))
        .filter((message) => message.includes('prestashop_gross_price_unavailable'));
    }

    it("should report the shop's own gross price when the rule for the sales country agrees with net x (1 + rate)", async () => {
      const row = grossProductRow();
      mockHttpClient.getResource = jest.fn().mockResolvedValue(row);
      const salesCountryResolver = makeSalesCountryResolver();
      const taxRateResolver = makeGrossTaxRateResolver();
      const adapterUnderTest = createGrossAdapter(salesCountryResolver, taxRateResolver);

      const result = await adapterUnderTest.getProduct(internalId);

      expect(result.price).toBe(123);
      // The gross price rides on the one product read - no extra request.
      expect(mockHttpClient.getResource).toHaveBeenCalledTimes(1);
      expect(mockHttpClient.getResource).toHaveBeenCalledWith('products', externalId, {
        priceFields: PRODUCT_GROSS_FIELDS,
      });
      expect(salesCountryResolver.resolve).toHaveBeenCalledWith(
        connection.id,
        undefined,
        mockHttpClient
      );
      // The rate is asked for the sales country, with the product already read.
      expect(taxRateResolver.resolveProductTaxRate).toHaveBeenCalledWith(
        externalId,
        undefined,
        connection.id,
        mockHttpClient,
        row,
        { countryId: 14 }
      );
      expect(grossUnavailableWarnings()).toEqual([]);
    });

    it.each([
      ['a sub-cent figure', '24.587700'],
      ['a half-cent figure, rounded half-up', '24.585000'],
    ])(
      'should report %s as the cent amount when it agrees with net x (1 + rate)',
      async (_label, gross) => {
        // 19.99 net at 23% is 24.5877, i.e. 24.59 to the cent.
        mockHttpClient.getResource = jest
          .fn()
          .mockResolvedValue(grossProductRow({ price: '19.990000', ol_gross: gross }));
        const adapterUnderTest = createGrossAdapter(
          makeSalesCountryResolver(),
          makeGrossTaxRateResolver()
        );

        const result = await adapterUnderTest.getProduct(internalId);

        expect(result.price).toBe(24.59);
        expect(grossUnavailableWarnings()).toEqual([]);
      }
    );

    it('should accept the gross price when a catch-all rule names a rate the shop does charge', async () => {
      mockHttpClient.getResource = jest.fn().mockResolvedValue(grossProductRow());
      const adapterUnderTest = createGrossAdapter(
        makeSalesCountryResolver(),
        makeGrossTaxRateResolver({ kind: 'resolved', rate: 0.23, matchedBy: 'catch-all' })
      );

      const result = await adapterUnderTest.getProduct(internalId);

      expect(result.price).toBe(123);
    });

    it("should report no price when the only rule is another country's and the shop charges the sales country net (US-default shop)", async () => {
      // A stock docker install defaults to the US. The product's group has a
      // single Polish 23% rule, which the resolver can only offer as
      // `only-rule` - but PrestaShop prices the US buyer without it, so its
      // gross equals the net. Publishing that figure as gross is the defect.
      const usDefault: PrestashopSalesCountry = {
        countryId: 21,
        iso2: 'US',
        source: 'shop-default',
        taxesEnabled: true,
      };
      mockHttpClient.getResource = jest
        .fn()
        .mockResolvedValue(grossProductRow({ ol_gross: '100.000000' }));
      const taxRateResolver = makeGrossTaxRateResolver({
        kind: 'resolved',
        rate: 0.23,
        matchedBy: 'only-rule',
      });
      const adapterUnderTest = createGrossAdapter(
        makeSalesCountryResolver(usDefault),
        taxRateResolver
      );

      const result = await adapterUnderTest.getProduct(internalId);

      expect(result.price).toBeNull();
      expect(taxRateResolver.resolveProductTaxRate).toHaveBeenCalledWith(
        externalId,
        undefined,
        connection.id,
        mockHttpClient,
        expect.anything(),
        { countryId: 21 }
      );
      const warnings = grossUnavailableWarnings();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('in US (shop default country)');
      expect(warnings[0]).toContain('(only-rule rule) would be 123');
    });

    it.each([
      ['a different rate', '108.000000'],
      ['two cents off', '123.020000'],
    ])(
      "should report no price when the shop's gross is %s from net x (1 + rate)",
      async (_label, gross) => {
        mockHttpClient.getResource = jest
          .fn()
          .mockResolvedValue(grossProductRow({ ol_gross: gross }));
        const adapterUnderTest = createGrossAdapter(
          makeSalesCountryResolver(),
          makeGrossTaxRateResolver()
        );

        const result = await adapterUnderTest.getProduct(internalId);

        expect(result.price).toBeNull();
        expect(grossUnavailableWarnings()).toEqual([expect.stringContaining('would be 123')]);
      }
    );

    it("should accept the shop's gross when it is exactly one cent from net x (1 + rate)", async () => {
      // 123.01 - 123.00 is not exactly 0.01 in floating point; the check
      // compares whole cents so the documented tolerance really holds.
      mockHttpClient.getResource = jest
        .fn()
        .mockResolvedValue(grossProductRow({ ol_gross: '123.010000' }));
      const adapterUnderTest = createGrossAdapter(
        makeSalesCountryResolver(),
        makeGrossTaxRateResolver()
      );

      const result = await adapterUnderTest.getProduct(internalId);

      expect(result.price).toBe(123.01);
      expect(grossUnavailableWarnings()).toEqual([]);
    });

    it('should take the gross price as it stands, without asking for a rate, when the shop has taxes switched off', async () => {
      // `PS_TAX = 0`: the shop charges the net price to everyone.
      mockHttpClient.getResource = jest
        .fn()
        .mockResolvedValue(grossProductRow({ ol_gross: '100.000000' }));
      const taxRateResolver = makeGrossTaxRateResolver();
      const adapterUnderTest = createGrossAdapter(
        makeSalesCountryResolver({ ...SALES_COUNTRY_PL, taxesEnabled: false }),
        taxRateResolver
      );

      const result = await adapterUnderTest.getProduct(internalId);

      expect(result.price).toBe(100);
      expect(taxRateResolver.resolveProductTaxRate).not.toHaveBeenCalled();
      expect(grossUnavailableWarnings()).toEqual([]);
    });

    it("should round the shop's figure half-up to the cent when it carries more decimals", async () => {
      mockHttpClient.getResource = jest
        .fn()
        .mockResolvedValue(grossProductRow({ price: '8.125000', ol_gross: '8.125000' }));
      const adapterUnderTest = createGrossAdapter(
        makeSalesCountryResolver({ ...SALES_COUNTRY_PL, taxesEnabled: false }),
        makeGrossTaxRateResolver()
      );

      const result = await adapterUnderTest.getProduct(internalId);

      expect(result.price).toBe(8.13);
    });

    it('should report no price, never the net one, when the connection has no sales country', async () => {
      mockHttpClient.getResource = jest.fn().mockResolvedValue(grossProductRow());
      const taxRateResolver = makeGrossTaxRateResolver();
      const adapterUnderTest = createGrossAdapter(makeSalesCountryResolver(null), taxRateResolver);

      const result = await adapterUnderTest.getProduct(internalId);

      expect(result.price).toBeNull();
      // Without a country PrestaShop answers 0.000000, so no price field is asked for.
      expect(mockHttpClient.getResource).toHaveBeenCalledWith('products', externalId);
      expect(taxRateResolver.resolveProductTaxRate).not.toHaveBeenCalled();
      expect(grossUnavailableWarnings()).toEqual([
        expect.stringContaining('the connection has no sales country'),
      ]);
    });

    it('should report no price, never the net one, when no sales-country resolver is wired', async () => {
      mockHttpClient.getResource = jest.fn().mockResolvedValue(grossProductRow());

      const result = await adapter.getProduct(internalId);

      expect(result.price).toBeNull();
      expect(grossUnavailableWarnings()).toHaveLength(1);
    });

    it('should report no price when PrestaShop returned no computed gross for the product', async () => {
      mockHttpClient.getResource = jest
        .fn()
        .mockResolvedValue({ ...samplePrestashopProduct, id: '42', price: '100.000000' });
      const taxRateResolver = makeGrossTaxRateResolver();
      const adapterUnderTest = createGrossAdapter(makeSalesCountryResolver(), taxRateResolver);

      const result = await adapterUnderTest.getProduct(internalId);

      expect(result.price).toBeNull();
      expect(taxRateResolver.resolveProductTaxRate).not.toHaveBeenCalled();
      expect(grossUnavailableWarnings()).toEqual([
        expect.stringContaining('PrestaShop returned no computed price for product 42'),
      ]);
    });

    it.each<PrestashopTaxRateUnknownReason>(['configuration', 'ambiguous'])(
      'should report no price when the tax rate for the sales country is unknown (%s)',
      async (reason) => {
        mockHttpClient.getResource = jest.fn().mockResolvedValue(grossProductRow());
        const adapterUnderTest = createGrossAdapter(
          makeSalesCountryResolver(),
          makeGrossTaxRateResolver({
            kind: 'unknown',
            reason,
            evidence: 'tax rules group 1 has no rule for PL',
          })
        );

        const result = await adapterUnderTest.getProduct(internalId);

        expect(result.price).toBeNull();
        expect(grossUnavailableWarnings()).toEqual([
          expect.stringContaining('no tax rate for PL: tax rules group 1 has no rule for PL'),
        ]);
      }
    );

    it('should throw a retryable PrestashopApiException when the tax rate could not be read', async () => {
      mockHttpClient.getResource = jest.fn().mockResolvedValue(grossProductRow());
      const adapterUnderTest = createGrossAdapter(
        makeSalesCountryResolver(),
        makeGrossTaxRateResolver({
          kind: 'unknown',
          reason: 'transport',
          evidence: 'GET tax_rule_groups/1 returned 503',
          statusCode: 503,
        })
      );

      const error = await adapterUnderTest.getProduct(internalId).then(
        () => null,
        (e: unknown) => e
      );

      // A failed read says nothing about the shop's configuration, so it must
      // not be recorded as "no price" over a transient error.
      expect(error).toBeInstanceOf(PrestashopApiException);
      expect(error).not.toBeInstanceOf(MasterProductNotFoundError);
      expect((error as PrestashopApiException).statusCode).toBe(503);
      expect(grossUnavailableWarnings()).toEqual([]);
    });

    it('should report no price when no tax-rate resolver is wired', async () => {
      mockHttpClient.getResource = jest.fn().mockResolvedValue(grossProductRow());
      const adapterUnderTest = createGrossAdapter(makeSalesCountryResolver(), undefined);

      const result = await adapterUnderTest.getProduct(internalId);

      expect(result.price).toBeNull();
      expect(grossUnavailableWarnings()).toEqual([
        expect.stringContaining('no tax-rate resolver is wired'),
      ]);
    });

    it('should log the missing gross price once per product however many reads report it', async () => {
      mockHttpClient.getResource = jest.fn().mockResolvedValue(grossProductRow());
      mockHttpClient.listResources = jest.fn().mockResolvedValue([]);
      const adapterUnderTest = createGrossAdapter(
        makeSalesCountryResolver(null),
        makeGrossTaxRateResolver()
      );

      await adapterUnderTest.getProduct(internalId);
      await adapterUnderTest.getProduct(internalId);
      // A simple product's synthetic variant goes through the same gate.
      await adapterUnderTest.getProductVariants(internalId);

      expect(grossUnavailableWarnings()).toHaveLength(1);
    });

    it.each([
      ['the configured code', 'PL', 'PL'],
      ['no code for a blank setting', '  ', undefined],
    ])(
      'should ask the sales-country resolver for %s when the connection sets salesCountryIso2',
      async (_label, configured, expected) => {
        const configuredConnection = createTestConnection({
          config: { ...connection.config, salesCountryIso2: configured },
        });
        mockHttpClient.getResource = jest.fn().mockResolvedValue(grossProductRow());
        const salesCountryResolver = makeSalesCountryResolver();
        const adapterUnderTest = createGrossAdapter(
          salesCountryResolver,
          makeGrossTaxRateResolver(),
          configuredConnection
        );

        await adapterUnderTest.getProduct(internalId);

        expect(salesCountryResolver.resolve).toHaveBeenCalledWith(
          configuredConnection.id,
          expected,
          mockHttpClient
        );
      }
    );

    it('should ask for the sales country again after a failed read instead of pinning the error', async () => {
      mockHttpClient.getResource = jest.fn().mockResolvedValue(grossProductRow());
      const salesCountryResolver = makeSalesCountryResolver();
      salesCountryResolver.resolve.mockRejectedValueOnce(
        new PrestashopApiException('GET configurations returned 503', 503)
      );
      const adapterUnderTest = createGrossAdapter(
        salesCountryResolver,
        makeGrossTaxRateResolver()
      );

      await expect(adapterUnderTest.getProduct(internalId)).rejects.toBeInstanceOf(
        PrestashopApiException
      );
      await expect(adapterUnderTest.getProduct(internalId)).resolves.toMatchObject({
        price: 123,
      });

      expect(salesCountryResolver.resolve).toHaveBeenCalledTimes(2);
    });
  });

  describe('getProducts', () => {
    it('should fetch and map multiple products', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      const products: PrestashopProduct[] = [
        { ...samplePrestashopProduct, id: '1' },
        { ...samplePrestashopProduct, id: '2', reference: 'TEST-002' },
      ];

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockHttpClient.listResources = jest.fn().mockResolvedValue(products);

      const idMap = new Map([
        ['1:test-connection-id', 'internal-1'],
        ['2:test-connection-id', 'internal-2'],
      ]);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.batchGetOrCreateInternalIds = jest.fn().mockResolvedValue(idMap);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      const result = await adapter.getProducts();

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(mockHttpClient.listResources).toHaveBeenCalledWith(
        'products',
        { sort: ['id_ASC'] },
        undefined,
        undefined
      );
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('internal-1');
      expect(result[1].id).toBe('internal-2');
    });

    it('should return empty array when no products found', async () => {
      mockHttpClient.listResources = jest.fn().mockResolvedValue([]);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      const result = await adapter.getProducts();

      expect(result).toEqual([]);
      expect(mockIdentifierMapping.batchGetOrCreateInternalIds).not.toHaveBeenCalled();
    });

    it('should pass filters to HTTP client', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      const products: PrestashopProduct[] = [{ ...samplePrestashopProduct, id: '1' }];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockHttpClient.listResources = jest.fn().mockResolvedValue(products);

      const idMap = new Map([['1:test-connection-id', 'internal-1']]);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.batchGetOrCreateInternalIds = jest.fn().mockResolvedValue(idMap);

      await adapter.getProducts({ status: 'active', limit: 50, offset: 100 });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(mockHttpClient.listResources).toHaveBeenCalledWith(
        'products',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
          custom: expect.objectContaining({
            active: 1,
          }),
        }),
        50,
        100
      );
    });

    it('should filter out products without internal ID mapping', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      const products: PrestashopProduct[] = [
        { ...samplePrestashopProduct, id: '1' },
        { ...samplePrestashopProduct, id: '2' },
      ];

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockHttpClient.listResources = jest.fn().mockResolvedValue(products);

      // Only map first product
      const idMap = new Map([['1:test-connection-id', 'internal-1']]);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.batchGetOrCreateInternalIds = jest.fn().mockResolvedValue(idMap);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      const result = await adapter.getProducts();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('internal-1');
    });

    it('should ask for the gross price on the same list read and report it per product (ADR-077)', async () => {
      const products: PrestashopProduct[] = [
        grossProductRow({ id: '1' }),
        grossProductRow({ id: '2', price: '10.000000', ol_gross: '12.300000' }),
      ];
      mockHttpClient.listResources = jest.fn().mockResolvedValue(products);
      mockIdentifierMapping.batchGetOrCreateInternalIds = jest.fn().mockResolvedValue(
        new Map([
          ['1:test-connection-id', 'internal-1'],
          ['2:test-connection-id', 'internal-2'],
        ])
      );
      const taxRateResolver = makeGrossTaxRateResolver();
      const adapterUnderTest = createGrossAdapter(makeSalesCountryResolver(), taxRateResolver);

      const result = await adapterUnderTest.getProducts();

      expect(mockHttpClient.listResources).toHaveBeenCalledTimes(1);
      expect(mockHttpClient.listResources).toHaveBeenCalledWith(
        'products',
        { sort: ['id_ASC'], priceFields: PRODUCT_GROSS_FIELDS },
        undefined,
        undefined
      );
      expect(mockHttpClient.getResource).not.toHaveBeenCalled();
      expect(result.map((p) => p.price)).toEqual([123, 12.3]);
      expect(taxRateResolver.resolveProductTaxRate).toHaveBeenCalledWith(
        '2',
        undefined,
        connection.id,
        mockHttpClient,
        products[1],
        { countryId: 14 }
      );
    });
  });

  describe('listExternalIds', () => {
    it('should return external ids as strings without creating mappings', async () => {
      mockHttpClient.listResources = jest
        .fn()
        .mockResolvedValue([{ id: 1 }, { id: '2' }, { id: 3 }]);

      const result = await adapter.listExternalIds({ limit: 100, offset: 0 });

      expect(result).toEqual(['1', '2', '3']);
      // Sorted, always: this is the read `runBoundedSweep` pages across ticks,
      // so an unsorted offset read can drop a live product for a whole cycle
      // (#2627 review).
      expect(mockHttpClient.listResources).toHaveBeenCalledWith(
        'products',
        { display: '[id]', sort: ['id_ASC'] },
        100,
        0
      );
      // listExternalIds must NOT touch identifier mapping; creating mappings is the
      // downstream master.product.syncByExternalId handler's responsibility.
      expect(mockIdentifierMapping.batchGetOrCreateInternalIds).not.toHaveBeenCalled();
    });

    it('should skip entries without an id', async () => {
      mockHttpClient.listResources = jest
        .fn()
        .mockResolvedValue([{ id: 7 }, { id: null }, { id: undefined }, { id: 9 }]);

      const result = await adapter.listExternalIds();

      expect(result).toEqual(['7', '9']);
    });

    it('should return empty array when the source is empty', async () => {
      mockHttpClient.listResources = jest.fn().mockResolvedValue([]);

      const result = await adapter.listExternalIds({ limit: 50, offset: 0 });

      expect(result).toEqual([]);
    });
  });

  describe('getProductVariants', () => {
    it('should fetch and map product variants', async () => {
      const productId = 'internal-product-123';
      const externalProductId = '42';

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([
        {
          connectionId: connection.id,
          externalId: externalProductId,
          entityType: 'Product',
        },
      ]);

      mockHttpClient.getResource = jest.fn().mockResolvedValue(samplePrestashopProduct);

      const combinations: PrestashopCombination[] = [
        {
          id: '101',
          id_product: '42',
          reference: 'VAR-001',
          price: '5.00',
          quantity: '10',
        },
        {
          id: '102',
          id_product: '42',
          reference: 'VAR-002',
          price: '10.00',
          quantity: '20',
        },
      ];

      mockHttpClient.listResources = jest.fn().mockResolvedValue(combinations);

      const idMap = new Map([
        ['101:test-connection-id', 'internal-variant-1'],
        ['102:test-connection-id', 'internal-variant-2'],
      ]);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.batchGetOrCreateInternalIds = jest.fn().mockResolvedValue(idMap);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      const result = await adapter.getProductVariants(productId);

      expect(mockHttpClient.getResource).toHaveBeenCalledWith('products', externalProductId);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(mockHttpClient.listResources).toHaveBeenCalledWith(
        'combinations',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
          custom: expect.objectContaining({
            id_product: externalProductId,
          }),
        }),
        100,
        0
      );

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('internal-variant-1');
      expect(result[1].id).toBe('internal-variant-2');
      expect(mockIdentifierMapping.deleteMapping).toHaveBeenCalledWith(
        'ProductVariant',
        `product:${externalProductId}`,
        connection.id
      );
      expect(mockIdentifierMapping.batchGetOrCreateInternalIds).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ entityType: 'ProductVariant', externalId: '101' }),
          expect.objectContaining({ entityType: 'ProductVariant', externalId: '102' }),
        ])
      );
    });

    it('should report every combination of a product whose combinations span several pages (#2608)', async () => {
      const productId = 'internal-product-123';
      const externalProductId = '42';
      const TOTAL = 250;

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.getExternalIds = jest
        .fn()
        .mockResolvedValue([
          { connectionId: connection.id, externalId: externalProductId, entityType: 'Product' },
        ]);
      mockHttpClient.getResource = jest.fn().mockResolvedValue(samplePrestashopProduct);

      const allCombinations: PrestashopCombination[] = Array.from({ length: TOTAL }, (_, i) => ({
        id: String(i + 1),
        id_product: externalProductId,
        reference: `VAR-${i + 1}`,
        price: '1.00',
        quantity: '1',
      }));
      mockHttpClient.listResources = jest.fn(
        (_resource: string, _filters: unknown, limit?: number, offset?: number) =>
          Promise.resolve(allCombinations.slice(offset ?? 0, (offset ?? 0) + (limit ?? 100)))
      ) as unknown as jest.Mocked<IPrestashopWebserviceClient>['listResources'];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.batchGetOrCreateInternalIds = jest
        .fn()
        .mockResolvedValue(
          new Map(allCombinations.map((c) => [`${c.id}:${connection.id}`, `internal-${c.id}`]))
        );

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      const result = await adapter.getProductVariants(productId);

      expect(result).toHaveLength(TOTAL);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(mockHttpClient.listResources).toHaveBeenCalledTimes(3);
    });

    it('should refuse rather than report a truncated combination list when the page budget runs out (#2608)', async () => {
      const productId = 'internal-product-123';
      const externalProductId = '42';

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.getExternalIds = jest
        .fn()
        .mockResolvedValue([
          { connectionId: connection.id, externalId: externalProductId, entityType: 'Product' },
        ]);
      mockHttpClient.getResource = jest.fn().mockResolvedValue(samplePrestashopProduct);
      const fullPage: PrestashopCombination[] = Array.from({ length: 100 }, (_, i) => ({
        id: String(i + 1),
        id_product: externalProductId,
        price: '1.00',
        quantity: '1',
      }));
      mockHttpClient.listResources = jest.fn().mockResolvedValue(fullPage);

      await expect(adapter.getProductVariants(productId)).rejects.toBeInstanceOf(
        PrestashopTruncatedReadException
      );
    });

    it("should report each combination's own gross price, checked against base + impact (impact 0 when unset) (#1096, ADR-077)", async () => {
      const productId = 'internal-product-123';
      // Base net is 19.99 (fixture). A combination's `price` is an IMPACT, so
      // the net PrestaShop's gross is checked against is 19.99 + impact. The
      // price reported is the combination's OWN gross field, which PrestaShop
      // computes as the full price - never the product's gross plus the impact.
      mockIdentifierMapping.getExternalIds = jest
        .fn()
        .mockResolvedValue([{ connectionId: connection.id, externalId: '42', entityType: 'Product' }]);
      mockHttpClient.getResource = jest
        .fn()
        .mockResolvedValue({ ...samplePrestashopProduct, ol_gross: '24.590000' });
      const combinations: PrestashopCombination[] = [
        {
          id: '101',
          id_product: '42',
          reference: 'IMP-5',
          price: '5.00',
          quantity: '10',
          ol_gross: '30.740000',
        },
        { id: '102', id_product: '42', reference: 'NO-IMP', quantity: '20', ol_gross: '24.590000' },
      ];
      mockHttpClient.listResources = jest.fn().mockResolvedValue(combinations);
      mockIdentifierMapping.batchGetOrCreateInternalIds = jest.fn().mockResolvedValue(
        new Map([
          ['101:test-connection-id', 'internal-variant-1'],
          ['102:test-connection-id', 'internal-variant-2'],
        ])
      );
      const adapterUnderTest = createGrossAdapter(
        makeSalesCountryResolver(),
        makeGrossTaxRateResolver()
      );

      const result = await adapterUnderTest.getProductVariants(productId);

      // 24.99 net at 23%; the product's gross plus the impact would be 29.59.
      expect(result[0].price).toBe(30.74);
      // 19.99 net at 23% (impact unset).
      expect(result[1].price).toBe(24.59);
      // The combinations read asks for the gross on every row, without pinning
      // a combination - each row prices itself.
      expect(mockHttpClient.listResources).toHaveBeenCalledWith(
        'combinations',
        { custom: { id_product: '42' }, priceFields: COMBINATION_GROSS_FIELDS, sort: ['id_ASC'] },
        100,
        0
      );
    });

    it("should leave a combination unpriced, never inheriting the product's gross or its own impact, when PrestaShop computed no gross for it", async () => {
      const productId = 'internal-product-123';
      mockIdentifierMapping.getExternalIds = jest
        .fn()
        .mockResolvedValue([{ connectionId: connection.id, externalId: '42', entityType: 'Product' }]);
      mockHttpClient.getResource = jest
        .fn()
        .mockResolvedValue({ ...samplePrestashopProduct, ol_gross: '24.590000' });
      const combinations: PrestashopCombination[] = [
        { id: '101', id_product: '42', reference: 'NO-GROSS', price: '5.00', quantity: '10' },
      ];
      mockHttpClient.listResources = jest.fn().mockResolvedValue(combinations);
      mockIdentifierMapping.batchGetOrCreateInternalIds = jest
        .fn()
        .mockResolvedValue(new Map([['101:test-connection-id', 'internal-variant-1']]));
      const adapterUnderTest = createGrossAdapter(
        makeSalesCountryResolver(),
        makeGrossTaxRateResolver()
      );

      const result = await adapterUnderTest.getProductVariants(productId);

      expect(result).toHaveLength(1);
      expect(result[0]).not.toHaveProperty('price');
    });

    it.each([
      ['exceeds the base', '-25.00'],
      ['equals the base', '-19.99'],
    ])(
      'should treat a combination as no-master-price when its negative impact %s (#1099 self-review)',
      async (_label, impact) => {
        const productId = 'internal-product-123';
        // Base 19.99; a negative impact as large as the base folds to a net of
        // zero or less - invalid, so the variant must surface no price at all
        // (the `no-master-price` blocker) rather than publishing one. The gross
        // gate is never consulted for it.
        mockIdentifierMapping.getExternalIds = jest
          .fn()
          .mockResolvedValue([{ connectionId: connection.id, externalId: '42', entityType: 'Product' }]);
        mockHttpClient.getResource = jest.fn().mockResolvedValue(samplePrestashopProduct);
        const combinations: PrestashopCombination[] = [
          {
            id: '101',
            id_product: '42',
            reference: 'NEG',
            price: impact,
            quantity: '10',
            ol_gross: '0.000000',
          },
        ];
        mockHttpClient.listResources = jest.fn().mockResolvedValue(combinations);
        mockIdentifierMapping.batchGetOrCreateInternalIds = jest
          .fn()
          .mockResolvedValue(new Map([['101:test-connection-id', 'internal-variant-1']]));
        const taxRateResolver = makeGrossTaxRateResolver();
        const adapterUnderTest = createGrossAdapter(makeSalesCountryResolver(), taxRateResolver);

        const result = await adapterUnderTest.getProductVariants(productId);

        expect(result).toHaveLength(1);
        expect(result[0].price).toBeUndefined();
        expect(taxRateResolver.resolveProductTaxRate).not.toHaveBeenCalled();
      }
    );

    it('does not fallback to product barcode when multiple combinations exist', async () => {
      const productId = 'internal-product-123';
      const externalProductId = '42';

      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([
        {
          connectionId: connection.id,
          externalId: externalProductId,
          entityType: 'Product',
        },
      ]);

      mockHttpClient.getResource = jest.fn().mockResolvedValue({
        ...samplePrestashopProduct,
        id: externalProductId,
        ean13: '5901234123457',
        upc: '012345678905',
      });

      const combinations: PrestashopCombination[] = [
        {
          id: '101',
          id_product: '42',
          reference: 'VAR-001',
        },
        {
          id: '102',
          id_product: '42',
          reference: 'VAR-002',
        },
      ];

      mockHttpClient.listResources = jest.fn().mockResolvedValue(combinations);

      const idMap = new Map([
        ['101:test-connection-id', 'internal-variant-1'],
        ['102:test-connection-id', 'internal-variant-2'],
      ]);
      mockIdentifierMapping.batchGetOrCreateInternalIds = jest.fn().mockResolvedValue(idMap);

      const result = await adapter.getProductVariants(productId);

      expect(result).toHaveLength(2);
      expect(result[0].ean).toBeNull();
      expect(result[0].gtin).toBeNull();
      expect(result[1].ean).toBeNull();
      expect(result[1].gtin).toBeNull();
    });

    it('should return synthetic variant when no combinations found', async () => {
      const productId = 'internal-product-123';
      const externalProductId = '42';

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([
        {
          connectionId: connection.id,
          externalId: externalProductId,
          entityType: 'Product',
        },
      ]);

      mockHttpClient.getResource = jest
        .fn()
        .mockResolvedValue({ ...samplePrestashopProduct, ol_gross: '24.590000' });
      mockHttpClient.listResources = jest.fn().mockResolvedValue([]);
      const adapterUnderTest = createGrossAdapter(
        makeSalesCountryResolver(),
        makeGrossTaxRateResolver()
      );

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      const result = await adapterUnderTest.getProductVariants(productId);

      expect(result).toHaveLength(1);
      expect(result[0].sku).toBe(samplePrestashopProduct.reference);
      // Synthetic variant inherits the parent product's GROSS price so simple
      // products carry a usable price for the bulk wizard (#792, ADR-077):
      // 19.99 net at 23%.
      expect(result[0].price).toBe(24.59);
      expect(mockHttpClient.getResource).toHaveBeenCalledWith('products', externalProductId, {
        priceFields: PRODUCT_GROSS_FIELDS,
      });
      expect(mockIdentifierMapping.getOrCreateInternalId).toHaveBeenCalledWith(
        'ProductVariant',
        `product:${externalProductId}`,
        connection.id,
        expect.objectContaining({
          metadata: expect.objectContaining({ synthetic: true }),
        })
      );
      // isVariant metadata shim is intentionally no longer written — entityType is authoritative.
      expect(mockIdentifierMapping.getOrCreateInternalId).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          metadata: expect.objectContaining({ isVariant: expect.anything() }),
        })
      );
    });

    it.each([
      ['undefined price', undefined],
      ['null price', null],
      ['non-numeric price', 'not-a-number'],
    ])(
      'should leave synthetic variant price undefined when parent product has %s',
      async (_label, priceValue) => {
        const productId = 'internal-product-456';
        const externalProductId = '43';

        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
        mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([
          {
            connectionId: connection.id,
            externalId: externalProductId,
            entityType: 'Product',
          },
        ]);

        // PrestaShop's gross is there, but with no net to check it against the
        // gate cannot vouch for the rate it carries (ADR-077).
        mockHttpClient.getResource = jest.fn().mockResolvedValue({
          ...samplePrestashopProduct,
          price: priceValue,
          ol_gross: '24.590000',
        });
        mockHttpClient.listResources = jest.fn().mockResolvedValue([]);
        const adapterUnderTest = createGrossAdapter(
          makeSalesCountryResolver(),
          makeGrossTaxRateResolver()
        );

        const result = await adapterUnderTest.getProductVariants(productId);

        expect(result).toHaveLength(1);
        // Surfaces as `no-master-price` blocker downstream in #792.
        expect(result[0].price).toBeUndefined();
        expect(result[0]).not.toHaveProperty('price');
      }
    );

    it('should throw PrestashopResourceNotFoundException when product not found', async () => {
      const productId = 'internal-product-123';

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([]);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- test mock: narrowing dynamic spy / fixture / response shape
      await expect(adapter.getProductVariants(productId)).rejects.toThrow(
        PrestashopResourceNotFoundException
      );
    });
  });

  describe('write operations (not supported)', () => {
    it('should throw PrestashopNotSupportedException for createProduct', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument -- test mock: explicit any narrows the dynamic spy / fixture shape
      await expect(adapter.createProduct({ name: 'New Product' } as any)).rejects.toThrow(
        PrestashopNotSupportedException
      );
    });

    it('should throw PrestashopNotSupportedException for updateProduct', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument -- test mock: explicit any narrows the dynamic spy / fixture shape
      await expect(adapter.updateProduct('product-id', { name: 'Updated' } as any)).rejects.toThrow(
        PrestashopNotSupportedException
      );
    });

    it('should throw PrestashopNotSupportedException for deleteProduct', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- test mock: narrowing dynamic spy / fixture / response shape
      await expect(adapter.deleteProduct('product-id')).rejects.toThrow(
        PrestashopNotSupportedException
      );
    });

    it('should throw PrestashopNotSupportedException for upsertProductVariant', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument -- test mock: explicit any narrows the dynamic spy / fixture shape
      await expect(adapter.upsertProductVariant('product-id', {} as any)).rejects.toThrow(
        PrestashopNotSupportedException
      );
    });

    it('should throw PrestashopNotSupportedException for assignCategories', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- test mock: narrowing dynamic spy / fixture / response shape
      await expect(adapter.assignCategories('product-id', ['cat-1'])).rejects.toThrow(
        PrestashopNotSupportedException
      );
    });
  });

  describe('getProductCategories (#1502)', () => {
    const internalId = 'internal-product-123';
    const externalId = '42';

    function mapExternalId(): void {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.getExternalIds = jest
        .fn()
        .mockResolvedValue([{ connectionId: connection.id, externalId, entityType: 'Product' }]);
    }

    it('returns the product category tree root→leaf with depth when a path resolver is wired', async () => {
      mapExternalId();
      const productWithCategory: PrestashopProduct = {
        ...samplePrestashopProduct,
        id_category_default: '12',
      };
      const categories: Record<string, { id: string; name: string; id_parent: string }> = {
        '5': { id: '5', name: 'Home & Garden', id_parent: '2' },
        '12': { id: '12', name: 'Mugs', id_parent: '5' },
      };
      mockHttpClient.getResource = jest.fn((resource: string, id: string | number) => {
        if (resource === 'categories') return Promise.resolve(categories[String(id)]);
        return Promise.resolve(productWithCategory);
      }) as unknown as jest.Mocked<IPrestashopWebserviceClient>['getResource'];

      const adapterWithResolver = new PrestashopProductMasterAdapter(
        mockHttpClient,
        mockIdentifierMapping,
        productMapper,
        connection,
        new PrestashopAttributeResolver(),
        new PrestashopFeatureResolver(),
        new PrestashopCategoryPathResolver()
      );

      const result = await adapterWithResolver.getProductCategories(internalId);

      expect(result).toEqual([
        { id: '5', name: 'Home & Garden', depth: 0 },
        { id: '12', name: 'Mugs', depth: 1 },
      ]);
    });

    it('returns an empty list when the product has no default category (tolerated)', async () => {
      mapExternalId();
      mockHttpClient.getResource = jest.fn().mockResolvedValue({
        ...samplePrestashopProduct,
        id_category_default: undefined,
      });

      const adapterWithResolver = new PrestashopProductMasterAdapter(
        mockHttpClient,
        mockIdentifierMapping,
        productMapper,
        connection,
        new PrestashopAttributeResolver(),
        new PrestashopFeatureResolver(),
        new PrestashopCategoryPathResolver()
      );

      const result = await adapterWithResolver.getProductCategories(internalId);

      expect(result).toEqual([]);
    });

    it('returns an empty list when no path resolver is wired (tolerated)', async () => {
      mapExternalId();
      mockHttpClient.getResource = jest
        .fn()
        .mockResolvedValue({ ...samplePrestashopProduct, id_category_default: '12' });

      const result = await adapter.getProductCategories(internalId);

      expect(result).toEqual([]);
    });

    it('throws PrestashopResourceNotFoundException when no external ID mapping exists', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([]);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- test mock: narrowing dynamic spy / fixture / response shape
      await expect(adapter.getProductCategories(internalId)).rejects.toThrow(
        PrestashopResourceNotFoundException
      );
    });
  });

  describe('searchProducts', () => {
    it('should delegate to getProducts with query filter', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      const products: PrestashopProduct[] = [{ ...samplePrestashopProduct, id: '1' }];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockHttpClient.listResources = jest.fn().mockResolvedValue(products);

      const idMap = new Map([['1:test-connection-id', 'internal-1']]);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.batchGetOrCreateInternalIds = jest.fn().mockResolvedValue(idMap);

      await adapter.searchProducts('test query', { status: 'active' });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(mockHttpClient.listResources).toHaveBeenCalledWith(
        'products',
        expect.any(Object),
        undefined,
        undefined
      );
    });
  });

  describe('getProductVariants — semantic attributes (#1050)', () => {
    const externalProductId = '42';
    const productId = 'internal-product-123';
    const combinations: PrestashopCombination[] = [
      {
        id: '101',
        id_product: '42',
        reference: 'VAR-RED',
        associations: { product_option_values: [{ id: '20' }] },
      },
    ];
    const options = [{ id: '1', name: 'Color' }];
    const optionValues = [{ id: '20', name: 'Red', id_attribute_group: '1' }];

    function seedIdentifierMapping(): void {
      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([
        { connectionId: connection.id, externalId: externalProductId, entityType: 'Product' },
      ]);
      mockIdentifierMapping.batchGetOrCreateInternalIds = jest
        .fn()
        .mockResolvedValue(new Map([['101:test-connection-id', 'internal-variant-1']]));
    }

    it('emits semantic { group: value } attributes when the resolver is wired', async () => {
      seedIdentifierMapping();
      mockHttpClient.getResource = jest.fn().mockResolvedValue(samplePrestashopProduct);
      mockHttpClient.listResources = jest.fn((resource: string) => {
        if (resource === 'combinations') return Promise.resolve(combinations);
        if (resource === 'product_options') return Promise.resolve(options);
        if (resource === 'product_option_values') return Promise.resolve(optionValues);
        return Promise.resolve([]);
      }) as unknown as typeof mockHttpClient.listResources;

      const adapterWithResolver = new PrestashopProductMasterAdapter(
        mockHttpClient,
        mockIdentifierMapping,
        productMapper,
        connection,
        new PrestashopAttributeResolver()
      );

      const result = await adapterWithResolver.getProductVariants(productId);

      expect(result).toHaveLength(1);
      expect(result[0].attributes).toEqual({ Color: 'Red' });
    });

    it('falls back to positional attributes when the option fetch fails', async () => {
      seedIdentifierMapping();
      mockHttpClient.getResource = jest.fn().mockResolvedValue(samplePrestashopProduct);
      mockHttpClient.listResources = jest.fn((resource: string) => {
        if (resource === 'combinations') return Promise.resolve(combinations);
        return Promise.reject(new Error('options endpoint down'));
      }) as unknown as typeof mockHttpClient.listResources;

      const adapterWithResolver = new PrestashopProductMasterAdapter(
        mockHttpClient,
        mockIdentifierMapping,
        productMapper,
        connection,
        new PrestashopAttributeResolver()
      );

      const result = await adapterWithResolver.getProductVariants(productId);

      expect(result).toHaveLength(1);
      expect(result[0].attributes).toEqual({ option_0: '20' });
    });
  });

  describe('readProductTaxRate (#2054, ADR-063 — #1985 review parity with WooCommerce)', () => {
    const internalId = 'internal-product-123';
    const externalId = '42';

    function makeTaxRateResolver(): jest.Mocked<
      Pick<PrestashopTaxRateResolver, 'resolveProductTaxRate'>
    > {
      return { resolveProductTaxRate: jest.fn() };
    }

    function seedMapping(): void {
      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([
        { connectionId: connection.id, externalId, entityType: 'Product' },
      ]);
    }

    it('readsTaxRatePerVariant reports false — PrestaShop taxes the product, never the combination', () => {
      expect(adapter.readsTaxRatePerVariant()).toBe(false);
    });

    it('should resolve the rate as a percent code when the resolver names one', async () => {
      seedMapping();
      mockHttpClient.getResource = jest.fn().mockResolvedValue(samplePrestashopProduct);
      const taxRateResolver = makeTaxRateResolver();
      taxRateResolver.resolveProductTaxRate.mockResolvedValue({ kind: 'resolved', rate: 0.23, matchedBy: 'catch-all' });
      const adapterWithResolver = new PrestashopProductMasterAdapter(
        mockHttpClient,
        mockIdentifierMapping,
        productMapper,
        connection,
        undefined,
        undefined,
        undefined,
        taxRateResolver as unknown as PrestashopTaxRateResolver
      );

      await expect(
        adapterWithResolver.readProductTaxRate({ productId: internalId })
      ).resolves.toEqual({ kind: 'resolved', code: '23', countryIso2: null });
      expect(taxRateResolver.resolveProductTaxRate).toHaveBeenCalledWith(
        externalId,
        undefined,
        connection.id,
        mockHttpClient,
        // The product this adapter already fetched, handed over so the resolver
        // does not re-read the same resource (#2592).
        samplePrestashopProduct
      );
    });

    it('should keep a genuinely untaxed product as a resolved zero, not unknown', async () => {
      seedMapping();
      const taxRateResolver = makeTaxRateResolver();
      taxRateResolver.resolveProductTaxRate.mockResolvedValue({ kind: 'resolved', rate: 0, matchedBy: 'no-tax-group' });
      const adapterWithResolver = new PrestashopProductMasterAdapter(
        mockHttpClient,
        mockIdentifierMapping,
        productMapper,
        connection,
        undefined,
        undefined,
        undefined,
        taxRateResolver as unknown as PrestashopTaxRateResolver
      );

      await expect(
        adapterWithResolver.readProductTaxRate({ productId: internalId })
      ).resolves.toEqual({ kind: 'resolved', code: '0', countryIso2: null });
    });

    it('should THROW a PrestashopApiException on a transport failure, instead of reporting unknown', async () => {
      seedMapping();
      const taxRateResolver = makeTaxRateResolver();
      taxRateResolver.resolveProductTaxRate.mockResolvedValue({
        kind: 'unknown',
        reason: 'transport',
        evidence: 'GET products/42 returned 503',
        statusCode: 503,
      });
      const adapterWithResolver = new PrestashopProductMasterAdapter(
        mockHttpClient,
        mockIdentifierMapping,
        productMapper,
        connection,
        undefined,
        undefined,
        undefined,
        taxRateResolver as unknown as PrestashopTaxRateResolver
      );

      await expect(
        adapterWithResolver.readProductTaxRate({ productId: internalId })
      ).rejects.toBeInstanceOf(PrestashopApiException);
    });

    it('should report ambiguous when several candidate rules and no unambiguous pick', async () => {
      seedMapping();
      const taxRateResolver = makeTaxRateResolver();
      taxRateResolver.resolveProductTaxRate.mockResolvedValue({
        kind: 'unknown',
        reason: 'ambiguous',
        evidence: 'tax rules group 2 carries several country rules with no catch-all',
      });
      const adapterWithResolver = new PrestashopProductMasterAdapter(
        mockHttpClient,
        mockIdentifierMapping,
        productMapper,
        connection,
        undefined,
        undefined,
        undefined,
        taxRateResolver as unknown as PrestashopTaxRateResolver
      );

      const result = await adapterWithResolver.readProductTaxRate({ productId: internalId });

      expect(result).toEqual(
        expect.objectContaining({ kind: 'unknown', reason: 'ambiguous' })
      );
    });

    it('should report not-configured when the shop tax record is incomplete', async () => {
      seedMapping();
      const taxRateResolver = makeTaxRateResolver();
      taxRateResolver.resolveProductTaxRate.mockResolvedValue({
        kind: 'unknown',
        reason: 'configuration',
        evidence: 'tax rule 7 in group 2 carries no rate',
      });
      const adapterWithResolver = new PrestashopProductMasterAdapter(
        mockHttpClient,
        mockIdentifierMapping,
        productMapper,
        connection,
        undefined,
        undefined,
        undefined,
        taxRateResolver as unknown as PrestashopTaxRateResolver
      );

      const result = await adapterWithResolver.readProductTaxRate({ productId: internalId });

      expect(result).toEqual(
        expect.objectContaining({ kind: 'unknown', reason: 'not-configured' })
      );
    });

    it('should report unreadable when no resolver was wired for this connection', async () => {
      seedMapping();

      await expect(adapter.readProductTaxRate({ productId: internalId })).resolves.toEqual(
        expect.objectContaining({ kind: 'unknown', reason: 'unreadable' })
      );
    });

    it('should throw MasterProductNotFoundError when no external ID mapping exists', async () => {
      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([]);
      const taxRateResolver = makeTaxRateResolver();
      const adapterWithResolver = new PrestashopProductMasterAdapter(
        mockHttpClient,
        mockIdentifierMapping,
        productMapper,
        connection,
        undefined,
        undefined,
        undefined,
        taxRateResolver as unknown as PrestashopTaxRateResolver
      );

      await expect(
        adapterWithResolver.readProductTaxRate({ productId: internalId })
      ).rejects.toBeInstanceOf(MasterProductNotFoundError);
      expect(taxRateResolver.resolveProductTaxRate).not.toHaveBeenCalled();
    });

    it('should report the sales country with the rate when a rule for exactly that country matched (ADR-077)', async () => {
      seedMapping();
      const row = grossProductRow();
      mockHttpClient.getResource = jest.fn().mockResolvedValue(row);
      const taxRateResolver = makeGrossTaxRateResolver({
        kind: 'resolved',
        rate: 0.23,
        matchedBy: 'country',
      });
      const adapterUnderTest = createGrossAdapter(makeSalesCountryResolver(), taxRateResolver);

      await expect(
        adapterUnderTest.readProductTaxRate({ productId: internalId })
      ).resolves.toEqual({ kind: 'resolved', code: '23', countryIso2: 'PL' });
      // Same country as the gross catalogue price, so one resolver answer serves both.
      expect(taxRateResolver.resolveProductTaxRate).toHaveBeenCalledWith(
        externalId,
        undefined,
        connection.id,
        mockHttpClient,
        row,
        { countryId: 14 }
      );
    });

    it.each<[PrestashopTaxRuleMatch, number, string]>([
      ['catch-all', 0.23, '23'],
      ['only-rule', 0.23, '23'],
      ['no-tax-group', 0, '0'],
    ])(
      'should report no country with the rate when a %s match, not a rule for the sales country, named it (ADR-077)',
      async (matchedBy, rate, code) => {
        seedMapping();
        mockHttpClient.getResource = jest.fn().mockResolvedValue(grossProductRow());
        const adapterUnderTest = createGrossAdapter(
          makeSalesCountryResolver(),
          makeGrossTaxRateResolver({ kind: 'resolved', rate, matchedBy })
        );

        // A channel keying tax on the country must never be told a rate belongs
        // to a country the shop has no rule for.
        await expect(
          adapterUnderTest.readProductTaxRate({ productId: internalId })
        ).resolves.toEqual({ kind: 'resolved', code, countryIso2: null });
      }
    );

    it('should ask the resolver without a country option when the connection has no sales country (ADR-063 § 7)', async () => {
      seedMapping();
      mockHttpClient.getResource = jest.fn().mockResolvedValue(samplePrestashopProduct);
      const taxRateResolver = makeGrossTaxRateResolver({
        kind: 'resolved',
        rate: 0.23,
        matchedBy: 'catch-all',
      });
      const adapterUnderTest = createGrossAdapter(makeSalesCountryResolver(null), taxRateResolver);

      await expect(
        adapterUnderTest.readProductTaxRate({ productId: internalId })
      ).resolves.toEqual({ kind: 'resolved', code: '23', countryIso2: null });
      // Five arguments, not six: the resolver falls through to the catch-all rule.
      expect(taxRateResolver.resolveProductTaxRate.mock.calls[0]).toHaveLength(5);
      expect(taxRateResolver.resolveProductTaxRate).toHaveBeenCalledWith(
        externalId,
        undefined,
        connection.id,
        mockHttpClient,
        samplePrestashopProduct
      );
    });
  });
  /**
   * The catalogue sweep read `GET /api/products/{id}` three times per SKU:
   * `getProduct`, `getProductVariants` and - through the tax resolver's own
   * code path - `readProductTaxRate`. A per-instance memo collapses them to one
   * (#2592). These assertions pin the COUNT, because a reduction nobody counts
   * silently comes back.
   */
  describe('product-read request count (#2592)', () => {
    const internalId = 'internal-product-123';
    const externalId = '42';

    function seedMapping(): void {
      mockIdentifierMapping.getExternalIds = jest
        .fn()
        .mockResolvedValue([{ connectionId: connection.id, externalId, entityType: 'Product' }]);
    }

    function productFetchCount(): number {
      return mockHttpClient.getResource.mock.calls.filter((call) => call[0] === 'products').length;
    }

    it('fetches the product once for getProduct + getProductVariants + readProductTaxRate', async () => {
      seedMapping();
      mockIdentifierMapping.getOrCreateInternalId = jest.fn().mockResolvedValue('internal-variant');
      mockHttpClient.getResource = jest.fn().mockResolvedValue(samplePrestashopProduct);
      mockHttpClient.listResources = jest.fn().mockResolvedValue([]);
      const taxRateResolver = {
        resolveProductTaxRate: jest
          .fn()
          .mockResolvedValue({ kind: 'resolved', rate: 0.23, matchedBy: 'catch-all' }),
      };
      const adapterUnderTest = new PrestashopProductMasterAdapter(
        mockHttpClient,
        mockIdentifierMapping,
        productMapper,
        connection,
        undefined,
        undefined,
        undefined,
        taxRateResolver as unknown as PrestashopTaxRateResolver
      );

      await adapterUnderTest.getProduct(internalId);
      await adapterUnderTest.getProductVariants(internalId);
      await adapterUnderTest.readProductTaxRate({ productId: internalId });

      expect(productFetchCount()).toBe(1);
      // The resolver is handed the memoised product instead of fetching its own.
      expect(taxRateResolver.resolveProductTaxRate).toHaveBeenCalledWith(
        externalId,
        undefined,
        connection.id,
        mockHttpClient,
        samplePrestashopProduct
      );
    });

    it('should fetch the product once, with the gross price riding on that same read, when a sales country is set (ADR-077)', async () => {
      seedMapping();
      mockIdentifierMapping.getOrCreateInternalId = jest.fn().mockResolvedValue('internal-variant');
      const row = grossProductRow();
      mockHttpClient.getResource = jest.fn().mockResolvedValue(row);
      mockHttpClient.listResources = jest.fn().mockResolvedValue([]);
      const salesCountryResolver = makeSalesCountryResolver();
      const taxRateResolver = makeGrossTaxRateResolver();
      const adapterUnderTest = createGrossAdapter(salesCountryResolver, taxRateResolver);

      const product = await adapterUnderTest.getProduct(internalId);
      const variants = await adapterUnderTest.getProductVariants(internalId);
      await adapterUnderTest.readProductTaxRate({ productId: internalId });

      expect(productFetchCount()).toBe(1);
      expect(mockHttpClient.getResource).toHaveBeenCalledWith('products', externalId, {
        priceFields: PRODUCT_GROSS_FIELDS,
      });
      // The sales country is resolved once per adapter instance.
      expect(salesCountryResolver.resolve).toHaveBeenCalledTimes(1);
      expect(product.price).toBe(123);
      expect(variants[0].price).toBe(123);
      expect(taxRateResolver.resolveProductTaxRate).toHaveBeenLastCalledWith(
        externalId,
        undefined,
        connection.id,
        mockHttpClient,
        row,
        { countryId: 14 }
      );
    });

    it('shares one in-flight request between concurrent callers', async () => {
      seedMapping();
      mockIdentifierMapping.getOrCreateInternalId = jest.fn().mockResolvedValue('internal-variant');
      mockHttpClient.listResources = jest.fn().mockResolvedValue([]);
      let release: (value: PrestashopProduct) => void = () => undefined;
      mockHttpClient.getResource = jest.fn().mockReturnValue(
        new Promise<PrestashopProduct>((resolve) => {
          release = resolve;
        })
      );

      const inFlight = Promise.all([
        adapter.getProduct(internalId),
        adapter.getProductVariants(internalId),
      ]);
      release(samplePrestashopProduct);
      await inFlight;

      expect(productFetchCount()).toBe(1);
    });

    it('re-reads a different product rather than serving the memoised one', async () => {
      mockIdentifierMapping.getExternalIds = jest
        .fn()
        .mockImplementation((_type: string, id: string) =>
          Promise.resolve([
            {
              connectionId: connection.id,
              externalId: id === internalId ? externalId : '43',
              entityType: 'Product',
            },
          ])
        );
      mockHttpClient.getResource = jest.fn().mockResolvedValue(samplePrestashopProduct);

      await adapter.getProduct(internalId);
      await adapter.getProduct('internal-product-other');

      expect(productFetchCount()).toBe(2);
    });

    it('evicts a failed read so the next caller retries instead of inheriting the error', async () => {
      seedMapping();
      mockHttpClient.getResource = jest
        .fn()
        .mockRejectedValueOnce(new PrestashopApiException('boom', 503))
        .mockResolvedValueOnce(samplePrestashopProduct);

      await expect(adapter.getProduct(internalId)).rejects.toBeInstanceOf(PrestashopApiException);
      await expect(adapter.getProduct(internalId)).resolves.toMatchObject({ id: internalId });

      expect(productFetchCount()).toBe(2);
    });

    it('caches nothing when the read throws synchronously, so the next caller retries', async () => {
      seedMapping();
      let firstCall = true;
      mockHttpClient.getResource = jest.fn().mockImplementation(() => {
        if (firstCall) {
          firstCall = false;
          // A throw before any promise exists, e.g. a client that rejects the
          // request shape. The read runs inside the memo's async wrapper (it
          // first resolves the sales country, ADR-077), so the throw surfaces as
          // a rejection and is evicted like one.
          throw new PrestashopApiException('boom', 400);
        }
        return Promise.resolve(samplePrestashopProduct);
      });

      await expect(adapter.getProduct(internalId)).rejects.toBeInstanceOf(PrestashopApiException);
      await expect(adapter.getProduct(internalId)).resolves.toMatchObject({ id: internalId });

      expect(productFetchCount()).toBe(2);
    });
  });
});
