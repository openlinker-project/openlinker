import type { Connection } from '@openlinker/core/identifier-mapping';
import type { HostServices } from '@openlinker/plugin-sdk';

import { createShoperPlugin, shoperAdapterManifest } from '../shoper-plugin';

function hostWithRegistries(): {
  host: HostServices;
  registries: Record<string, { register: jest.Mock }>;
} {
  const registries = {
    connectionTesterRegistry: { register: jest.fn() },
    connectionConfigShapeValidatorRegistry: { register: jest.fn() },
    connectionCredentialsShapeValidatorRegistry: { register: jest.fn() },
    authFailureClassifierRegistry: { register: jest.fn() },
  };
  return { host: { http: {}, ...registries } as unknown as HostServices, registries };
}

describe('Shoper plugin', () => {
  it('should expose the documented manifest with no capabilities yet', () => {
    expect(shoperAdapterManifest).toMatchObject({
      adapterKey: 'shoper.restapi.v1',
      platformType: 'shoper',
      supportedCapabilities: [],
      isDefault: true,
    });
    expect(shoperAdapterManifest.defaultRateLimit).toBeUndefined();
    expect(createShoperPlugin().manifest).toBe(shoperAdapterManifest);
  });

  it('should register the tester, both shape validators and the auth classifier under its adapter key', () => {
    const { host, registries } = hostWithRegistries();

    createShoperPlugin().register?.(host);

    for (const registry of Object.values(registries)) {
      expect(registry.register).toHaveBeenCalledTimes(1);
      expect(registry.register).toHaveBeenCalledWith('shoper.restapi.v1', expect.any(Object));
    }
  });

  it('should reject any capability request until a capability epic delivers one', async () => {
    const { host } = hostWithRegistries();

    await expect(
      createShoperPlugin().createCapabilityAdapter(
        { id: 'c' } as Connection,
        'ProductMaster',
        host,
      ),
    ).rejects.toThrow(/capability/);
  });
});
