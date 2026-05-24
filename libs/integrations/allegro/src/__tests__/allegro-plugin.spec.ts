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

import { createAllegroPlugin } from '../allegro-plugin';

describe('createAllegroPlugin → register(host)', () => {
  function makeRegisterHost(): {
    host: HostServices;
    configRegistry: { register: jest.Mock };
    credentialsRegistry: { register: jest.Mock };
  } {
    const configRegistry = { register: jest.fn() };
    const credentialsRegistry = { register: jest.fn() };
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
    } as unknown as HostServices;
    return { host, configRegistry, credentialsRegistry };
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
});
