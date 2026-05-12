/**
 * createNestAdapterModule — Unit Tests
 *
 * Boots a stub `AdapterPlugin` via `Test.createTestingModule`, mocks all
 * host services with `Map`-backed fakes, and asserts the helper:
 *   - calls `adapterRegistry.register(plugin.manifest)` once
 *   - calls `factoryResolver.registerFactory(adapterKey, factoryAdapter)` once
 *   - calls `plugin.register(host)` once with the same bag
 *   - the registered `factoryAdapter` translates positional
 *     `(connection, capability, identifierMapping, credentialsResolver)`
 *     into the bag-style `host: HostServices` shape, with per-call overrides
 *     honoured.
 *
 * @module libs/plugin-sdk/src
 */
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { AdapterMetadata } from '@openlinker/core/integrations';
import {
  ADAPTER_REGISTRY_TOKEN,
  ADAPTER_FACTORY_RESOLVER_TOKEN,
  CONNECTION_TESTER_REGISTRY_TOKEN,
  EMAIL_NORMALIZER_REGISTRY_TOKEN,
  WEBHOOK_PROVISIONING_REGISTRY_TOKEN,
  CREDENTIALS_RESOLVER_TOKEN,
} from '@openlinker/core/integrations';
import {
  RETRY_CLASSIFIER_REGISTRY_TOKEN,
  SCHEDULER_TASK_REGISTRY_TOKEN,
} from '@openlinker/core/sync';
import { IDENTIFIER_MAPPING_PORT_TOKEN } from '@openlinker/core/identifier-mapping';
import { CACHE_PORT_TOKEN } from '@openlinker/shared';
import { createNestAdapterModule } from './create-nest-adapter-module';
import type { AdapterPlugin } from './adapter-plugin';
import type { HostServices } from './host-services';
import type { AdapterFactoryPort } from '@openlinker/core/integrations';

