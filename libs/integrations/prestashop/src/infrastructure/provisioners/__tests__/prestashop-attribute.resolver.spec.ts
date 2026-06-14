/**
 * Unit tests for PrestashopAttributeResolver (#1050)
 *
 * Verifies the option-value id → semantic-name map is built from
 * `/product_options` + `/product_option_values`, cached per connection with a
 * TTL, and keyed per connection.
 */
import { PrestashopAttributeResolver } from '../prestashop-attribute.resolver';
import type { IPrestashopWebserviceClient } from '../../http/prestashop-webservice.client.interface';

describe('PrestashopAttributeResolver', () => {
  let resolver: PrestashopAttributeResolver;
  let client: jest.Mocked<IPrestashopWebserviceClient>;
  // The product mapper's localizeField, simplified for the test: reads a flat
  // string or the first {value} of a JSON-shape localized field.
  const localize = (field: unknown): string | undefined => {
    if (typeof field === 'string') return field.trim() || undefined;
    if (Array.isArray(field)) {
      const node = field[0] as { value?: unknown } | undefined;
      return node?.value !== undefined ? String(node.value) : undefined;
    }
    return undefined;
  };

  const OPTIONS = [
    { id: '1', name: 'Color' },
    { id: '2', name: 'Size' },
  ];
  const OPTION_VALUES = [
    { id: '20', name: 'Red', id_attribute_group: '1' },
    { id: '30', name: 'M', id_attribute_group: '2' },
    // Value whose group is unknown → omitted from the map.
    { id: '40', name: 'Orphan', id_attribute_group: '99' },
  ];

  beforeEach(() => {
    resolver = new PrestashopAttributeResolver();
    client = {
      getResource: jest.fn(),
      listResources: jest.fn((resource: string) => {
        if (resource === 'product_options') return Promise.resolve([...OPTIONS]);
        if (resource === 'product_option_values') return Promise.resolve([...OPTION_VALUES]);
        return Promise.resolve([]);
      }),
      createResource: jest.fn(),
      updateResource: jest.fn(),
      deleteResource: jest.fn(),
    } as unknown as jest.Mocked<IPrestashopWebserviceClient>;
  });

  it('should build the option-value id → semantic-name map', async () => {
    const map = await resolver.getOptionValueMap('conn-1', client, localize);

    expect(map.get('20')).toEqual({ groupName: 'Color', valueName: 'Red' });
    expect(map.get('30')).toEqual({ groupName: 'Size', valueName: 'M' });
  });

  it('should omit option values whose attribute group cannot be resolved', async () => {
    const map = await resolver.getOptionValueMap('conn-1', client, localize);

    expect(map.has('40')).toBe(false);
  });

  it('should cache per connection — a second call makes no WS request', async () => {
    await resolver.getOptionValueMap('conn-1', client, localize);
    await resolver.getOptionValueMap('conn-1', client, localize);

    // Two list calls on the first build (options + values), none on the cache hit.
    expect(client.listResources).toHaveBeenCalledTimes(2);
  });

  it('should fetch independently for different connections', async () => {
    await resolver.getOptionValueMap('conn-1', client, localize);
    await resolver.getOptionValueMap('conn-2', client, localize);

    expect(client.listResources).toHaveBeenCalledTimes(4);
  });

  it('should refetch after the cache is cleared', async () => {
    await resolver.getOptionValueMap('conn-1', client, localize);
    resolver.clearCache('conn-1');
    await resolver.getOptionValueMap('conn-1', client, localize);

    expect(client.listResources).toHaveBeenCalledTimes(4);
  });
});
