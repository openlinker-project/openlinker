/**
 * Amazon paced transport tests
 *
 * @module libs/integrations/amazon/src/infrastructure/http/__tests__
 */
import type { HttpTransportFactoryPort } from '@openlinker/shared/http';

import { createAmazonPacedFetch } from '../amazon-paced-transport';

function setup(): { http: HttpTransportFactoryPort; forConnection: jest.Mock; fetches: Map<string, jest.Mock> } {
  const fetches = new Map<string, jest.Mock>();
  const forConnection = jest.fn((_connection: unknown, _quota?: unknown, options?: { bucketKey?: string }) => {
    const key = options?.bucketKey ?? 'connection';
    const fetch = jest.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    fetches.set(key, fetch);
    return fetch;
  });
  return { http: { forConnection, evict: jest.fn() } as unknown as HttpTransportFactoryPort, forConnection, fetches };
}

describe('createAmazonPacedFetch', () => {
  const connection = { id: 'conn-amz' };
  const host = 'https://sellingpartnerapi-eu.amazon.com';

  it('should pace Catalog Items and Listings Items in their own buckets at Amazon quotas', () => {
    const { http, forConnection } = setup();

    createAmazonPacedFetch(http, connection);

    expect(forConnection).toHaveBeenCalledWith(connection);
    expect(forConnection).toHaveBeenCalledWith(
      connection,
      { requestsPerMinute: 120, maxConcurrent: 2 },
      { bucketKey: 'amazon:conn-amz:catalog' },
    );
    expect(forConnection).toHaveBeenCalledWith(
      connection,
      { requestsPerMinute: 300, maxConcurrent: 5 },
      { bucketKey: 'amazon:conn-amz:listings' },
    );
  });

  it('should route each request to the bucket of its operation group', async () => {
    const { http, fetches } = setup();
    const fetch = createAmazonPacedFetch(http, connection);

    await fetch(`${host}/catalog/2022-04-01/items?identifiers=1`);
    await fetch(`${host}/listings/2021-08-01/items/SELLER/SKU`, { method: 'PATCH' });
    await fetch(`${host}/orders/v0/orders`);
    await fetch('https://api.amazon.com/auth/o2/token', { method: 'POST' });

    expect(fetches.get('amazon:conn-amz:catalog')).toHaveBeenCalledTimes(1);
    expect(fetches.get('amazon:conn-amz:listings')).toHaveBeenCalledWith(
      `${host}/listings/2021-08-01/items/SELLER/SKU`,
      { method: 'PATCH' },
    );
    expect(fetches.get('connection')).toHaveBeenCalledTimes(2);
  });
});
