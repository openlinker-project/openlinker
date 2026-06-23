/**
 * KSeF adapter factory specs — credential resolution + fail-fast config errors.
 *
 * @module libs/integrations/ksef/src/application/factories
 */
import { KsefAdapterFactory } from '../ksef-adapter.factory';
import { KsefConfigException } from '../../../domain/exceptions/ksef-config.exception';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import { Connection, type IdentifierMappingPort } from '@openlinker/core/identifier-mapping';

const idMapping = {} as IdentifierMappingPort;

function connection(opts: {
  config?: Record<string, unknown>;
  credentialsRef?: string;
} = {}): Connection {
  return new Connection(
    'conn-1',
    'ksef',
    'KSeF',
    'active',
    opts.config ?? { env: 'test' },
    opts.credentialsRef ?? 'ref:ksef',
    new Date(),
    new Date(),
    undefined,
    [],
  );
}

function resolver(map: Record<string, unknown>): CredentialsResolverPort {
  return {
    get: <T>(ref: string): Promise<T> => {
      if (!(ref in map)) {
        return Promise.reject(new Error(`no secret for ${ref}`));
      }
      return Promise.resolve(map[ref] as T);
    },
  };
}

describe('KsefAdapterFactory', () => {
  it('should build an invoicing adapter for a valid ksef-token connection', async () => {
    const factory = new KsefAdapterFactory();
    const adapters = await factory.createAdapters(
      connection(),
      idMapping,
      resolver({
        'ref:ksef': { authType: 'ksef-token', secretRef: 'ref:secret' },
        'ref:secret': { token: 'TKN', contextNip: '1234567890' },
      }),
    );
    expect(adapters.invoicing).toBeDefined();
  });

  it('should throw when the environment is missing/invalid', async () => {
    const factory = new KsefAdapterFactory();
    await expect(
      factory.createAdapters(connection({ config: {} }), idMapping, resolver({})),
    ).rejects.toBeInstanceOf(KsefConfigException);
  });

  it('should throw when credentialsRef is absent', async () => {
    const factory = new KsefAdapterFactory();
    await expect(
      factory.createAdapters(connection({ credentialsRef: '' }), idMapping, resolver({})),
    ).rejects.toBeInstanceOf(KsefConfigException);
  });

  it('should throw when the credential shape is malformed', async () => {
    const factory = new KsefAdapterFactory();
    await expect(
      factory.createAdapters(connection(), idMapping, resolver({ 'ref:ksef': { authType: 'ksef-token' } })),
    ).rejects.toBeInstanceOf(KsefConfigException);
  });

  it('should reject the qualified-seal authType (deferred to C4)', async () => {
    const factory = new KsefAdapterFactory();
    await expect(
      factory.createAdapters(
        connection(),
        idMapping,
        resolver({ 'ref:ksef': { authType: 'qualified-seal', secretRef: 'ref:cert' } }),
      ),
    ).rejects.toBeInstanceOf(KsefConfigException);
  });
});
