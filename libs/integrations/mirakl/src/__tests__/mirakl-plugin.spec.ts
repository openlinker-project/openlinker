/**
 * Mirakl Plugin Descriptor: unit tests
 *
 * The manifest comes from the operator profile and advertises `OrderSource`;
 * `register` wires every side-registration under the profile's adapter key;
 * `createCapabilityAdapter` builds the order source and refuses what is not
 * delivered yet; the Empik module builds.
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
import { MiraklEmailNormalizerAdapter } from '../infrastructure/adapters/mirakl-email-normalizer.adapter';
import { MiraklOfferManagerAdapter } from '../infrastructure/adapters/mirakl-offer-manager.adapter';
import { MiraklOrderSourceAdapter } from '../infrastructure/adapters/mirakl-order-source.adapter';
import { MiraklRetryClassifierAdapter } from '../infrastructure/adapters/mirakl-retry-classifier.adapter';

function registry(): { register: jest.Mock } {
  return { register: jest.fn() };
}

describe('createMiraklPlugin (Empik)', () => {
  it('should build the manifest from the Empik profile with the order source', () => {
    const plugin = createMiraklPlugin(empikOperatorProfile);

    expect(plugin.manifest).toEqual({
      adapterKey: EMPIK_ADAPTER_KEY,
      platformType: 'empik',
      supportedCapabilities: [
        'OrderSource',
        'ReturnSourceReader',
        'OfferManager',
        'OfferLister',
        'OfferStatusReader',
        'OfferQuantityBatchUpdater',
        'PendingQuantityAckReconciler',
        'OfferFieldUpdater',
        'OfferCreator',
        'CategoryBrowser',
        'EanCategoryMatcher',
      ],
      displayName: 'Empik Marketplace',
      version: '0.1.0',
      isDefault: true,
    });
    expect(plugin.manifest).toEqual(buildMiraklAdapterManifest(empikOperatorProfile));
    expect(plugin.manifest).not.toHaveProperty('defaultRateLimit');
  });

  it('should register validators, tester, classifiers, normalizer and the poll under the Empik adapter key', () => {
    const configRegistry = registry();
    const emailRegistry = registry();
    const schedulerRegistry = registry();
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
      emailNormalizerRegistry: emailRegistry,
      schedulerTaskRegistry: schedulerRegistry,
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
    expect(emailRegistry.register).toHaveBeenCalledWith(
      EMPIK_ADAPTER_KEY,
      expect.any(MiraklEmailNormalizerAdapter),
    );
    expect(schedulerRegistry.register).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'empik-orders-poll', jobType: 'marketplace.orders.poll' }),
    );
  });

  function capabilityHost(): HostServices {
    return {
      credentialsResolver: { get: jest.fn().mockResolvedValue({ apiKey: 'key-1' }) },
      http: { forConnection: jest.fn().mockReturnValue(jest.fn()), evict: jest.fn() },
    } as unknown as HostServices;
  }

  const empikConnection = {
    id: 'conn-1',
    config: {},
    credentialsRef: 'ref-1',
  } as unknown as Connection;

  it('should build the order source', async () => {
    const adapter = await createMiraklPlugin(empikOperatorProfile).createCapabilityAdapter(
      empikConnection,
      'OrderSource',
      capabilityHost(),
    );

    expect(adapter).toBeInstanceOf(MiraklOrderSourceAdapter);
  });

  it('should build the offer manager', async () => {
    const adapter = await createMiraklPlugin(empikOperatorProfile).createCapabilityAdapter(
      empikConnection,
      'OfferManager',
      capabilityHost(),
    );

    expect(adapter).toBeInstanceOf(MiraklOfferManagerAdapter);
  });

  it('should refuse a capability no adapter delivers', async () => {
    await expect(
      createMiraklPlugin(empikOperatorProfile).createCapabilityAdapter(
        empikConnection,
        'ProductPublisher',
        capabilityHost(),
      ),
    ).rejects.toThrow(/Empik/);
  });

  it('should build the Empik host module', () => {
    expect(EmpikIntegrationModule).toHaveProperty('module');
  });
});
