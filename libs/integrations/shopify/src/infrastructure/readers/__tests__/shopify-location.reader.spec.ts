import type { Connection, ConnectionPort } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { HttpTransportFactoryPort } from '@openlinker/shared/http';

import { createShopifyClientRuntime } from '../../http/shopify-client.builder';
import { ShopifyLocationReader, toLocationSummaries } from '../shopify-location.reader';

function connection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-1',
    platformType: 'shopify',
    status: 'active',
    enabledCapabilities: ['InventoryMaster'],
    config: { storeDomain: 'my-shop.myshopify.com', locationId: 'not-a-location' },
    credentialsRef: 'db:cred-1',
    ...overrides,
  } as unknown as Connection;
}

function build(conn: Connection): { reader: ShopifyLocationReader; fetchImpl: jest.Mock } {
  const fetchImpl = jest.fn();
  const reader = new ShopifyLocationReader(
    { get: jest.fn().mockResolvedValue(conn) } as unknown as ConnectionPort,
    { get: jest.fn().mockResolvedValue({ accessToken: 'shpat_x' }) } as unknown as CredentialsResolverPort,
    { forConnection: jest.fn().mockReturnValue(fetchImpl) } as unknown as HttpTransportFactoryPort,
    createShopifyClientRuntime(),
  );
  return { reader, fetchImpl };
}

describe('toLocationSummaries', () => {
  it('should put the primary location first and name the rest in order', () => {
    expect(
      toLocationSummaries({
        location: { id: 'gid://shopify/Location/2' },
        locations: {
          nodes: [
            { id: 'gid://shopify/Location/3', name: 'Zielona', isActive: true },
            { id: 'gid://shopify/Location/1', name: 'Annex', isActive: true },
            { id: 'gid://shopify/Location/2', name: 'Main', isActive: true },
          ],
        },
      }),
    ).toEqual([
      { id: '2', name: 'Main', isActive: true, isPrimary: true },
      { id: '1', name: 'Annex', isActive: true, isPrimary: false },
      { id: '3', name: 'Zielona', isActive: true, isPrimary: false },
    ]);
  });
});

describe('ShopifyLocationReader', () => {
  it('should list the locations even when the stored location id is invalid', async () => {
    const { reader, fetchImpl } = build(connection());
    fetchImpl.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            location: { id: 'gid://shopify/Location/1' },
            locations: { nodes: [{ id: 'gid://shopify/Location/1', name: 'Main', isActive: true }] },
          },
        }),
        { status: 200 },
      ),
    );

    await expect(reader.listLocations('conn-1')).resolves.toEqual([
      { id: '1', name: 'Main', isActive: true, isPrimary: true },
    ]);
  });

  it('should refuse a connection of another platform before any request', async () => {
    const { reader, fetchImpl } = build(connection({ platformType: 'shoper' } as Partial<Connection>));

    await expect(reader.listLocations('conn-1')).rejects.toThrow(/not a Shopify connection/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
