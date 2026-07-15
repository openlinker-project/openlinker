/**
 * WooCommerce Address Provisioner — unit tests
 *
 * Covers guest skip, reuse hit (mapping table), reuse miss (write inline address
 * + record mapping), hash-match recovery (existing WC address), and a concurrency
 * test proving the distributed lock prevents duplicate address writes.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/provisioners/__tests__
 */
import { WooCommerceAddressProvisioner } from '../woocommerce-address-provisioner';
import type { IWooCommerceHttpClient } from '../../http/woocommerce-http-client.interface';
import type { SyncLockPort } from '@openlinker/core/sync';
import type { CustomerProjectionRepositoryPort, AddressType } from '@openlinker/core/customers';
import { DestinationAddressMapping } from '@openlinker/core/customers';
import type { Address } from '@openlinker/core/orders';

const CONNECTION_ID = 'conn-wc-1';
const INTERNAL_CUSTOMER_ID = 'ol-cust-1';
const WC_CUSTOMER_ID = 7;

const originalPiiHashSalt = process.env.OL_PII_HASH_SALT;
beforeAll(() => {
  process.env.OL_PII_HASH_SALT = 'test-salt-for-hashing';
});
afterAll(() => {
  if (originalPiiHashSalt === undefined) delete process.env.OL_PII_HASH_SALT;
  else process.env.OL_PII_HASH_SALT = originalPiiHashSalt;
});

const ADDRESS: Address = {
  firstName: 'Jan',
  lastName: 'Kowalski',
  address1: 'ul. Kwiatowa 1',
  city: 'Warszawa',
  postalCode: '00-001',
  country: 'PL',
};

function makeHttpClient(): jest.Mocked<IWooCommerceHttpClient> {
  return { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() };
}

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

/** Stateful destination-address-mapping fake. */
function makeProjectionRepo(): jest.Mocked<CustomerProjectionRepositoryPort> {
  const store = new Map<string, DestinationAddressMapping>();
  const key = (i: string, c: string, h: string, t: AddressType): string => `${i}|${c}|${h}|${t}`;
  return {
    findById: jest.fn(),
    findByEmailHash: jest.fn(),
    findMany: jest.fn(),
    upsert: jest.fn(),
    findAddressesByCustomerId: jest.fn(),
    upsertAddress: jest.fn(),
    findDestinationAddressMapping: jest.fn((i: string, c: string, h: string, t: AddressType) =>
      Promise.resolve(store.get(key(i, c, h, t)) ?? null),
    ),
    upsertDestinationAddressMapping: jest.fn((m: DestinationAddressMapping) => {
      store.set(key(m.internalCustomerId, m.destinationConnectionId, m.addressHash, m.addressType), m);
      return Promise.resolve(m);
    }),
  } as unknown as jest.Mocked<CustomerProjectionRepositoryPort>;
}

function input(overrides: Partial<Record<string, unknown>> = {}): {
  internalCustomerId: string;
  wcCustomerId: number;
  address: Address | undefined;
  addressType: AddressType;
  connectionId: string;
  httpClient: jest.Mocked<IWooCommerceHttpClient>;
  customerProjectionRepository: jest.Mocked<CustomerProjectionRepositoryPort>;
} {
  return {
    internalCustomerId: INTERNAL_CUSTOMER_ID,
    wcCustomerId: WC_CUSTOMER_ID,
    address: ADDRESS,
    addressType: 'billing',
    connectionId: CONNECTION_ID,
    httpClient: makeHttpClient(),
    customerProjectionRepository: makeProjectionRepo(),
    ...overrides,
  } as never;
}

