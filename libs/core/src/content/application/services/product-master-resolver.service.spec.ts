/**
 * Product Master Resolver — Unit Tests
 *
 * The product's own master is the ProductMaster connection holding its
 * `Product` identifier mapping (#4068): with PrestaShop and Shoper both
 * connected, a Shoper product resolves to Shoper, never to the first master.
 * No claimant and two claimants refuse rather than guess.
 */
import type { IIdentifierMappingService } from '@openlinker/core/identifier-mapping';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { ProductMasterPort } from '@openlinker/core/products';
import { AmbiguousProductMasterException } from '../../domain/exceptions/ambiguous-product-master.exception';
import { NoProductMasterAdapterException } from '../../domain/exceptions/no-product-master-adapter.exception';
import { ProductMasterResolverService } from './product-master-resolver.service';

const prestashop = { name: 'prestashop-adapter' } as unknown as ProductMasterPort;
const shoper = { name: 'shoper-adapter' } as unknown as ProductMasterPort;

function buildResolver(args: {
  claimants: string[];
  masters: Array<{ connectionId: string; adapter: ProductMasterPort }>;
}): {
  resolver: ProductMasterResolverService;
  integrations: jest.Mocked<Pick<IIntegrationsService, 'listCapabilityAdapters' | 'getCapabilityAdapter'>>;
  identifierMapping: jest.Mocked<Pick<IIdentifierMappingService, 'getExternalIds'>>;
} {
  const integrations: jest.Mocked<Pick<IIntegrationsService, 'listCapabilityAdapters' | 'getCapabilityAdapter'>> = {
    // The lazy listing's `adapter` is deliberately unusable: the resolver must
    // build the chosen one through getCapabilityAdapter.
    listCapabilityAdapters: jest.fn().mockResolvedValue(
      args.masters.map((m) => ({ connectionId: m.connectionId, connection: {}, adapter: undefined, metadata: {} })),
    ),
    getCapabilityAdapter: jest.fn().mockImplementation((connectionId: string) =>
      Promise.resolve(args.masters.find((m) => m.connectionId === connectionId)?.adapter),
    ),
  };
  const identifierMapping: jest.Mocked<Pick<IIdentifierMappingService, 'getExternalIds'>> = {
    getExternalIds: jest.fn().mockResolvedValue(
      args.claimants.map((connectionId) => ({
        externalId: `ext-${connectionId}`,
        platformType: 'x',
        connectionId,
        entityType: 'Product',
      })),
    ),
  };
  const resolver = new ProductMasterResolverService(
    integrations as unknown as IIntegrationsService,
    identifierMapping as unknown as IIdentifierMappingService,
  );
  return { resolver, integrations, identifierMapping };
}

const BOTH_MASTERS = [
  { connectionId: 'conn-prestashop', adapter: prestashop },
  { connectionId: 'conn-shoper', adapter: shoper },
];

describe('ProductMasterResolverService', () => {
  it("should resolve the master that claims the product, not the first connected one", async () => {
    const { resolver, identifierMapping } = buildResolver({
      claimants: ['conn-shoper'],
      masters: BOTH_MASTERS,
    });

    await expect(resolver.resolve('ol_product_1', 'description')).resolves.toBe(shoper);
    expect(identifierMapping.getExternalIds).toHaveBeenCalledWith('Product', 'ol_product_1');
  });

  it('should list masters lazily and build only the chosen adapter', async () => {
    const { resolver, integrations } = buildResolver({
      claimants: ['conn-prestashop'],
      masters: BOTH_MASTERS,
    });

    await resolver.resolve('ol_product_1', 'description');

    expect(integrations.listCapabilityAdapters).toHaveBeenCalledWith({ capability: 'ProductMaster', lazy: true });
    expect(integrations.getCapabilityAdapter).toHaveBeenCalledTimes(1);
    expect(integrations.getCapabilityAdapter).toHaveBeenCalledWith('conn-prestashop', 'ProductMaster');
  });

  it('should build no adapter when it refuses', async () => {
    const { resolver, integrations } = buildResolver({
      claimants: ['conn-prestashop', 'conn-shoper'],
      masters: BOTH_MASTERS,
    });

    await resolver.resolve('ol_product_1', 'description').catch(() => undefined);

    expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
  });

  it('should ignore a claim held by a connection that is not a ProductMaster', async () => {
    // e.g. a marketplace connection that also maps the product
    const { resolver } = buildResolver({
      claimants: ['conn-allegro', 'conn-prestashop'],
      masters: BOTH_MASTERS,
    });

    await expect(resolver.resolve('ol_product_1', 'description')).resolves.toBe(prestashop);
  });

  it('should refuse when no ProductMaster claims the product', async () => {
    const { resolver } = buildResolver({ claimants: ['conn-allegro'], masters: BOTH_MASTERS });

    await expect(resolver.resolve('ol_product_1', 'description')).rejects.toBeInstanceOf(
      NoProductMasterAdapterException,
    );
  });

  it('should refuse when no ProductMaster connection exists at all', async () => {
    const { resolver } = buildResolver({ claimants: ['conn-shoper'], masters: [] });

    await expect(resolver.resolve('ol_product_1', 'description')).rejects.toBeInstanceOf(
      NoProductMasterAdapterException,
    );
  });

  it('should refuse, naming both, when two ProductMasters claim the product', async () => {
    const { resolver } = buildResolver({
      claimants: ['conn-prestashop', 'conn-shoper'],
      masters: BOTH_MASTERS,
    });

    const error = await resolver.resolve('ol_product_1', 'description').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AmbiguousProductMasterException);
    expect((error as AmbiguousProductMasterException).connectionIds).toEqual(['conn-prestashop', 'conn-shoper']);
  });

  it('should resolve when the claimant holds more than one mapping row', async () => {
    const { resolver } = buildResolver({
      claimants: ['conn-shoper', 'conn-shoper'],
      masters: BOTH_MASTERS,
    });

    await expect(resolver.resolve('ol_product_1', 'description')).resolves.toBe(shoper);
  });
});
