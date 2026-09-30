/**
 * PrestaShop Shop-Units Resolver Spec
 *
 * @module libs/integrations/prestashop/src/infrastructure/provisioners
 */
import type { IPrestashopWebserviceClient } from '../http/prestashop-webservice.client.interface';
import { PrestashopShopUnitsResolver } from './prestashop-shop-units.resolver';

function makeClient(values: Record<string, string | undefined>): {
  client: IPrestashopWebserviceClient;
  listResources: jest.Mock;
} {
  const listResources = jest.fn(
    (_resource: string, filters: { custom?: { name?: string } }) =>
      Promise.resolve(
        values[filters.custom?.name ?? ''] !== undefined
          ? [{ id: '1', value: values[filters.custom?.name ?? ''] }]
          : []
      )
  );
  return {
    client: { listResources } as unknown as IPrestashopWebserviceClient,
    listResources,
  };
}

describe('PrestashopShopUnitsResolver', () => {
  it('should resolve both units from the configurations resource', async () => {
    const { client } = makeClient({ PS_WEIGHT_UNIT: 'kg', PS_DIMENSION_UNIT: 'cm' });

    const units = await new PrestashopShopUnitsResolver().resolveUnits('c1', client);

    expect(units).toEqual({ weightUnit: 'kg', dimensionUnit: 'cm' });
  });

  it('should not issue further requests for the same connection while cached', async () => {
    const { client, listResources } = makeClient({ PS_WEIGHT_UNIT: 'kg', PS_DIMENSION_UNIT: 'cm' });
    const resolver = new PrestashopShopUnitsResolver();

    await resolver.resolveUnits('c1', client);
    await resolver.resolveUnits('c1', client);
    await resolver.resolveUnits('c1', client);

    expect(listResources).toHaveBeenCalledTimes(2);
  });

  it('should return null and not throw when the read fails', async () => {
    const client = {
      listResources: jest.fn().mockRejectedValue(new Error('boom')),
    } as unknown as IPrestashopWebserviceClient;

    await expect(new PrestashopShopUnitsResolver().resolveUnits('c1', client)).resolves.toBeNull();
  });

  it('should return null when neither unit is configured', async () => {
    const { client } = makeClient({});

    await expect(new PrestashopShopUnitsResolver().resolveUnits('c1', client)).resolves.toBeNull();
  });

  it('should re-read after the cache is cleared', async () => {
    const { client, listResources } = makeClient({ PS_WEIGHT_UNIT: 'g', PS_DIMENSION_UNIT: 'mm' });
    const resolver = new PrestashopShopUnitsResolver();

    await resolver.resolveUnits('c1', client);
    resolver.clearCache('c1');
    await resolver.resolveUnits('c1', client);

    expect(listResources).toHaveBeenCalledTimes(4);
  });
});
