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
import { isOfferCreator, type OfferManagerPort } from '@openlinker/core/listings';
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

/** Host stub for `createCapabilityAdapter` — the factory resolves credentials. */
function makeDispatchHost(): HostServices {
  return {
    identifierMapping: {},
    credentialsResolver: { get: jest.fn().mockResolvedValue({ apiKey: 'k-123' }) },
  } as unknown as HostServices;
}

/** Host stub exposing only the registries `register(host)` touches (#982/#984). */
function makeRegisterHost(): {
  host: HostServices;
  configRegistry: { register: jest.Mock };
  credentialsRegistry: { register: jest.Mock };
  testerRegistry: { register: jest.Mock };
  retryClassifierRegistry: { register: jest.Mock };
  authFailureClassifierRegistry: { register: jest.Mock };
} {
  const configRegistry = { register: jest.fn() };
  const credentialsRegistry = { register: jest.fn() };
  const testerRegistry = { register: jest.fn() };
  const retryClassifierRegistry = { register: jest.fn() };
  const authFailureClassifierRegistry = { register: jest.fn() };
  const hostStub = {
    connectionConfigShapeValidatorRegistry: configRegistry,
    connectionCredentialsShapeValidatorRegistry: credentialsRegistry,
    connectionTesterRegistry: testerRegistry,
    retryClassifierRegistry,
    authFailureClassifierRegistry,
  } as unknown as HostServices;
  return {
    host: hostStub,
    configRegistry,
    credentialsRegistry,
    testerRegistry,
    retryClassifierRegistry,
    authFailureClassifierRegistry,
  };
}

describe('erliAdapterManifest', () => {
  it('should declare the erli.shopapi.v1 adapter key', () => {
    expect(erliAdapterManifest.adapterKey).toBe('erli.shopapi.v1');
  });

  it('should declare the erli platform type', () => {
    expect(erliAdapterManifest.platformType).toBe('erli');
  });

  it('should declare OfferManager (the capability #984 delivers)', () => {
    // Each capability is declared in lockstep with its adapter; #993 adds
    // 'OrderSource'. Declaring a capability the factory cannot build would let
    // listCapabilityAdapters request an undeliverable adapter.
    expect(erliAdapterManifest.supportedCapabilities).toEqual(['OfferManager']);
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

    it('should register the retry + auth-failure classifiers at erli.shopapi.v1 (#984)', () => {
      const { host, retryClassifierRegistry, authFailureClassifierRegistry } = makeRegisterHost();
      createErliPlugin().register?.(host);

      expect(retryClassifierRegistry.register).toHaveBeenCalledWith(
        'erli.shopapi.v1',
        expect.objectContaining({ isNonRetryable: expect.any(Function) }),
      );
      expect(authFailureClassifierRegistry.register).toHaveBeenCalledWith(
        'erli.shopapi.v1',
        expect.objectContaining({ isCredentialRejected: expect.any(Function) }),
      );
    });
  });

  describe('createCapabilityAdapter', () => {
    it('should resolve OfferManager to an offer-creator adapter (#984)', async () => {
      const adapter = await createErliPlugin().createCapabilityAdapter<OfferManagerPort>(
        connection,
        'OfferManager',
        makeDispatchHost(),
      );

      expect(isOfferCreator(adapter)).toBe(true);
    });

    it.each(['OrderSource', 'ProductMaster'])(
      'should reject %s with the SDK unsupported-capability error',
      async (capability) => {
        await expect(
          createErliPlugin().createCapabilityAdapter(connection, capability, makeDispatchHost()),
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
