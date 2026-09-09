/**
 * Shipping-stub Plugin Descriptor Tests (#3043)
 *
 * Covers: the static manifest shape (`requiresCredentials: false`, matching
 * ADR-055's credential-less pattern), the static === runtime manifest
 * identity, capability dispatch, the connection-bound outbound transport the
 * descriptor threads into the adapter, and the config-shape guard for a
 * connection missing `config.apiBaseUrl`.
 *
 * @module libs/integrations/shipping-stub/src/__tests__
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { HostServices } from '@openlinker/plugin-sdk';
import {
  createShippingStubPlugin,
  shippingStubAdapterManifest,
  ShippingStubConfigException,
  ShippingStubShippingAdapter,
} from '../index';

function connectionWith(config: Record<string, unknown>): Connection {
  return {
    id: 'conn-shipping-stub-1',
    platformType: 'shipping-stub',
    name: 'Test shipping stub',
    status: 'active',
    config,
    credentialsRef: '',
    enabledCapabilities: ['ShippingProviderManager'],
    adapterKey: 'shipping-stub.fake.v1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeHost(): { host: HostServices; http: { forConnection: jest.Mock } } {
  const http = { forConnection: jest.fn().mockReturnValue(jest.fn()), evict: jest.fn() };
  const host = {
    http,
    logger: () => ({ log: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() }),
  } as unknown as HostServices;
  return { host, http };
}

describe('createShippingStubPlugin', () => {
  it('should declare requiresCredentials: false and the ShippingProviderManager capability only', () => {
    expect(shippingStubAdapterManifest.requiresCredentials).toBe(false);
    expect(shippingStubAdapterManifest.supportedCapabilities).toEqual(['ShippingProviderManager']);
    expect(createShippingStubPlugin().manifest).toBe(shippingStubAdapterManifest);
  });

  it('should resolve a ShippingStubShippingAdapter pointed at config.apiBaseUrl via host.http.forConnection', async () => {
    const { host, http } = makeHost();
    const connection = connectionWith({ apiBaseUrl: 'http://shipping-stub:19086' });
    const plugin = createShippingStubPlugin();

    const adapter = await plugin.createCapabilityAdapter<ShippingStubShippingAdapter>(
      connection,
      'ShippingProviderManager',
      host,
    );

    expect(adapter).toBeInstanceOf(ShippingStubShippingAdapter);
    expect(http.forConnection).toHaveBeenCalledWith(connection);
  });

  it('should throw ShippingStubConfigException when config.apiBaseUrl is absent', async () => {
    const { host } = makeHost();
    const connection = connectionWith({});
    const plugin = createShippingStubPlugin();

    await expect(
      plugin.createCapabilityAdapter(connection, 'ShippingProviderManager', host),
    ).rejects.toBeInstanceOf(ShippingStubConfigException);
  });

  it('should throw for an unrequested capability', async () => {
    const { host } = makeHost();
    const connection = connectionWith({ apiBaseUrl: 'http://shipping-stub:19086' });
    const plugin = createShippingStubPlugin();

    await expect(plugin.createCapabilityAdapter(connection, 'OfferManager', host)).rejects.toThrow();
  });
});
