import { BundleProductCreationService } from './bundle-product-creation.service';
import { BundleProductCreationRefusedError } from '../../domain/exceptions/bundle-definition.errors';

function build(adapter: unknown) {
  const integrations = {
    getCapabilityAdapter: jest.fn().mockResolvedValue(adapter),
    listCapabilityAdapters: jest.fn(),
  };
  const mapping = {
    getExternalIds: jest.fn().mockResolvedValue([{ connectionId: 'c1', externalId: '77' }]),
  };
  const sync = { syncFromMasterByExternalId: jest.fn().mockResolvedValue({}) };
  const products = {
    getVariantsBySkus: jest.fn().mockResolvedValue([]),
    getVariantsByProductId: jest.fn().mockResolvedValue([{ id: 'v1' }]),
    getVariant: jest.fn().mockResolvedValue({ productId: 'p9' }),
    getEffectiveTaxRate: jest.fn().mockResolvedValue({ code: '23' }),
  };
  const service = new BundleProductCreationService(
    integrations as never,
    mapping as never,
    sync as never,
    products as never
  );
  return { service, integrations, mapping, sync, products };
}

const input = { connectionId: 'c1', name: 'Set', sku: 'SET-1', price: 99 };

describe('BundleProductCreationService', () => {
  it('should create the product, sync it and return its variant when the master can create', async () => {
    const adapter = {
      productCreationMode: 'simple-product',
      createProduct: jest.fn().mockResolvedValue({ id: 'p1' }),
    };
    const { service, sync } = build(adapter);
    const result = await service.createBundleProduct({ ...input, rateSourceVariantId: 'vc' });
    expect(adapter.createProduct).toHaveBeenCalledWith(expect.objectContaining({ taxRate: '23' }));
    expect(sync.syncFromMasterByExternalId).toHaveBeenCalledWith('c1', '77');
    expect(result).toMatchObject({ productId: 'p1', variantId: 'v1', adopted: false });
  });

  it('should adopt the existing product when the SKU is already mapped on the connection', async () => {
    const adapter = { productCreationMode: 'simple-product', createProduct: jest.fn() };
    const { service, products } = build(adapter);
    products.getVariantsBySkus.mockResolvedValue([{ productId: 'p5' }]);
    const result = await service.createBundleProduct(input);
    expect(adapter.createProduct).not.toHaveBeenCalled();
    expect(result).toMatchObject({ productId: 'p5', adopted: true });
  });

  it('should refuse when the master cannot create products', async () => {
    const { service } = build({ createProduct: jest.fn() });
    await expect(service.createBundleProduct(input)).rejects.toMatchObject({
      reason: 'master-cannot-create-products',
    });
  });

  it('should report the master refusal as a named error', async () => {
    const adapter = {
      productCreationMode: 'simple-product',
      createProduct: jest.fn().mockRejectedValue(new Error('no tax group')),
    };
    const { service } = build(adapter);
    const error = await service.createBundleProduct(input).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BundleProductCreationRefusedError);
    expect((error as Error).message).toBe('no tax group');
  });

  it('should list each master with whether it can create', async () => {
    const { service, integrations } = build({});
    integrations.listCapabilityAdapters.mockResolvedValue([
      { connectionId: 'a', connection: { name: 'A', platformType: 'p' }, adapter: Promise.resolve({ productCreationMode: 'simple-product' }) },
      { connectionId: 'b', connection: { name: 'B', platformType: 'q' }, adapter: Promise.resolve({}) },
    ]);
    const targets = await service.listTargets();
    expect(targets.map((t) => t.creationMode)).toEqual(['simple-product', null]);
  });
});
