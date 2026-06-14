/**
 * Erli Plugin Descriptor Tests (#980)
 *
 * Asserts the static manifest shape (including the empty capability set the
 * skeleton ships), the static === runtime manifest identity (no-drift
 * invariant, #575), the SDK's uniform unsupported-capability rejection from
 * `createCapabilityAdapter` until the real adapters land (#984 / #993), and
 * that `ErliIntegrationModule` constructs via `createNestAdapterModule`.
 *
 * @module libs/integrations/erli/src/__tests__
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { HostServices } from '@openlinker/plugin-sdk';
import { createErliPlugin, erliAdapterManifest, ErliIntegrationModule } from '../index';

const connection: Connection = {
  id: 'conn-erli-1',
  platformType: 'erli',
  name: 'Test Erli',
  status: 'active',
  config: {},
  credentialsRef: 'ref-1',
  enabledCapabilities: [],
  adapterKey: 'erli.shopapi.v1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

// The capability factory never reads the host bag; register(host) does.
const host = {} as HostServices;

/** Host stub exposing only the registries `register(host)` touches (#982). */
function makeRegisterHost(): {
  host: HostServices;
  configRegistry: { register: jest.Mock };
  credentialsRegistry: { register: jest.Mock };
  testerRegistry: { register: jest.Mock };
} {
  const configRegistry = { register: jest.fn() };
  const credentialsRegistry = { register: jest.fn() };
  const testerRegistry = { register: jest.fn() };
  const hostStub = {
    connectionConfigShapeValidatorRegistry: configRegistry,
    connectionCredentialsShapeValidatorRegistry: credentialsRegistry,
    connectionTesterRegistry: testerRegistry,
  } as unknown as HostServices;
  return { host: hostStub, configRegistry, credentialsRegistry, testerRegistry };
}

describe('erliAdapterManifest', () => {
  it('should declare the erli.shopapi.v1 adapter key', () => {
    expect(erliAdapterManifest.adapterKey).toBe('erli.shopapi.v1');
  });

  it('should declare the erli platform type', () => {
    expect(erliAdapterManifest.platformType).toBe('erli');
  });

  it('should declare no capabilities while the skeleton ships no adapters', () => {
    // #993 adds 'OrderSource' and #984 adds 'OfferManager' alongside their
    // adapters — declaring them earlier would let listCapabilityAdapters
    // request an adapter the factory cannot deliver.
    expect(erliAdapterManifest.supportedCapabilities).toEqual([]);
  });

  it('should be the platform-default adapter', () => {
    expect(erliAdapterManifest.isDefault).toBe(true);
  });

  it('should carry a display name and version', () => {
    expect(erliAdapterManifest.displayName).toBe('Erli Shop API v1');
    expect(erliAdapterManifest.version).toBe('1.0.0');
  });
});

describe('createErliPlugin', () => {
  it('should return the same manifest reference as the static export (no drift)', () => {
    expect(createErliPlugin().manifest).toBe(erliAdapterManifest);
  });

  describe('register', () => {
    it('should register the config-shape validator at erli.shopapi.v1 (#982)', () => {
      const { host, configRegistry } = makeRegisterHost();
      createErliPlugin().register?.(host);

      expect(configRegistry.register).toHaveBeenCalledWith(
        'erli.shopapi.v1',
        expect.objectContaining({ validate: expect.any(Function) }),
      );
    });

    it('should register the credentials-shape validator at erli.shopapi.v1 (#982)', () => {
      const { host, credentialsRegistry } = makeRegisterHost();
      createErliPlugin().register?.(host);

      expect(credentialsRegistry.register).toHaveBeenCalledWith(
        'erli.shopapi.v1',
        expect.objectContaining({ validate: expect.any(Function) }),
      );
    });

    it('should register the connection tester at erli.shopapi.v1 (#982)', () => {
      const { host, testerRegistry } = makeRegisterHost();
      createErliPlugin().register?.(host);

      expect(testerRegistry.register).toHaveBeenCalledWith(
        'erli.shopapi.v1',
        expect.objectContaining({ test: expect.any(Function) }),
      );
    });
  });

  describe('createCapabilityAdapter', () => {
    it.each(['OrderSource', 'OfferManager', 'ProductMaster'])(
      'should reject %s with the SDK unsupported-capability error while no adapters ship',
      async (capability) => {
        const plugin = createErliPlugin();

        await expect(
          plugin.createCapabilityAdapter(connection, capability, host),
        ).rejects.toThrow(`Erli adapter does not support capability: ${capability}`);
      },
    );
  });
});

describe('ErliIntegrationModule', () => {
  it('should construct a DynamicModule via createNestAdapterModule when the package is loaded', () => {
    expect(ErliIntegrationModule.module).toBeDefined();
    expect(ErliIntegrationModule.imports?.length).toBeGreaterThan(0);
  });
});