describe('createNestAdapterModule', () => {
  const stubManifest: AdapterMetadata = {
    adapterKey: 'stub.test.v1',
    platformType: 'stub',
    supportedCapabilities: ['StubCapability'],
    displayName: 'Stub Test Adapter',
    version: '1.0.0',
    isDefault: true,
  };

  function makeStubRegistries(): {
    adapterRegistry: { register: jest.Mock<void, [unknown]> };
    factoryResolver: {
      registerFactory: jest.Mock<void, [string, AdapterFactoryPort]>;
    };
    connectionTesterRegistry: object;
    emailNormalizerRegistry: object;
    webhookProvisioningRegistry: object;
    retryClassifierRegistry: object;
    schedulerTaskRegistry: object;
  } {
    return {
      adapterRegistry: { register: jest.fn<void, [unknown]>() },
      factoryResolver: {
        registerFactory: jest.fn<void, [string, AdapterFactoryPort]>(),
      },
      connectionTesterRegistry: {},
      emailNormalizerRegistry: {},
      webhookProvisioningRegistry: {},
      retryClassifierRegistry: {},
      schedulerTaskRegistry: {},
    };
  }

  const stubIdentifierMapping = { identifierMappingStub: true };
  const stubCredentialsResolver = { credentialsResolverStub: true };
  const stubCache = { cacheStub: true };

  async function bootPluginModule(plugin: AdapterPlugin, registries = makeStubRegistries()): Promise<{
    registries: ReturnType<typeof makeStubRegistries>;
  }> {
    const moduleDef = createNestAdapterModule({ plugin });
    // Bypass the helper's IntegrationsModule/SyncModule imports — supply
    // every token directly so the test doesn't need to boot the whole
    // core graph. `overrideModule` doesn't exist; we mount only the
    // generated class with a manual provider table.
    const mod = await Test.createTestingModule({
      providers: [
        { provide: ADAPTER_REGISTRY_TOKEN, useValue: registries.adapterRegistry },
        { provide: ADAPTER_FACTORY_RESOLVER_TOKEN, useValue: registries.factoryResolver },
        { provide: CONNECTION_TESTER_REGISTRY_TOKEN, useValue: registries.connectionTesterRegistry },
        { provide: EMAIL_NORMALIZER_REGISTRY_TOKEN, useValue: registries.emailNormalizerRegistry },
        { provide: WEBHOOK_PROVISIONING_REGISTRY_TOKEN, useValue: registries.webhookProvisioningRegistry },
        { provide: RETRY_CLASSIFIER_REGISTRY_TOKEN, useValue: registries.retryClassifierRegistry },
        { provide: SCHEDULER_TASK_REGISTRY_TOKEN, useValue: registries.schedulerTaskRegistry },
        { provide: IDENTIFIER_MAPPING_PORT_TOKEN, useValue: stubIdentifierMapping },
        { provide: CREDENTIALS_RESOLVER_TOKEN, useValue: stubCredentialsResolver },
        { provide: CACHE_PORT_TOKEN, useValue: stubCache },
        // The generated module class is at moduleDef.module.
        moduleDef.module,
      ],
    }).compile();
    await mod.init();
    return { registries };
  }

  it('registers the manifest with adapterRegistry on boot', async () => {
    const plugin: AdapterPlugin = {
      manifest: stubManifest,
      createCapabilityAdapter: jest.fn(),
    };
    const { registries } = await bootPluginModule(plugin);

    expect(registries.adapterRegistry.register).toHaveBeenCalledTimes(1);
    expect(registries.adapterRegistry.register).toHaveBeenCalledWith(stubManifest);
  });

  it('registers a factory adapter under manifest.adapterKey', async () => {
    const plugin: AdapterPlugin = {
      manifest: stubManifest,
      createCapabilityAdapter: jest.fn(),
    };
    const { registries } = await bootPluginModule(plugin);

    expect(registries.factoryResolver.registerFactory).toHaveBeenCalledTimes(1);
    const [adapterKey, factoryAdapter] = registries.factoryResolver.registerFactory.mock.calls[0];
    expect(adapterKey).toBe('stub.test.v1');
    expect(factoryAdapter).toEqual({ createCapabilityAdapter: expect.any(Function) });
  });

  it('calls plugin.register(host) with the host bag when register is defined', async () => {
    const registerSpy = jest.fn();
    const plugin: AdapterPlugin = {
      manifest: stubManifest,
      register: registerSpy,
      createCapabilityAdapter: jest.fn(),
    };
    await bootPluginModule(plugin);

    expect(registerSpy).toHaveBeenCalledTimes(1);
    const [host] = registerSpy.mock.calls[0];
    expect(host).toEqual(
      expect.objectContaining({
        identifierMapping: stubIdentifierMapping,
        credentialsResolver: stubCredentialsResolver,
        cache: stubCache,
        logger: expect.any(Function),
        adapterRegistry: expect.any(Object),
        factoryResolver: expect.any(Object),
        connectionTesterRegistry: expect.any(Object),
        emailNormalizerRegistry: expect.any(Object),
        webhookProvisioningRegistry: expect.any(Object),
        retryClassifierRegistry: expect.any(Object),
        schedulerTaskRegistry: expect.any(Object),
      }),
    );
  });

  it('omits plugin.register call when not defined', async () => {
    const plugin: AdapterPlugin = {
      manifest: stubManifest,
      createCapabilityAdapter: jest.fn(),
      // no register
    };
    const { registries } = await bootPluginModule(plugin);

    // The manifest + factory still register; nothing else to assert beyond
    // the test surviving boot without throwing.
    expect(registries.adapterRegistry.register).toHaveBeenCalledTimes(1);
    expect(registries.factoryResolver.registerFactory).toHaveBeenCalledTimes(1);
  });

  it('factoryAdapter translates positional args into host bag with per-call overrides', async () => {
    const createSpy = jest.fn().mockResolvedValue('the-adapter');
    const plugin: AdapterPlugin = {
      manifest: stubManifest,
      createCapabilityAdapter: createSpy,
    };
    const { registries } = await bootPluginModule(plugin);
    const factoryAdapter: AdapterFactoryPort =
      registries.factoryResolver.registerFactory.mock.calls[0][1];

    const perCallConnection = { id: 'conn-1', platformType: 'stub' };
    const perCallIdMap = { perCallIdMap: true };
    const perCallCredRes = { perCallCredRes: true };
    const result = await factoryAdapter.createCapabilityAdapter(
      perCallConnection as never,
      'StubCapability',
      perCallIdMap as never,
      perCallCredRes as never,
    );

    expect(result).toBe('the-adapter');
    expect(createSpy).toHaveBeenCalledTimes(1);
    const [conn, cap, host] = createSpy.mock.calls[0] as [unknown, string, HostServices];
    expect(conn).toBe(perCallConnection);
    expect(cap).toBe('StubCapability');
    // Per-call overrides honoured.
    expect(host.identifierMapping).toBe(perCallIdMap);
    expect(host.credentialsResolver).toBe(perCallCredRes);
    // Host-wide fields still present.
    expect(host.cache).toBe(stubCache);
    expect(host.adapterRegistry).toBe(registries.adapterRegistry);
  });
});
