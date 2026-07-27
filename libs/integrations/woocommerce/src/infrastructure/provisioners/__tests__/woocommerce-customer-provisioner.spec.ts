/**
 * WooCommerce Customer Provisioner — unit tests
 *
 * Covers resolve-or-create, guest fallback, duplicate-email recovery, auth-failure
 * propagation, concurrent-duplicate mapping handling, and a concurrency test that
 * proves the distributed lock prevents duplicate customer creation.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/provisioners/__tests__
 */
import { WooCommerceCustomerProvisioner } from '../woocommerce-customer-provisioner';
import type { IWooCommerceHttpClient } from '../../http/woocommerce-http-client.interface';
import type { IdentifierMappingPort, ExternalIdMapping } from '@openlinker/core/identifier-mapping';
import { CORE_ENTITY_TYPE, DuplicateIdentifierMappingError } from '@openlinker/core/identifier-mapping';
import type { SyncLockPort } from '@openlinker/core/sync';
import { WooCommerceHttpResponseException } from '../../http/woocommerce-http-response.exception';
import { WooCommerceUnauthorizedException } from '../../../domain/exceptions/woocommerce-unauthorized.exception';
import { WooCommerceAuthFailureException } from '../../../domain/exceptions/woocommerce-auth-failure.exception';

const CONNECTION_ID = 'conn-wc-1';
const INTERNAL_CUSTOMER_ID = 'ol-cust-1';
const EMAIL = 'buyer@example.com';

function makeHttpClient(): jest.Mocked<IWooCommerceHttpClient> {
  return { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() };
}

/** In-memory SyncLockPort — single holder per key. */
function makeSyncLock(): SyncLockPort {
  const locks = new Map<string, string>();
  return {
    acquire: jest.fn((key: string) => {
      if (locks.has(key)) return Promise.resolve(null);
      const token = `tok-${Math.random().toString(36).slice(2)}`;
      locks.set(key, token);
      return Promise.resolve(token);
    }),
    release: jest.fn((key: string, token: string) => {
      if (locks.get(key) === token) {
        locks.delete(key);
        return Promise.resolve(true);
      }
      return Promise.resolve(false);
    }),
  };
}

/** Stateful identifier-mapping fake scoped to the Customer entity on one connection. */
function makeStatefulMapping(): {
  port: jest.Mocked<IdentifierMappingPort>;
  seed(internalId: string, externalId: string): void;
} {
  const store = new Map<string, string>(); // internalId -> externalId
  const port = {
    getOrCreateInternalId: jest.fn(),
    getOrCreateExactMapping: jest.fn(),
    getInternalId: jest.fn(),
    getExternalIds: jest.fn((entityType: string, internalId: string) => {
      const externalId = store.get(internalId);
      if (entityType !== CORE_ENTITY_TYPE.Customer || externalId === undefined) {
        return Promise.resolve([] as ExternalIdMapping[]);
      }
      return Promise.resolve([
        { externalId, connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType },
      ]);
    }),
    createMapping: jest.fn((_entityType: string, externalId: string, _connId: string, internalId: string) => {
      if (store.has(internalId)) {
        return Promise.reject(
          new DuplicateIdentifierMappingError(CORE_ENTITY_TYPE.Customer, externalId, 'woocommerce', CONNECTION_ID),
        );
      }
      store.set(internalId, externalId);
      return Promise.resolve();
    }),
    batchGetOrCreateInternalIds: jest.fn(),
    deleteMapping: jest.fn(),
    listExternalIdsByConnection: jest.fn(),
  } as unknown as jest.Mocked<IdentifierMappingPort>;
  return { port, seed: (internalId, externalId) => store.set(internalId, externalId) };
}

