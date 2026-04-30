/**
 * PrestaShop Address Provisioner Tests — pickup-point branch (#458)
 *
 * Focused on the locker-aware behaviour: the on-the-wire `address2` written to
 * PrestaShop and the address-hash used for reuse must derive from the same
 * `effectiveAddress` view, so two orders to the same locker share the PS
 * `id_address` row and two orders to different lockers don't collide.
 *
 * @module libs/integrations/prestashop/src/infrastructure/provisioners/__tests__
 */
import { PrestashopAddressProvisioner } from '../prestashop-address-provisioner';
import { PrestashopCountryResolver } from '../prestashop-country-resolver';
import { IPrestashopWebserviceClient } from '../../http/prestashop-webservice.client.interface';
import { CustomerProjectionRepositoryPort, DestinationAddressMapping } from '@openlinker/core/customers';
import { Address, OrderPickupPoint } from '@openlinker/core/orders';
import { PrestashopConnectionConfig } from '../../../domain/types/prestashop-config.types';

describe('PrestashopAddressProvisioner — pickup-point (#458)', () => {
  const originalPiiHashSalt = process.env.OL_PII_HASH_SALT;

  beforeAll(() => {
    process.env.OL_PII_HASH_SALT = 'test-salt-for-hashing';
  });
  afterAll(() => {
    if (originalPiiHashSalt === undefined) {
      delete process.env.OL_PII_HASH_SALT;
    } else {
      process.env.OL_PII_HASH_SALT = originalPiiHashSalt;
    }
  });

  let provisioner: PrestashopAddressProvisioner;
  let countryResolver: jest.Mocked<PrestashopCountryResolver>;
  let webserviceClient: jest.Mocked<IPrestashopWebserviceClient>;
  let projectionRepo: jest.Mocked<CustomerProjectionRepositoryPort>;
  let createCalls: Array<Record<string, unknown>>;
  let upsertedHashes: string[];

  const baseAddress: Address = {
    firstName: 'Buyer',
    lastName: 'Profile',
    address1: 'ul. Lockerowa 1',
    city: 'Poznań',
    postalCode: '60-001',
    country: 'PL',
  };

  const config: PrestashopConnectionConfig = { baseUrl: 'https://shop.test' };

  beforeEach(() => {
    countryResolver = {
      resolveCountryId: jest.fn().mockResolvedValue(14),
    } as unknown as jest.Mocked<PrestashopCountryResolver>;

    // Redis client null → graceful degradation path (no actual locking).
    provisioner = new PrestashopAddressProvisioner(null, countryResolver);

    createCalls = [];
    webserviceClient = {
      listResources: jest.fn().mockResolvedValue([]),
      createResource: jest.fn().mockImplementation((_resource, data) => {
        createCalls.push(data);
        return Promise.resolve({ id: String(createCalls.length) });
      }),
    } as unknown as jest.Mocked<IPrestashopWebserviceClient>;

    upsertedHashes = [];
    projectionRepo = {
      findDestinationAddressMapping: jest.fn().mockResolvedValue(null),
      upsertDestinationAddressMapping: jest
        .fn()
        .mockImplementation((mapping: DestinationAddressMapping) => {
          upsertedHashes.push(mapping.addressHash);
          return Promise.resolve();
        }),
    } as unknown as jest.Mocked<CustomerProjectionRepositoryPort>;
  });

  it('writes the locker name+id+description into PS address2 and uses the same string for hashing', async () => {
    const pickupPoint: OrderPickupPoint = {
      id: 'POZ08A',
      name: 'Paczkomat POZ08A',
      description: 'Stacja paliw BP',
    };

    await provisioner.resolveOrCreateAddress(
      'ol_customer_1',
      '42',
      baseAddress,
      'shipping',
      'conn-ps-1',
      webserviceClient,
      config,
      projectionRepo,
      pickupPoint,
    );

    expect(createCalls).toHaveLength(1);
    expect(createCalls[0].address2).toBe('Paczkomat POZ08A · Stacja paliw BP');
    // Mapping was upserted with a hash derived from the same effective view.
    expect(upsertedHashes).toHaveLength(1);
  });

  it('reuses the same hash when two orders ship to the same locker', async () => {
    const pickupPoint: OrderPickupPoint = {
      id: 'POZ08A',
      name: 'Paczkomat POZ08A',
      description: 'Stacja paliw BP',
    };

    await provisioner.resolveOrCreateAddress(
      'ol_customer_1',
      '42',
      baseAddress,
      'shipping',
      'conn-ps-1',
      webserviceClient,
      config,
      projectionRepo,
      pickupPoint,
    );
    await provisioner.resolveOrCreateAddress(
      'ol_customer_2',
      '43',
      baseAddress,
      'shipping',
      'conn-ps-1',
      webserviceClient,
      config,
      projectionRepo,
      pickupPoint,
    );

    expect(upsertedHashes).toHaveLength(2);
    expect(upsertedHashes[0]).toBe(upsertedHashes[1]);
  });

  it('produces different hashes for two different lockers at the same physical address', async () => {
    // Edge case: pretend two lockers somehow share geography (the locker code
    // alone disambiguates them). The locker-aware `address2` differentiates the
    // hash even when address1/city/postcode are identical.
    const pickupA: OrderPickupPoint = { id: 'POZ08A', name: 'Paczkomat POZ08A' };
    const pickupB: OrderPickupPoint = { id: 'POZ09B', name: 'Paczkomat POZ09B' };

    await provisioner.resolveOrCreateAddress(
      'ol_customer_1',
      '42',
      baseAddress,
      'shipping',
      'conn-ps-1',
      webserviceClient,
      config,
      projectionRepo,
      pickupA,
    );
    await provisioner.resolveOrCreateAddress(
      'ol_customer_1',
      '42',
      baseAddress,
      'shipping',
      'conn-ps-1',
      webserviceClient,
      config,
      projectionRepo,
      pickupB,
    );

    expect(upsertedHashes).toHaveLength(2);
    expect(upsertedHashes[0]).not.toBe(upsertedHashes[1]);
  });

  it('preserves original address2 when no pickupPoint is provided', async () => {
    const addressWithApt: Address = { ...baseAddress, address2: 'Apt 5B' };

    await provisioner.resolveOrCreateAddress(
      'ol_customer_1',
      '42',
      addressWithApt,
      'shipping',
      'conn-ps-1',
      webserviceClient,
      config,
      projectionRepo,
      // pickupPoint omitted
    );

    expect(createCalls).toHaveLength(1);
    expect(createCalls[0].address2).toBe('Apt 5B');
  });
});
