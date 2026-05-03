/**
 * PrestaShop Customer Provisioner Tests — guest-customer group (#505)
 *
 * Focused on the customer-create body shape: PS WS validates the order's
 * `id_carrier` against the customer's groups at POST /orders time, so OL
 * must explicitly set `id_default_group` AND populate the `associations`
 * block (the join-table source). Without these the customer lands in
 * group 0 only and any group-restricted carrier silently rejects the order.
 *
 * The full provisioner suite would also cover the lock/retry concurrency
 * behaviour (#338-era), but that's a separate concern from the body shape;
 * this spec scopes itself to the create-body assertion that closes #505.
 *
 * @module libs/integrations/prestashop/src/infrastructure/provisioners/__tests__
 */
import { PrestashopCustomerProvisioner } from '../prestashop-customer-provisioner';
import { IPrestashopWebserviceClient } from '../../http/prestashop-webservice.client.interface';
import { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { PrestashopConnectionConfig } from '../../../domain/types/prestashop-config.types';

describe('PrestashopCustomerProvisioner — resolveOrCreateGuestCustomer (#505)', () => {
  let provisioner: PrestashopCustomerProvisioner;
  let webserviceClient: jest.Mocked<IPrestashopWebserviceClient>;
  let identifierMapping: jest.Mocked<IdentifierMappingPort>;
  let createCalls: Array<{ resource: string; data: Record<string, unknown> }>;

  beforeEach(() => {
    // Redis client null → graceful degradation path (no actual locking).
    provisioner = new PrestashopCustomerProvisioner(null);

    createCalls = [];
    webserviceClient = {
      listResources: jest.fn().mockResolvedValue([]),
      createResource: jest.fn((resource: string, data: unknown) => {
        createCalls.push({ resource, data: data as Record<string, unknown> });
        return Promise.resolve({ id: '999' } as unknown);
      }),
      getResource: jest.fn(),
      updateResource: jest.fn(),
      deleteResource: jest.fn(),
    } as unknown as jest.Mocked<IPrestashopWebserviceClient>;

    identifierMapping = {
      getExternalIds: jest.fn().mockResolvedValue([]),
      getOrCreateExactMapping: jest.fn().mockResolvedValue('999'),
    } as unknown as jest.Mocked<IdentifierMappingPort>;
  });

  function captureCustomerCreateBody(): Record<string, unknown> {
    const call = createCalls.find((c) => c.resource === 'customers');
    if (!call) {
      throw new Error('No customers create call captured');
    }
    return call.data;
  }

  it('defaults id_default_group to 2 (PS Guest) and populates associations.groups when guestCustomerGroupId is unset', async () => {
    const config: PrestashopConnectionConfig = { baseUrl: 'https://shop.test' };

    await provisioner.resolveOrCreateGuestCustomer(
      'ol_customer_test_1',
      'buyer@example.com',
      'hash_1',
      'Piotr',
      'Swierzy',
      'connection-1',
      webserviceClient,
      config,
      identifierMapping,
    );

    const body = captureCustomerCreateBody();
    expect(body).toEqual(
      expect.objectContaining({
        is_guest: 1,
        active: 1,
        email: 'buyer@example.com',
        id_default_group: 2,
        associations: {
          groups: { group: [{ id: 2 }] },
        },
      }),
    );
  });

  it('honours connection.config.guestCustomerGroupId override on both id_default_group and associations.groups', async () => {
    const config: PrestashopConnectionConfig = {
      baseUrl: 'https://shop.test',
      guestCustomerGroupId: 5,
    };

    await provisioner.resolveOrCreateGuestCustomer(
      'ol_customer_test_2',
      'buyer2@example.com',
      'hash_2',
      'Piotr',
      'Swierzy',
      'connection-2',
      webserviceClient,
      config,
      identifierMapping,
    );

    const body = captureCustomerCreateBody();
    expect(body).toEqual(
      expect.objectContaining({
        is_guest: 1,
        id_default_group: 5,
        associations: {
          groups: { group: [{ id: 5 }] },
        },
      }),
    );
  });

  // Defensive guard is `Number.isFinite(x) && x > 0`. Parametrize across
  // the three realistic operator-misconfig values (zero, negative, NaN) so
  // a future refactor that drops one branch fails the suite.
  it.each<[string, number]>([
    ['zero', 0],
    ['negative', -1],
    ['NaN', Number.NaN],
  ])(
    'falls back to 2 with a warn when guestCustomerGroupId is invalid (%s)',
    async (label, badValue) => {
      const warnSpy = jest
        .spyOn(
          (provisioner as unknown as { logger: { warn: (m: string) => void } }).logger,
          'warn',
        )
        .mockImplementation(() => {});

      const config: PrestashopConnectionConfig = {
        baseUrl: 'https://shop.test',
        guestCustomerGroupId: badValue,
      };

      await provisioner.resolveOrCreateGuestCustomer(
        `ol_customer_test_invalid_${label}`,
        `buyer-${label}@example.com`,
        `hash_${label}`,
        'Piotr',
        'Swierzy',
        `connection-${label}`,
        webserviceClient,
        config,
        identifierMapping,
      );

      const body = captureCustomerCreateBody();
      expect(body).toEqual(
        expect.objectContaining({
          is_guest: 1,
          id_default_group: 2,
          associations: {
            groups: { group: [{ id: 2 }] },
          },
        }),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/invalid guestCustomerGroupId=.*falling back/i),
      );

      warnSpy.mockRestore();

      // Reset the captured-body queue between iterations so the next case
      // doesn't read the previous case's body.
      createCalls.length = 0;
      webserviceClient.createResource.mockClear();
      identifierMapping.getOrCreateExactMapping.mockClear();
    },
  );
});
