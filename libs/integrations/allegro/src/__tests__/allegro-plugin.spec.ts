/**
 * Allegro Plugin Descriptor — unit tests
 *
 * Wire-up coverage for #586. Verifies that `register(host)` self-registers
 * the config-shape validator at `allegro.publicapi.v1`. Allegro deliberately
 * does NOT register a credentials-shape validator — token shape is enforced
 * by `AllegroAdapterFactory.resolveCredentials` deeper in the stack.
 *
 * @module libs/integrations/allegro/src/__tests__
 */
import type { HostServices } from '@openlinker/plugin-sdk';
import type { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';

import { allegroAdapterManifest, createAllegroPlugin } from '../allegro-plugin';

describe('allegroAdapterManifest', () => {
  it('declares the ShippingProviderManager capability so it routes as a source_brokered processor (#833)', () => {
    expect(allegroAdapterManifest.supportedCapabilities).toEqual(
      expect.arrayContaining(['OrderSource', 'OfferManager', 'ShippingProviderManager']),
    );
  });
});

describe('createAllegroPlugin → register(host)', () => {
  function makeRegisterHost(): {
    host: HostServices;
    configRegistry: { register: jest.Mock };
    credentialsRegistry: { register: jest.Mock };
    oauthCompletionRegistry: { register: jest.Mock };
  } {
    const configRegistry = { register: jest.fn() };
    const credentialsRegistry = { register: jest.fn() };
    const oauthCompletionRegistry = { register: jest.fn() };
    const host = {
      identifierMapping: {} as IdentifierMappingPort,
      credentialsResolver: {} as CredentialsResolverPort,
      cache: undefined,
      connectionTesterRegistry: { register: jest.fn() },
      emailNormalizerRegistry: { register: jest.fn() },
      retryClassifierRegistry: { register: jest.fn() },
      authFailureClassifierRegistry: { register: jest.fn() },
      schedulerTaskRegistry: { register: jest.fn() },
      connectionConfigShapeValidatorRegistry: configRegistry,
      connectionCredentialsShapeValidatorRegistry: credentialsRegistry,
      oauthCompletionRegistry,
    } as unknown as HostServices;
    return { host, configRegistry, credentialsRegistry, oauthCompletionRegistry };
  }

  it('registers the config-shape validator at adapterKey allegro.publicapi.v1', () => {
    const { host, configRegistry } = makeRegisterHost();
    // configService omitted — scheduler-task registration is skipped, which
    // keeps this spec narrowly focused on the shape-validator wiring.
    createAllegroPlugin({}).register?.(host);

    expect(configRegistry.register).toHaveBeenCalledWith(
      'allegro.publicapi.v1',
      expect.objectContaining({ validate: expect.any(Function) }),
    );
  });

  it('does NOT register a credentials-shape validator', () => {
    const { host, credentialsRegistry } = makeRegisterHost();
    createAllegroPlugin({}).register?.(host);

    expect(credentialsRegistry.register).not.toHaveBeenCalled();
  });

  it('registers the OAuth-completion adapter at adapterKey allegro.publicapi.v1', () => {
    const { host, oauthCompletionRegistry } = makeRegisterHost();
    createAllegroPlugin({}).register?.(host);

    expect(oauthCompletionRegistry.register).toHaveBeenCalledWith(
      'allegro.publicapi.v1',
      expect.objectContaining({
        buildAuthorizationUrl: expect.any(Function),
        exchangeCode: expect.any(Function),
        fetchAccountIdentity: expect.any(Function),
      }),
    );
  });
});
