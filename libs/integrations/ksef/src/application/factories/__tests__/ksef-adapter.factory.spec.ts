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

const SELLER_CONFIG = {
  nip: '1234567890',
  name: 'Acme Sp. z o.o.',
  address: {
    line1: 'ul. Testowa 1',
    city: 'Warszawa',
    postalCode: '00-001',
    countryIso2: 'PL',
  },
};

function connection(opts: {
  config?: Record<string, unknown>;
  credentialsRef?: string;
} = {}): Connection {
  return new Connection(
    'conn-1',
    'ksef',
    'KSeF',
    'active',
    opts.config ?? { env: 'test', seller: SELLER_CONFIG },
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
        'ref:ksef': { authType: 'ksef-token', secret: 'super-secret-token' },
      }),
    );
    expect(adapters.invoicing).toBeDefined();
  });

  it('should throw when the seller profile is missing', async () => {
    const factory = new KsefAdapterFactory();
    await expect(
      factory.createAdapters(
        connection({ config: { env: 'test' } }),
        idMapping,
        resolver({
          'ref:ksef': { authType: 'ksef-token', secret: 'super-secret-token' },
        }),
      ),
    ).rejects.toBeInstanceOf(KsefConfigException);
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
        resolver({ 'ref:ksef': { authType: 'qualified-seal', secret: 'ref:cert' } }),
      ),
    ).rejects.toBeInstanceOf(KsefConfigException);
  });

  describe('resolveDefaultTaxRate (#1290)', () => {
    // Exercises the factory's own `resolveDefaultTaxRate` via private-method
    // bracket access, rather than casting into the constructed adapter's
    // internals to read a private field (#1291 NIT).
    function resolvedDefaultTaxRate(sellerConfig: Record<string, unknown>): string {
      const factory = new KsefAdapterFactory();
      const resolve = (factory as unknown as { resolveDefaultTaxRate(c: Connection): string })
        .resolveDefaultTaxRate;
      return resolve.call(factory, connection({ config: { env: 'test', seller: sellerConfig } }));
    }

    it('should fall back to the PL standard rate when unconfigured', () => {
      expect(resolvedDefaultTaxRate(SELLER_CONFIG)).toBe('23');
    });

    it('should use the connection-configured defaultTaxRate when present', () => {
      expect(resolvedDefaultTaxRate({ ...SELLER_CONFIG, defaultTaxRate: '8' })).toBe('8');
    });

    it('should fall back to the PL standard rate when defaultTaxRate is whitespace-only', () => {
      expect(resolvedDefaultTaxRate({ ...SELLER_CONFIG, defaultTaxRate: '   ' })).toBe('23');
    });
  });
});
