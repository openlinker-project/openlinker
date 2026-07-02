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
        'ref:ksef': { authType: 'ksef-token', secretRef: 'ref:secret' },
        'ref:secret': { token: 'TKN', contextNip: '1234567890' },
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
          'ref:ksef': { authType: 'ksef-token', secretRef: 'ref:secret' },
          'ref:secret': { token: 'TKN', contextNip: '1234567890' },
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
        resolver({ 'ref:ksef': { authType: 'qualified-seal', secretRef: 'ref:cert' } }),
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

  describe('resolvePayment (#1311)', () => {
    function resolvedPayment(
      payment: Record<string, unknown> | undefined,
    ): Record<string, unknown> | undefined {
      const factory = new KsefAdapterFactory();
      const resolve = (
        factory as unknown as {
          resolvePayment(c: Connection): Record<string, unknown> | undefined;
        }
      ).resolvePayment;
      return resolve.call(
        factory,
        connection({ config: { env: 'test', seller: SELLER_CONFIG, payment } }),
      );
    }

    it('should return undefined when the connection has no payment config', () => {
      expect(resolvedPayment(undefined)).toBeUndefined();
    });

    it('should return undefined when payment is an empty object', () => {
      expect(resolvedPayment({})).toBeUndefined();
    });

    it('should resolve a well-formed payment config', () => {
      expect(
        resolvedPayment({
          formaPlatnosci: '6',
          bankAccount: { nrRb: '61109010140000000099999999', bankName: 'Santander', swift: 'WBKPPLPP' },
          paymentTermDays: 14,
          skonto: { conditions: '2% if paid within 7 days', amount: '2%' },
        }),
      ).toEqual({
        formaPlatnosci: '6',
        bankAccount: { nrRb: '61109010140000000099999999', bankName: 'Santander', swift: 'WBKPPLPP' },
        paymentTermDays: 14,
        skonto: { conditions: '2% if paid within 7 days', amount: '2%' },
      });
    });

    it('should drop a malformed bankAccount (empty nrRb) while keeping other configured fields', () => {
      expect(
        resolvedPayment({ formaPlatnosci: '1', bankAccount: { nrRb: '' } }),
      ).toEqual({ formaPlatnosci: '1' });
    });

    it('should resolve formaPlatnosci-only (Gotówka, no bank account)', () => {
      expect(resolvedPayment({ formaPlatnosci: '1' })).toEqual({ formaPlatnosci: '1' });
    });

    it('should resolve bankAccount-only (no payment method)', () => {
      expect(resolvedPayment({ bankAccount: { nrRb: '61109010140000000099999999' } })).toEqual({
        bankAccount: { nrRb: '61109010140000000099999999' },
      });
    });

    it('should drop an incomplete skonto (missing amount)', () => {
      expect(
        resolvedPayment({ formaPlatnosci: '6', skonto: { conditions: 'text only' } }),
      ).toEqual({ formaPlatnosci: '6' });
    });
  });
});
