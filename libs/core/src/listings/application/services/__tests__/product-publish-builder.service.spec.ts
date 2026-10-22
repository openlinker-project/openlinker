/**
 * Product Publish Builder Service — unit spec
 *
 * Covers command assembly: variant-not-found gate, price fallback/gate,
 * category provisioning (provisioner present → provisioned id; absent →
 * uncategorised), attribute projection → `parameters`, and the required-param
 * publish gate.
 *
 * @module libs/core/src/listings/application/services/__tests__
 */

import { ProductPublishBuilderValidationException } from '../../../domain/exceptions/product-publish-builder-validation.exception';
import { MasterCatalogConnectionNotConfiguredException } from '../../../domain/exceptions/master-catalog-connection-not-configured.exception';
import { ProductPublishBuilderService } from '../product-publish-builder.service';
import { createFakeAvailabilityService } from './fake-availability-service';

const CONN = 'conn-shop-1';
const MASTER = 'conn-master-1';
const VARIANT = 'ol_variant_aaaa';

describe('ProductPublishBuilderService', () => {
  let products: {
    getVariant: jest.Mock;
    getVariantsByProductId: jest.Mock;
    getEffectiveTaxRate: jest.Mock;
  };
  let connectionPort: { get: jest.Mock };
  let integrations: { getCapabilityAdapter: jest.Mock };
  // #2323 — the seam owns the stock safety buffer. These fixtures configure
  // none, so the caller's quantity passes through exactly as it did pre-rewire.
  let availabilityService: ReturnType<typeof createFakeAvailabilityService>;
  let projection: { project: jest.Mock };
  let productMaster: { getProduct: jest.Mock; getProductCategories: jest.Mock };
  let shopAdapter: { publishProduct: jest.Mock; provisionCategory?: jest.Mock };
  let service: ProductPublishBuilderService;

  const baseInput = {
    internalVariantId: VARIANT,
    connectionId: CONN,
    stock: 3,
    status: 'published' as const,
  };

  beforeEach(() => {
    products = {
      getVariant: jest
        .fn()
        .mockResolvedValue({ id: VARIANT, productId: 'prod-1', attributes: { Brand: 'Acme' }, ean: null, gtin: null, sku: null }),
      // Single-element by default so existing (pre-#1836) suites keep exercising
      // the standalone / unchanged simple-product path.
      getVariantsByProductId: jest
        .fn()
        .mockResolvedValue([{ id: VARIANT, productId: 'prod-1', attributes: { Brand: 'Acme' } }]),
      // ADR-077: the catalogue rate travels on the command. No rate by default,
      // so the pre-#3737 suites keep building a rate-less command.
      getEffectiveTaxRate: jest
        .fn()
        .mockResolvedValue({ code: null, countryIso2: null, readAt: null }),
    };
    connectionPort = {
      get: jest.fn().mockResolvedValue({ config: { masterCatalogConnectionId: MASTER } }),
    };
    productMaster = {
      getProduct: jest
        .fn()
        .mockResolvedValue({ name: 'Widget', description: 'A widget', images: ['http://img'], price: 12.5, currency: 'PLN' }),
      getProductCategories: jest
        .fn()
        .mockResolvedValue([
          { id: 'src-root', name: 'Electronics', depth: 0 },
          { id: 'src-leaf', name: 'Phones', depth: 1 },
        ]),
    };
    shopAdapter = {
      publishProduct: jest.fn(),
      provisionCategory: jest.fn().mockResolvedValue({ destinationCategoryId: 'dest-leaf' }),
    };
    projection = {
      project: jest
        .fn()
        .mockResolvedValue({ parameters: [{ id: 'Brand', values: ['Acme'], section: 'product' }], unmappedSourceKeys: [], unresolvedRequired: [] }),
    };
    availabilityService = createFakeAvailabilityService(
      (id): Promise<{ config?: Record<string, unknown> | null }> =>
        connectionPort.get(id) as Promise<{ config?: Record<string, unknown> | null }>
    );
    integrations = {
      getCapabilityAdapter: jest.fn((_id: string, capability: string) =>
        capability === 'ProductMaster' ? Promise.resolve(productMaster) : Promise.resolve(shopAdapter)
      ),
    };

    service = new ProductPublishBuilderService(
      products as never,
      connectionPort as never,
      integrations as never,
      projection as never,
      availabilityService as never
    );
  });

  it('should build a command with provisioned category + projected parameters', async () => {
    const command = await service.buildPublishProductCommand(baseInput);

    // Provision walked root→leaf.
    expect(shopAdapter.provisionCategory).toHaveBeenCalledWith({
      connectionId: CONN,
      path: [
        { sourceCategoryId: 'src-root', name: 'Electronics' },
        { sourceCategoryId: 'src-leaf', name: 'Phones' },
      ],
    });
    expect(command.destinationCategoryIds).toEqual(['dest-leaf']);
    // Projection must resolve the destination under 'ProductPublisher' — a shop
    // connection never supports the marketplace 'OfferManager' capability.
    expect(projection.project).toHaveBeenCalledWith(
      expect.objectContaining({ destinationCapability: 'ProductPublisher' })
    );
    expect(command.parameters).toEqual([{ id: 'Brand', values: ['Acme'], section: 'product' }]);
    expect(command.price).toEqual({ amount: 12.5, currency: 'PLN' });
    // ADR-046: the builder shapes the description with the shop's declared
    // format. This mock adapter declares none, so the defensive fallback
    // applies and its block-opener rule wraps the plain-text master value.
    expect(command.content).toEqual(
      expect.objectContaining({
        title: 'Widget',
        description: '<p>A widget</p>',
        imageUrls: ['http://img'],
      })
    );
    expect(command.status).toBe('published');
    // Default mock variant has sku: null ⇒ the key is spread-omitted entirely
    // (not merely set to undefined).
    expect(command).not.toHaveProperty('sku');
  });

  it('should pass master stock through unchanged when the connection has no buffer (default 0) (#1844)', async () => {
    const command = await service.buildPublishProductCommand(baseInput);

    expect(command.stock).toBe(3);
  });

  it('should subtract the per-connection stock safety buffer, flooring at 0 (#1844)', async () => {
    connectionPort.get.mockResolvedValue({
      config: { masterCatalogConnectionId: MASTER, stockSafetyBuffer: 2 },
    });

    const buffered = await service.buildPublishProductCommand({ ...baseInput, stock: 10 });
    expect(buffered.stock).toBe(8);

    const floored = await service.buildPublishProductCommand({ ...baseInput, stock: 1 });
    expect(floored.stock).toBe(0);
  });

  it('should apply the connection pricing rule to the master price (#1843)', async () => {
    connectionPort.get.mockResolvedValue({
      config: { masterCatalogConnectionId: MASTER, pricingRule: { type: 'margin', percent: 20 } },
    });

    const command = await service.buildPublishProductCommand(baseInput);

    // margin 20% => price = 12.5 / 0.8 = 15.625 -> rounds to 15.63
    expect(command.price).toEqual({ amount: 15.63, currency: 'PLN' });
  });

  it('should not apply the pricing rule when an explicit input.price is supplied (#1843)', async () => {
    connectionPort.get.mockResolvedValue({
      config: { masterCatalogConnectionId: MASTER, pricingRule: { type: 'markup', percent: 100 } },
    });

    const command = await service.buildPublishProductCommand({
      ...baseInput,
      price: { amount: 9.99, currency: 'PLN' },
    });

    expect(command.price).toEqual({ amount: 9.99, currency: 'PLN' });
  });

  it('should thread the variant SKU into the command when the variant has one', async () => {
    products.getVariant.mockResolvedValue({
      id: VARIANT,
      productId: 'prod-1',
      attributes: { Brand: 'Acme' },
      ean: null,
      gtin: null,
      sku: 'SKU-123',
    });

    const command = await service.buildPublishProductCommand(baseInput);

    expect(command.sku).toBe('SKU-123');
  });

  it('should derive barcode (gtin then ean) and weight from the master variant', async () => {
    products.getVariant.mockResolvedValue({
      id: VARIANT,
      productId: 'prod-1',
      attributes: {},
      ean: '1111111111116',
      gtin: '5901234123457',
      sku: null,
      weight: 2.5,
    });

    const command = await service.buildPublishProductCommand(baseInput);

    expect(command.barcode).toBe('5901234123457'); // gtin wins over ean
    expect(command.weight).toBe(2.5);
  });

  it('should fall back to the ean and the product weight when the variant lacks them', async () => {
    products.getVariant.mockResolvedValue({
      id: VARIANT,
      productId: 'prod-1',
      attributes: {},
      ean: '1111111111116',
      gtin: null,
      sku: null,
    });
    productMaster.getProduct.mockResolvedValue({
      name: 'Widget',
      description: 'A widget',
      images: ['http://img'],
      price: 12.5,
      currency: 'PLN',
      weight: 3,
    });

    const command = await service.buildPublishProductCommand(baseInput);

    expect(command.barcode).toBe('1111111111116');
    expect(command.weight).toBe(3);
  });

  it('should omit barcode and weight when neither variant nor product provide them', async () => {
    const command = await service.buildPublishProductCommand(baseInput);

    expect(command).not.toHaveProperty('barcode');
    expect(command).not.toHaveProperty('weight');
  });

  it('should thread operator shortDescription and tags through content', async () => {
    const command = await service.buildPublishProductCommand({
      ...baseInput,
      content: { shortDescription: 'Short blurb', tags: ['sale', 'new'] },
    });

    expect(command.content).toEqual(
      expect.objectContaining({ shortDescription: 'Short blurb', tags: ['sale', 'new'] }),
    );
  });

  it('should omit shortDescription and tags from content when not supplied', async () => {
    const command = await service.buildPublishProductCommand(baseInput);

    expect(command.content).not.toHaveProperty('shortDescription');
    expect(command.content).not.toHaveProperty('tags');
  });

  it('should pass operator commerce fields through to the command', async () => {
    const commerce = {
      salePrice: { amount: 9.99, currency: 'PLN' },
      taxStatus: 'taxable' as const,
    };

    const command = await service.buildPublishProductCommand({ ...baseInput, commerce });

    expect(command.commerce).toEqual(commerce);
  });

  it('should use per-item destinationCategoryIds override instead of provisioning (#1831)', async () => {
    const command = await service.buildPublishProductCommand({
      ...baseInput,
      destinationCategoryIds: ['dest-override-1', 'dest-override-2'],
    });

    expect(shopAdapter.provisionCategory).not.toHaveBeenCalled();
    expect(command.destinationCategoryIds).toEqual(['dest-override-1', 'dest-override-2']);
    // Projection still runs, keyed on the override's first category.
    expect(projection.project).toHaveBeenCalledWith(
      expect.objectContaining({ destinationCategoryId: 'dest-override-1' })
    );
  });

  it('should use per-item parameters override instead of attribute projection (#1831)', async () => {
    const override = [{ id: 'Colour', values: ['Red'], section: 'product' as const }];

    const command = await service.buildPublishProductCommand({
      ...baseInput,
      parameters: override,
    });

    expect(projection.project).not.toHaveBeenCalled();
    expect(command.parameters).toEqual(override);
  });

  it('should treat an empty destinationCategoryIds override as explicit uncategorised (#1831)', async () => {
    const command = await service.buildPublishProductCommand({
      ...baseInput,
      destinationCategoryIds: [],
    });

    expect(shopAdapter.provisionCategory).not.toHaveBeenCalled();
    expect(command.destinationCategoryIds).toEqual([]);
    // No category ⇒ projection skipped (unless parameters overridden separately).
    expect(projection.project).not.toHaveBeenCalled();
  });

  it('should publish uncategorised when the shop adapter is not a CategoryProvisioner', async () => {
    delete shopAdapter.provisionCategory; // not a provisioner

    const command = await service.buildPublishProductCommand(baseInput);

    expect(command.destinationCategoryIds).toEqual([]);
    // No category ⇒ no projection ⇒ no parameters.
    expect(projection.project).not.toHaveBeenCalled();
    expect(command.parameters).toBeUndefined();
  });

  it('should publish uncategorised when the master cannot report categories', async () => {
    productMaster.getProductCategories.mockRejectedValue(
      new Error('Get product categories is not implemented in MVP.')
    );

    const command = await service.buildPublishProductCommand(baseInput);

    expect(command.destinationCategoryIds).toEqual([]);
    expect(shopAdapter.provisionCategory).not.toHaveBeenCalled();
  });

  it('should throw when the variant is not found', async () => {
    products.getVariant.mockResolvedValue(null);
    await expect(service.buildPublishProductCommand(baseInput)).rejects.toBeInstanceOf(
      ProductPublishBuilderValidationException
    );
  });

  it('should throw MasterCatalogConnectionNotConfigured when config lacks the master id', async () => {
    connectionPort.get.mockResolvedValue({ config: {} });
    await expect(service.buildPublishProductCommand(baseInput)).rejects.toBeInstanceOf(
      MasterCatalogConnectionNotConfiguredException
    );
  });

  it('should gate on unresolved required destination parameters', async () => {
    projection.project.mockResolvedValue({
      parameters: [],
      unmappedSourceKeys: [],
      unresolvedRequired: [{ id: 'GTIN', name: 'GTIN', section: 'product' }], restrictionIssues: [],
    });

    await expect(service.buildPublishProductCommand(baseInput)).rejects.toBeInstanceOf(
      ProductPublishBuilderValidationException
    );
  });

  it('should gate on an unresolvable price', async () => {
    productMaster.getProduct.mockResolvedValue({ name: 'X', description: null, images: null, price: null, currency: null });
    await expect(service.buildPublishProductCommand(baseInput)).rejects.toBeInstanceOf(
      ProductPublishBuilderValidationException
    );
  });

  describe('catalogue tax rate (ADR-077)', () => {
    const warnSpyOf = (): jest.SpyInstance =>
      jest.spyOn((service as unknown as { logger: { warn: (message: string) => void } }).logger, 'warn');

    it('should stamp taxRate and taxRateCountry when the catalogue holds a rate for the variant', async () => {
      products.getEffectiveTaxRate.mockResolvedValue({
        code: '23',
        countryIso2: 'PL',
        readAt: new Date('2026-10-01T00:00:00Z'),
      });

      const command = await service.buildPublishProductCommand(baseInput);

      // The variant's own product id, never the input's variant id twice.
      expect(products.getEffectiveTaxRate).toHaveBeenCalledWith('prod-1', VARIANT);
      expect(command.taxRate).toBe('23');
      expect(command.taxRateCountry).toBe('PL');
      // The price itself stays the gross catalogue price - the shop converts.
      expect(command.price).toEqual({ amount: 12.5, currency: 'PLN' });
    });

    it('should stamp taxRate without a country when the rate was resolved country-less', async () => {
      products.getEffectiveTaxRate.mockResolvedValue({
        code: '8',
        countryIso2: null,
        readAt: new Date('2026-10-01T00:00:00Z'),
      });

      const command = await service.buildPublishProductCommand(baseInput);

      expect(command.taxRate).toBe('8');
      expect(command).not.toHaveProperty('taxRateCountry');
    });

    it('should leave taxRate and taxRateCountry absent when the catalogue holds no rate', async () => {
      const command = await service.buildPublishProductCommand(baseInput);

      expect(command).not.toHaveProperty('taxRate');
      expect(command).not.toHaveProperty('taxRateCountry');
    });

    it('should build the command without a rate and warn when the rate read throws', async () => {
      products.getEffectiveTaxRate.mockRejectedValue(new Error('rate read failed'));
      const warnSpy = warnSpyOf();

      const command = await service.buildPublishProductCommand(baseInput);

      expect(command).not.toHaveProperty('taxRate');
      expect(command).not.toHaveProperty('taxRateCountry');
      expect(command.price).toEqual({ amount: 12.5, currency: 'PLN' });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Could not read the catalogue tax rate')
      );
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('rate read failed'));
    });
  });

  describe('variantGroup (#1836)', () => {
    it('should leave variantGroup absent for a single-variant / simple product', async () => {
      const command = await service.buildPublishProductCommand(baseInput);

      expect(command.variantGroup).toBeUndefined();
    });

    it('should stamp a variantGroup with the union of sibling attribute values for a multi-variant product', async () => {
      products.getVariantsByProductId.mockResolvedValue([
        { id: VARIANT, productId: 'prod-1', attributes: { Color: 'Red', Size: 'M' } },
        { id: 'ol_variant_bbbb', productId: 'prod-1', attributes: { Color: 'Blue', Size: 'M' } },
        { id: 'ol_variant_cccc', productId: 'prod-1', attributes: { Color: 'Red', Size: 'L' } },
      ]);
      products.getVariant.mockResolvedValue({
        id: VARIANT,
        productId: 'prod-1',
        attributes: { Color: 'Red', Size: 'M' },
        ean: null,
        gtin: null,
        sku: null,
      });

      const command = await service.buildPublishProductCommand(baseInput);

      expect(command.variantGroup).toEqual({
        groupId: 'prod-1',
        attributes: [
          { name: 'Color', value: 'Red' },
          { name: 'Size', value: 'M' },
        ],
        groupAttributeValues: {
          Color: ['Red', 'Blue'],
          Size: ['M', 'L'],
        },
      });
    });

    it('should not stamp externalParentProductId on the builder-produced variantGroup (resolved downstream by the execution service)', async () => {
      products.getVariantsByProductId.mockResolvedValue([
        { id: VARIANT, productId: 'prod-1', attributes: { Color: 'Red' } },
        { id: 'ol_variant_bbbb', productId: 'prod-1', attributes: { Color: 'Blue' } },
      ]);

      const command = await service.buildPublishProductCommand(baseInput);

      expect(command.variantGroup).not.toHaveProperty('externalParentProductId');
    });
  });
});
