import { CapabilityNotSupportedException } from '@openlinker/core/integrations';
import { BundleMasterSyncService } from './bundle-master-sync.service';
import { BundleMasterSyncRefusedError } from '../../domain/exceptions/bundle-definition.errors';

describe('BundleMasterSyncService', () => {
  const variantRows: Record<string, { id: string; productId: string }> = {
    ol_variant_pack: { id: 'ol_variant_pack', productId: 'ol_product_pack' },
    ol_variant_a: { id: 'ol_variant_a', productId: 'ol_product_a' },
  };

  function build(opts: {
    adapter: unknown;
    composition?: unknown;
    mappedVariants?: Record<string, string>;
    existing?: boolean;
  }) {
    const adapter = opts.adapter as Record<string, unknown>;
    if (opts.composition !== undefined) {
      adapter.readBundleComposition = jest.fn().mockResolvedValue(opts.composition);
    }
    const integrations = {
      getCapabilityAdapter: jest.fn().mockResolvedValue(adapter),
      getAdapter: jest.fn().mockResolvedValue({ connection: { name: 'Shop' } }),
    };
    const mapping = {
      getExternalIds: jest.fn((type: string) =>
        Promise.resolve(
          type === 'ProductVariant'
            ? [{ connectionId: 'c1', externalId: 'product:42' }]
            : [{ connectionId: 'c1', externalId: '42' }]
        )
      ),
      getInternalId: jest.fn((_t: string, ext: string) =>
        Promise.resolve(opts.mappedVariants?.[ext] ?? null)
      ),
    };
    const variants = {
      findByIdIn: jest.fn((ids: string[]) =>
        Promise.resolve(ids.map((i) => variantRows[i]).filter(Boolean))
      ),
    };
    const bundles = {
      get: jest.fn().mockResolvedValue(opts.existing ? { variantId: 'ol_variant_pack' } : null),
      create: jest.fn().mockResolvedValue({ version: 1 }),
      update: jest.fn().mockResolvedValue({ version: 2 }),
    };
    const service = new BundleMasterSyncService(
      integrations as never,
      mapping as never,
      variants as never,
      bundles as never
    );
    return { service, bundles, integrations };
  }

  const composition = {
    components: [{ externalProductId: '11', externalVariantId: '31', quantity: 2 }],
  };

  it('should treat a connection without ProductMaster as no master, but a failing master as unavailable (#3520)', async () => {
    const { service, integrations } = build({ adapter: {} });
    integrations.getCapabilityAdapter.mockRejectedValueOnce(
      new CapabilityNotSupportedException('allegro.publicapi.v1', 'ProductMaster')
    );
    await expect(service.previewComposition('ol_variant_pack')).rejects.toMatchObject({ reason: 'no-master' });

    integrations.getCapabilityAdapter.mockRejectedValueOnce(new Error('401 token expired'));
    await expect(service.previewComposition('ol_variant_pack')).rejects.toMatchObject({
      reason: 'master-unavailable',
    });
  });

  it('should refuse when the master cannot read bundles', async () => {
    const { service } = build({ adapter: {} });
    await expect(service.syncFromMaster('ol_variant_pack')).rejects.toMatchObject({
      reason: 'master-cannot-read-bundles',
    });
  });

  it('should refuse when the product is not a pack in the master', async () => {
    const { service } = build({ adapter: {}, composition: null });
    await expect(service.syncFromMaster('ol_variant_pack')).rejects.toMatchObject({
      reason: 'not-a-bundle-in-master',
    });
  });

  it('should name the unmapped component and write nothing', async () => {
    const { service, bundles } = build({ adapter: {}, composition });
    const error = await service.syncFromMaster('ol_variant_pack').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BundleMasterSyncRefusedError);
    expect((error as BundleMasterSyncRefusedError).unmappedComponents).toEqual(['11']);
    expect(bundles.create).not.toHaveBeenCalled();
    expect(bundles.update).not.toHaveBeenCalled();
  });

  it('should write a new version when the bundle already has a definition', async () => {
    const { service, bundles } = build({
      adapter: {},
      composition,
      mappedVariants: { '31': 'ol_variant_a' },
      existing: true,
    });
    await service.syncFromMaster('ol_variant_pack');
    expect(bundles.update).toHaveBeenCalledWith('ol_variant_pack', [
      { variantId: 'ol_variant_a', quantity: 2 },
    ]);
  });

  it('should create the first definition when none exists', async () => {
    const { service, bundles } = build({
      adapter: {},
      composition,
      mappedVariants: { '31': 'ol_variant_a' },
    });
    await service.syncFromMaster('ol_variant_pack');
    expect(bundles.create).toHaveBeenCalled();
  });

  it('should report the master only when its adapter is a BundleReader', async () => {
    const reader = build({ adapter: { readBundleComposition: jest.fn() } });
    await expect(reader.service.findBundleReadingMaster('ol_variant_pack')).resolves.toEqual({
      connectionId: 'c1',
      connectionName: 'Shop',
    });
    const plain = build({ adapter: {} });
    await expect(plain.service.findBundleReadingMaster('ol_variant_pack')).resolves.toBeNull();
  });
});
