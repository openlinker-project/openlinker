/**
 * Mirakl Plugin Descriptor: unit tests
 *
 * The manifest comes from the operator profile and advertises no capability
 * yet; `register` wires every side-registration under the profile's adapter
 * key; `createCapabilityAdapter` refuses every capability; the Empik module
 * builds.
 *
 * @module libs/integrations/mirakl/src/__tests__
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { HostServices } from '@openlinker/plugin-sdk';
import {
  buildMiraklAdapterManifest,
  createMiraklPlugin,
  EMPIK_ADAPTER_KEY,
  EmpikIntegrationModule,
  empikOperatorProfile,
} from '../index';
import { MiraklAuthFailureClassifierAdapter } from '../infrastructure/adapters/mirakl-auth-failure-classifier.adapter';
import { MiraklConnectionConfigShapeValidatorAdapter } from '../infrastructure/adapters/mirakl-connection-config-shape-validator.adapter';
import { MiraklConnectionCredentialsShapeValidatorAdapter } from '../infrastructure/adapters/mirakl-connection-credentials-shape-validator.adapter';
import { MiraklConnectionTesterAdapter } from '../infrastructure/adapters/mirakl-connection-tester.adapter';
import { MiraklRetryClassifierAdapter } from '../infrastructure/adapters/mirakl-retry-classifier.adapter';

function registry(): { register: jest.Mock } {
  return { register: jest.fn() };
}

describe('createMiraklPlugin (Empik)', () => {
  it('should build the manifest from the Empik profile with no capabilities', () => {
    const plugin = createMiraklPlugin(empikOperatorProfile);

    expect(plugin.manifest).toEqual({
      adapterKey: EMPIK_ADAPTER_KEY,
      platformType: 'empik',
      supportedCapabilities: [],
      displayName: 'Empik Marketplace',
      version: '0.1.0',
      isDefault: true,
    });
    expect(plugin.manifest).toEqual(buildMiraklAdapterManifest(empikOperatorProfile));
    expect(plugin.manifest).not.toHaveProperty('defaultRateLimit');
  });

  it('should register validators, tester and classifiers under the Empik adapter key', () => {
    const configRegistry = registry();
    const credentialsRegistry = registry();
    const testerRegistry = registry();
    const retryRegistry = registry();
    const authRegistry = registry();
    const host = {
      http: { forConnection: jest.fn(), evict: jest.fn() },
      connectionConfigShapeValidatorRegistry: configRegistry,
      connectionCredentialsShapeValidatorRegistry: credentialsRegistry,
      connectionTesterRegistry: testerRegistry,
      retryClassifierRegistry: retryRegistry,
      authFailureClassifierRegistry: authRegistry,
    } as unknown as HostServices;

    createMiraklPlugin(empikOperatorProfile).register?.(host);

    expect(configRegistry.register).toHaveBeenCalledWith(
      EMPIK_ADAPTER_KEY,
      expect.any(MiraklConnectionConfigShapeValidatorAdapter),
    );
    expect(credentialsRegistry.register).toHaveBeenCalledWith(
      EMPIK_ADAPTER_KEY,
      expect.any(MiraklConnectionCredentialsShapeValidatorAdapter),
    );
    expect(testerRegistry.register).toHaveBeenCalledWith(
      EMPIK_ADAPTER_KEY,
      expect.any(MiraklConnectionTesterAdapter),
    );
    expect(retryRegistry.register).toHaveBeenCalledWith(
      EMPIK_ADAPTER_KEY,
      expect.any(MiraklRetryClassifierAdapter),
    );
    expect(authRegistry.register).toHaveBeenCalledWith(
      EMPIK_ADAPTER_KEY,
      expect.any(MiraklAuthFailureClassifierAdapter),
    );
  });

  it.each(['OrderSource', 'OfferManager'])(
    'should refuse the %s capability until an adapter delivers it',
    async (capability) => {
      const plugin = createMiraklPlugin(empikOperatorProfile);

      await expect(
        plugin.createCapabilityAdapter({} as Connection, capability, {} as HostServices),
      ).rejects.toThrow(/Empik/);
    },
  );

  it('should build the Empik host module', () => {
    expect(EmpikIntegrationModule).toHaveProperty('module');
  });
});
