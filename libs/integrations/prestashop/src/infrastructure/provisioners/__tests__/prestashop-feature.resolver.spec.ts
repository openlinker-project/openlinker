/**
 * Unit tests for PrestashopFeatureResolver (#1096 F2)
 *
 * Verifies the feature lookups (id_feature → name, id_feature_value → value) are
 * built from `/product_features` + `/product_feature_values`, cached per
 * connection with a TTL, and keyed per connection.
 */
import { PrestashopFeatureResolver } from '../prestashop-feature.resolver';
import type { IPrestashopWebserviceClient } from '../../http/prestashop-webservice.client.interface';

describe('PrestashopFeatureResolver', () => {
  let resolver: PrestashopFeatureResolver;
  let client: jest.Mocked<IPrestashopWebserviceClient>;
  // Simplified localizeField: flat string or first {value} of a JSON-shape field.
  const localize = (field: unknown): string | undefined => {
    if (typeof field === 'string') return field.trim() || undefined;
    if (Array.isArray(field)) {
      const node = field[0] as { value?: unknown } | undefined;
      return node?.value !== undefined ? String(node.value) : undefined;
    }
    return undefined;
  };

  const FEATURES = [
    { id: '1', name: 'Material' },
    { id: '2', name: 'Origin' },
  ];
  const FEATURE_VALUES = [
    { id: '10', value: 'Ceramic', id_feature: '1' },
    { id: '20', value: 'PL', id_feature: '2' },
    // Value with no localizable label → omitted from the value map.
    { id: '30', value: '', id_feature: '2' },
  ];

  beforeEach(() => {
    resolver = new PrestashopFeatureResolver();
    client = {
      getResource: jest.fn(),
      listResources: jest.fn((resource: string) => {
        if (resource === 'product_features') return Promise.resolve([...FEATURES]);
        if (resource === 'product_feature_values') return Promise.resolve([...FEATURE_VALUES]);
        return Promise.resolve([]);
      }),
      createResource: jest.fn(),
      updateResource: jest.fn(),
      deleteResource: jest.fn(),
    } as unknown as jest.Mocked<IPrestashopWebserviceClient>;
  });

  it('should build the feature group + value lookups', async () => {
    const lookups = await resolver.getFeatureLookups('conn-1', client, localize);

    expect(lookups.nameById.get('1')).toBe('Material');
    expect(lookups.nameById.get('2')).toBe('Origin');
    expect(lookups.valueById.get('10')).toBe('Ceramic');
    expect(lookups.valueById.get('20')).toBe('PL');
  });

  it('should request only the fields it needs (display field-selection)', async () => {
    await resolver.getFeatureLookups('conn-1', client, localize);

    expect(client.listResources).toHaveBeenCalledWith('product_features', { display: '[id,name]' });
    expect(client.listResources).toHaveBeenCalledWith('product_feature_values', {
      display: '[id,value]',
    });
  });

  it('should omit feature values whose label cannot be localized', async () => {
    const lookups = await resolver.getFeatureLookups('conn-1', client, localize);

    expect(lookups.valueById.has('30')).toBe(false);
  });

  it('should cache per connection — a second call makes no WS request', async () => {
    await resolver.getFeatureLookups('conn-1', client, localize);
    await resolver.getFeatureLookups('conn-1', client, localize);

    expect(client.listResources).toHaveBeenCalledTimes(2);
  });

  it('should fetch independently for different connections', async () => {
    await resolver.getFeatureLookups('conn-1', client, localize);
    await resolver.getFeatureLookups('conn-2', client, localize);

    expect(client.listResources).toHaveBeenCalledTimes(4);
  });

  it('should refetch after the cache is cleared', async () => {
    await resolver.getFeatureLookups('conn-1', client, localize);
    resolver.clearCache('conn-1');
    await resolver.getFeatureLookups('conn-1', client, localize);

    expect(client.listResources).toHaveBeenCalledTimes(4);
  });
});
