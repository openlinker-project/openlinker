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

const CONN = 'conn-shop-1';
const MASTER = 'conn-master-1';
const VARIANT = 'ol_variant_aaaa';

describe('ProductPublishBuilderService', () => {
  let products: { getVariant: jest.Mock };
  let connectionPort: { get: jest.Mock };
  let integrations: { getCapabilityAdapter: jest.Mock };
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
    integrations = {
      getCapabilityAdapter: jest.fn((_id: string, capability: string) =>
        capability === 'ProductMaster' ? Promise.resolve(productMaster) : Promise.resolve(shopAdapter)
      ),
    };

    service = new ProductPublishBuilderService(
      products as never,
      connectionPort as never,
      integrations as never,
      projection as never
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
    expect(command.content).toEqual(
      expect.objectContaining({ title: 'Widget', description: 'A widget', imageUrls: ['http://img'] })
    );
    expect(command.status).toBe('published');
  });

  it('should publish uncategorised when the shop adapter is not a CategoryProvisioner', async () => {
    delete shopAdapter.provisionCategory; // not a provisioner

    const command = await service.buildPublishProductCommand(baseInput);

    expect(command.destinationCategoryIds).toEqual([]);
    // No category ⇒ no projection ⇒ no parameters.
    expect(projection.project).not.toHaveBeenCalled();
    expect(command.parameters).toBeUndefined();
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
      unresolvedRequired: [{ id: 'GTIN', name: 'GTIN', section: 'product' }],
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
});