describe('WooCommerceAddressProvisioner', () => {
  it('should skip (return null) for a guest order (wcCustomerId <= 0)', async () => {
    const httpClient = makeHttpClient();
    const provisioner = new WooCommerceAddressProvisioner(makeSyncLock());
    const result = await provisioner.resolveOrCreateAddress(input({ wcCustomerId: 0, httpClient }));
    expect(result).toBeNull();
    expect(httpClient.get).not.toHaveBeenCalled();
    expect(httpClient.put).not.toHaveBeenCalled();
  });

  it('should skip (return null) when there is no address', async () => {
    const httpClient = makeHttpClient();
    const provisioner = new WooCommerceAddressProvisioner(makeSyncLock());
    const result = await provisioner.resolveOrCreateAddress(input({ address: undefined, httpClient }));
    expect(result).toBeNull();
    expect(httpClient.put).not.toHaveBeenCalled();
  });

  it('should reuse an existing mapping without any API call (reuse hit)', async () => {
    const repo = makeProjectionRepo();
    (repo.findDestinationAddressMapping as jest.Mock).mockResolvedValueOnce(
      new DestinationAddressMapping(INTERNAL_CUSTOMER_ID, CONNECTION_ID, 'h', 'billing', '7', new Date(), new Date()),
    );
    const httpClient = makeHttpClient();
    const provisioner = new WooCommerceAddressProvisioner(makeSyncLock());

    const result = await provisioner.resolveOrCreateAddress(
      input({ customerProjectionRepository: repo, httpClient }),
    );

    expect(result).toBe('7');
    expect(httpClient.get).not.toHaveBeenCalled();
    expect(httpClient.put).not.toHaveBeenCalled();
  });

  it('should write the inline address and record the mapping (reuse miss)', async () => {
    const repo = makeProjectionRepo();
    const httpClient = makeHttpClient();
    httpClient.get.mockResolvedValue({ id: WC_CUSTOMER_ID }); // no billing → no hash match
    httpClient.put.mockResolvedValue({ id: WC_CUSTOMER_ID });
    const provisioner = new WooCommerceAddressProvisioner(makeSyncLock());

    const result = await provisioner.resolveOrCreateAddress(
      input({ customerProjectionRepository: repo, httpClient }),
    );

    expect(result).toBe(String(WC_CUSTOMER_ID));
    expect(httpClient.put).toHaveBeenCalledWith(
      `/wp-json/wc/v3/customers/${WC_CUSTOMER_ID}`,
      expect.objectContaining({ billing: expect.objectContaining({ address_1: 'ul. Kwiatowa 1', country: 'PL' }) }),
    );
    expect(repo.upsertDestinationAddressMapping).toHaveBeenCalledTimes(1);
  });

  it('should reuse an address already present on the WC customer without a PUT (hash-match recovery)', async () => {
    const repo = makeProjectionRepo();
    const httpClient = makeHttpClient();
    // WC customer already carries the same billing address → hashes match.
    httpClient.get.mockResolvedValue({
      id: WC_CUSTOMER_ID,
      billing: { address_1: 'ul. Kwiatowa 1', city: 'Warszawa', postcode: '00-001', country: 'PL' },
    });
    const provisioner = new WooCommerceAddressProvisioner(makeSyncLock());

    const result = await provisioner.resolveOrCreateAddress(
      input({ customerProjectionRepository: repo, httpClient }),
    );

    expect(result).toBe(String(WC_CUSTOMER_ID));
    expect(httpClient.put).not.toHaveBeenCalled();
    expect(repo.upsertDestinationAddressMapping).toHaveBeenCalledTimes(1);
  });

  it('should NOT write a duplicate address under concurrent provisioning (lock serializes)', async () => {
    const repo = makeProjectionRepo();
    const httpClient = makeHttpClient();
    httpClient.get.mockResolvedValue({ id: WC_CUSTOMER_ID }); // no match → would PUT
    httpClient.put.mockResolvedValue({ id: WC_CUSTOMER_ID });
    const syncLock = makeSyncLock();
    const provisioner = new WooCommerceAddressProvisioner(syncLock);

    const [a, b] = await Promise.all([
      provisioner.resolveOrCreateAddress(input({ customerProjectionRepository: repo, httpClient })),
      provisioner.resolveOrCreateAddress(input({ customerProjectionRepository: repo, httpClient })),
    ]);

    expect(a).toBe(String(WC_CUSTOMER_ID));
    expect(b).toBe(String(WC_CUSTOMER_ID));
    // Exactly one PUT — the second caller reused the mapping recorded by the first.
    expect(httpClient.put).toHaveBeenCalledTimes(1);
    expect(repo.upsertDestinationAddressMapping).toHaveBeenCalledTimes(1);
  });
});
