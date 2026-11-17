/**
 * Amazon Plugin Descriptor tests (#3741 foundation)
 *
 * Asserts the static manifest (empty capability set until the first adapter
 * lands), static === runtime manifest identity (#575), the registrations
 * `register(host)` makes, and the SDK's uniform refusal of every capability.
 *
 * @module libs/integrations/amazon/src/__tests__
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { HostServices } from '@openlinker/plugin-sdk';

import { AmazonIntegrationModule, amazonAdapterManifest, createAmazonPlugin } from '../index';

const connection = { id: 'conn-amz-1', platformType: 'amazon', config: {} } as unknown as Connection;

function registerHost(): { host: HostServices; registries: Record<string, jest.Mock> } {
  const registries = {
    tester: jest.fn(),
    config: jest.fn(),
    credentials: jest.fn(),
    retry: jest.fn(),
    auth: jest.fn(),
  };
  const host = {
    http: { forConnection: jest.fn(), evict: jest.fn() },
    connectionTesterRegistry: { register: registries.tester },
    connectionConfigShapeValidatorRegistry: { register: registries.config },
    connectionCredentialsShapeValidatorRegistry: { register: registries.credentials },
    retryClassifierRegistry: { register: registries.retry },
    authFailureClassifierRegistry: { register: registries.auth },
  } as unknown as HostServices;
  return { host, registries };
}

describe('Amazon plugin', () => {
  it('should declare the adapter identity and no capability yet', () => {
    expect(amazonAdapterManifest).toMatchObject({
      adapterKey: 'amazon.spapi.v1',
      platformType: 'amazon',
      supportedCapabilities: [],
      isDefault: true,
    });
    expect(createAmazonPlugin().manifest).toBe(amazonAdapterManifest);
  });

  it('should register tester, validators and classifiers under the adapter key', () => {
    const { host, registries } = registerHost();
    createAmazonPlugin().register?.(host);

    for (const register of Object.values(registries)) {
      expect(register).toHaveBeenCalledWith('amazon.spapi.v1', expect.anything());
    }
  });

  it('should refuse every capability with the SDK message', async () => {
    const { host } = registerHost();
    await expect(createAmazonPlugin().createCapabilityAdapter(connection, 'OrderSource', host)).rejects.toThrow(
      /Amazon adapter does not support capability: OrderSource/,
    );
  });

  it('should build a Nest module', () => {
    expect(AmazonIntegrationModule.module).toBeDefined();
  });
});