function baseInput(overrides: Record<string, unknown> = {}): {
  internalCustomerId: string | undefined;
  buyerEmail: string | undefined;
  firstName: string;
  lastName: string;
  connectionId: string;
  httpClient: jest.Mocked<IWooCommerceHttpClient>;
  identifierMapping: jest.Mocked<IdentifierMappingPort>;
} {
  return {
    internalCustomerId: INTERNAL_CUSTOMER_ID,
    buyerEmail: EMAIL,
    firstName: 'Jan',
    lastName: 'Kowalski',
    connectionId: CONNECTION_ID,
    httpClient: makeHttpClient(),
    identifierMapping: makeStatefulMapping().port,
    ...overrides,
  } as never;
}

describe('WooCommerceCustomerProvisioner', () => {
  it('should return the mapped WC customer id without any API call (resolve — existing mapping)', async () => {
    const { port, seed } = makeStatefulMapping();
    seed(INTERNAL_CUSTOMER_ID, '7');
    const httpClient = makeHttpClient();
    const provisioner = new WooCommerceCustomerProvisioner(makeSyncLock());

    const id = await provisioner.resolveOrCreateCustomer(
      baseInput({ identifierMapping: port, httpClient }),
    );

    expect(id).toBe(7);
    expect(httpClient.post).not.toHaveBeenCalled();
  });

  it('should create a WC customer and record the mapping (create — no existing mapping)', async () => {
    const { port } = makeStatefulMapping();
    const httpClient = makeHttpClient();
    httpClient.post.mockResolvedValue({ id: 42 });
    const provisioner = new WooCommerceCustomerProvisioner(makeSyncLock());

    const id = await provisioner.resolveOrCreateCustomer(
      baseInput({ identifierMapping: port, httpClient }),
    );

    expect(id).toBe(42);
    expect(httpClient.post).toHaveBeenCalledWith(
      '/wp-json/wc/v3/customers',
      expect.objectContaining({ email: EMAIL }),
    );
    expect(port.createMapping).toHaveBeenCalledWith(CORE_ENTITY_TYPE.Customer, '42', CONNECTION_ID, INTERNAL_CUSTOMER_ID);
  });

  it('should return guest (0) when there is no internal customer id', async () => {
    const provisioner = new WooCommerceCustomerProvisioner(makeSyncLock());
    const id = await provisioner.resolveOrCreateCustomer(baseInput({ internalCustomerId: undefined }));
    expect(id).toBe(0);
  });

  it('should return guest (0) when no mapping exists and no buyer email is available', async () => {
    const httpClient = makeHttpClient();
    const provisioner = new WooCommerceCustomerProvisioner(makeSyncLock());
    const id = await provisioner.resolveOrCreateCustomer(baseInput({ buyerEmail: undefined, httpClient }));
    expect(id).toBe(0);
    expect(httpClient.post).not.toHaveBeenCalled();
  });

  it('should return guest (0) when the existing mapping is corrupted (non positive-integer)', async () => {
    const { port, seed } = makeStatefulMapping();
    seed(INTERNAL_CUSTOMER_ID, 'not-a-number');
    const provisioner = new WooCommerceCustomerProvisioner(makeSyncLock());
    const id = await provisioner.resolveOrCreateCustomer(baseInput({ identifierMapping: port }));
    expect(id).toBe(0);
  });

  it('should recover the existing customer by email on WC duplicate-email 400', async () => {
    const { port } = makeStatefulMapping();
    const httpClient = makeHttpClient();
    httpClient.post.mockRejectedValue(new WooCommerceHttpResponseException(400, 'email exists'));
    httpClient.get.mockResolvedValue([{ id: 99, email: EMAIL }]);
    const provisioner = new WooCommerceCustomerProvisioner(makeSyncLock());

    const id = await provisioner.resolveOrCreateCustomer(baseInput({ identifierMapping: port, httpClient }));

    expect(id).toBe(99);
    expect(httpClient.get).toHaveBeenCalledWith('/wp-json/wc/v3/customers', { email: EMAIL });
    expect(port.createMapping).toHaveBeenCalledWith(CORE_ENTITY_TYPE.Customer, '99', CONNECTION_ID, INTERNAL_CUSTOMER_ID);
  });

  it('should propagate auth failures as WooCommerceAuthFailureException (not swallowed to guest)', async () => {
    const httpClient = makeHttpClient();
    httpClient.post.mockRejectedValue(new WooCommerceUnauthorizedException('401'));
    const provisioner = new WooCommerceCustomerProvisioner(makeSyncLock());

    await expect(
      provisioner.resolveOrCreateCustomer(baseInput({ httpClient })),
    ).rejects.toBeInstanceOf(WooCommerceAuthFailureException);
  });

  it('should degrade to guest (0) on a non-auth, non-400 API error', async () => {
    const httpClient = makeHttpClient();
    httpClient.post.mockRejectedValue(new WooCommerceHttpResponseException(500, 'server error'));
    const provisioner = new WooCommerceCustomerProvisioner(makeSyncLock());
    const id = await provisioner.resolveOrCreateCustomer(baseInput({ httpClient }));
    expect(id).toBe(0);
  });

  it('should resolve the winning mapping when createMapping races (concurrent duplicate)', async () => {
    const { port, seed } = makeStatefulMapping();
    const httpClient = makeHttpClient();
    httpClient.post.mockResolvedValue({ id: 55 });
    // createMapping rejects with a duplicate, and the winner is already stored.
    port.createMapping.mockImplementationOnce(() => {
      seed(INTERNAL_CUSTOMER_ID, '55');
      return Promise.reject(
        new DuplicateIdentifierMappingError(CORE_ENTITY_TYPE.Customer, '55', 'woocommerce', CONNECTION_ID),
      );
    });
    const provisioner = new WooCommerceCustomerProvisioner(makeSyncLock());

    const id = await provisioner.resolveOrCreateCustomer(baseInput({ identifierMapping: port, httpClient }));
    expect(id).toBe(55);
  });

  it('should NOT create a duplicate customer under concurrent provisioning (lock serializes)', async () => {
    const { port } = makeStatefulMapping();
    const httpClient = makeHttpClient();
    httpClient.post.mockResolvedValue({ id: 77 });
    const syncLock = makeSyncLock();
    const provisioner = new WooCommerceCustomerProvisioner(syncLock);

    const [a, b] = await Promise.all([
      provisioner.resolveOrCreateCustomer(baseInput({ identifierMapping: port, httpClient })),
      provisioner.resolveOrCreateCustomer(baseInput({ identifierMapping: port, httpClient })),
    ]);

    expect(a).toBe(77);
    expect(b).toBe(77);
    // Exactly one POST /customers — the second caller reused the mapping after the lock.
    expect(httpClient.post).toHaveBeenCalledTimes(1);
    expect(port.createMapping).toHaveBeenCalledTimes(1);
  });

  it('should serialize case/whitespace email variants on the same lock key (normalized)', async () => {
    const httpClient = makeHttpClient();
    httpClient.post.mockResolvedValue({ id: 88 });
    const syncLock = makeSyncLock();
    const provisioner = new WooCommerceCustomerProvisioner(syncLock);

    // Two distinct internal customers so neither takes the mapping fast path;
    // both provision under a lock keyed off the (normalized) email.
    await provisioner.resolveOrCreateCustomer(
      baseInput({
        internalCustomerId: 'ol-cust-a',
        buyerEmail: 'Buyer@Example.com',
        identifierMapping: makeStatefulMapping().port,
        httpClient,
      }),
    );
    await provisioner.resolveOrCreateCustomer(
      baseInput({
        internalCustomerId: 'ol-cust-b',
        buyerEmail: '  buyer@example.com  ',
        identifierMapping: makeStatefulMapping().port,
        httpClient,
      }),
    );

    const acquireMock = syncLock.acquire as jest.Mock<Promise<string | null>, [string, number]>;
    expect(acquireMock).toHaveBeenCalledTimes(2);
    const [firstKey] = acquireMock.mock.calls[0];
    const [secondKey] = acquireMock.mock.calls[1];
    expect(firstKey).toBe(secondKey);
  });
});
