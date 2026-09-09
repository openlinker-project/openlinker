/**
 * Invoicing-stub Plugin Descriptor Tests (#3006)
 *
 * Covers: the static manifest shape (`requiresCredentials: false`, matching
 * ADR-055's credential-less pattern), the static === runtime manifest
 * identity, capability dispatch, the connection-bound outbound transport the
 * descriptor threads into the adapter, and the config-shape guard for a
 * connection missing `config.apiBaseUrl`.
 *
 * @module libs/integrations/invoicing-stub/src/__tests__
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { HostServices } from '@openlinker/plugin-sdk';
import {
  createInvoicingStubPlugin,
  invoicingStubAdapterManifest,
  InvoicingStubConfigException,
  InvoicingStubInvoicingAdapter,
} from '../index';

function connectionWith(config: Record<string, unknown>): Connection {
  return {
    id: 'conn-invoicing-stub-1',
    platformType: 'invoicing-stub',
    name: 'Test invoicing stub',
    status: 'active',
    config,
    credentialsRef: '',
    enabledCapabilities: ['Invoicing'],
    adapterKey: 'invoicing-stub.fake.v1',
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

describe('createInvoicingStubPlugin', () => {
  it('should declare requiresCredentials: false and the Invoicing capability only', () => {
    expect(invoicingStubAdapterManifest.requiresCredentials).toBe(false);
    expect(invoicingStubAdapterManifest.supportedCapabilities).toEqual(['Invoicing']);
    expect(createInvoicingStubPlugin().manifest).toBe(invoicingStubAdapterManifest);
  });

  it('should resolve an InvoicingStubInvoicingAdapter pointed at config.apiBaseUrl via host.http.forConnection', async () => {
    const { host, http } = makeHost();
    const connection = connectionWith({ apiBaseUrl: 'http://invoicing-stub:19082' });
    const plugin = createInvoicingStubPlugin();

    const adapter = await plugin.createCapabilityAdapter<InvoicingStubInvoicingAdapter>(
      connection,
      'Invoicing',
      host,
    );

    expect(adapter).toBeInstanceOf(InvoicingStubInvoicingAdapter);
    expect(http.forConnection).toHaveBeenCalledWith(connection);
  });

  it('should throw InvoicingStubConfigException when config.apiBaseUrl is absent', async () => {
    const { host } = makeHost();
    const connection = connectionWith({});
    const plugin = createInvoicingStubPlugin();

    await expect(
      plugin.createCapabilityAdapter(connection, 'Invoicing', host),
    ).rejects.toBeInstanceOf(InvoicingStubConfigException);
  });

  it('should throw for an unrequested capability', async () => {
    const { host } = makeHost();
    const connection = connectionWith({ apiBaseUrl: 'http://invoicing-stub:19082' });
    const plugin = createInvoicingStubPlugin();

    await expect(plugin.createCapabilityAdapter(connection, 'OfferManager', host)).rejects.toThrow();
  });
});
