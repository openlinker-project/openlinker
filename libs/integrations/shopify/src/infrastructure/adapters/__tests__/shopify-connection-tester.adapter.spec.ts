import type { Connection } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { HttpTransportFactoryPort } from '@openlinker/shared/http';

import { SHOPIFY_OPTIONAL_SCOPES, SHOPIFY_REQUIRED_SCOPES } from '../../../shopify.constants';
import { createShopifyClientRuntime } from '../../http/shopify-client.builder';
import { ShopifyConnectionTesterAdapter } from '../shopify-connection-tester.adapter';

const RATE_LIMIT = { requestsPerMinute: 240, maxConcurrent: 4 };

function connection(config: Record<string, unknown> = {}): Connection {
  return {
    id: 'conn-1',
    platformType: 'shopify',
    name: 'Shop',
    status: 'active',
    config: { storeDomain: 'my-shop.myshopify.com', ...config },
    credentialsRef: 'db:cred-1',
  } as unknown as Connection;
}

const SHOP_CONTEXT = {
  data: {
    shop: { id: 'gid://shopify/Shop/1', name: 'Dev Shop', myshopifyDomain: 'my-shop.myshopify.com', currencyCode: 'PLN', taxesIncluded: true },
    location: { id: 'gid://shopify/Location/1', name: 'Main', isActive: true },
    locations: {
      nodes: [
        { id: 'gid://shopify/Location/1', name: 'Main', isActive: true },
        { id: 'gid://shopify/Location/2', name: 'Back room', isActive: true },
      ],
    },
  },
};

function scopes(handles: readonly string[]): unknown {
  return { data: { currentAppInstallation: { accessScopes: handles.map((handle) => ({ handle })) } } };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function setup(
  fetchImpl: jest.Mock,
  credentials: unknown = { accessToken: 'shpat_x' },
): { tester: ShopifyConnectionTesterAdapter; resolver: CredentialsResolverPort; http: HttpTransportFactoryPort } {
  const http = { forConnection: jest.fn().mockReturnValue(fetchImpl) } as unknown as HttpTransportFactoryPort;
  const resolver = { get: jest.fn().mockResolvedValue(credentials) } as unknown as CredentialsResolverPort;
  const tester = new ShopifyConnectionTesterAdapter(http, RATE_LIMIT, undefined, createShopifyClientRuntime());
  return { tester, resolver, http };
}

describe('ShopifyConnectionTesterAdapter', () => {
  it('should report shop name, currency, tax mode and location through the store bucket', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(json(SHOP_CONTEXT))
      .mockResolvedValueOnce(json(scopes([...SHOPIFY_REQUIRED_SCOPES, ...SHOPIFY_OPTIONAL_SCOPES])));
    const { tester, resolver, http } = setup(fetchImpl);
    const conn = connection();

    const result = await tester.test(conn, resolver);

    expect(result).toMatchObject({
      success: true,
      message: 'OK - Dev Shop (PLN, prices include tax, location Main)',
    });
    expect(http.forConnection).toHaveBeenCalledWith(conn, RATE_LIMIT, {
      bucketKey: 'shopify:store:my-shop.myshopify.com',
    });
  });

  it('should pass but name a missing optional scope and what it switches off', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(json(SHOP_CONTEXT))
      .mockResolvedValueOnce(json(scopes(SHOPIFY_REQUIRED_SCOPES)));
    const { tester, resolver } = setup(fetchImpl);

    const result = await tester.test(connection(), resolver);

    expect(result.success).toBe(true);
    expect(result.message).toContain(
      'write_draft_orders (product tax rates are not read, and a store whose prices exclude tax reports no prices)',
    );
    expect(result.message).toContain('read_shipping (delivery methods are offered only as seen on recent orders)');
  });

  it('should report the configured location when one is set', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(json(SHOP_CONTEXT))
      .mockResolvedValueOnce(json(scopes(SHOPIFY_REQUIRED_SCOPES)));
    const { tester, resolver } = setup(fetchImpl);

    const result = await tester.test(connection({ locationId: '2' }), resolver);

    expect(result.message).toContain('location Back room');
  });

  it('should fail naming locationId when the shop does not list the configured location (K06)', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(json(SHOP_CONTEXT));
    const { tester, resolver } = setup(fetchImpl);

    const result = await tester.test(connection({ locationId: '999999999999' }), resolver);

    expect(result.success).toBe(false);
    expect(result.message).toContain('locationId');
  });

  it('should fail naming the scopes the app lacks', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(json(SHOP_CONTEXT))
      .mockResolvedValueOnce(json(scopes(['read_products'])));
    const { tester, resolver } = setup(fetchImpl);

    const result = await tester.test(connection(), resolver);

    expect(result.success).toBe(false);
    expect(result.message).toContain('read_inventory');
  });

  it.each([
    ['app_not_installed', 'not installed on this store'],
    ['shop_not_permitted', 'connect it with OAuth instead'],
    ['invalid_client', 'check both'],
  ])('should name the cause when the token grant answers %s (K02/K03/G03)', async (code, fragment) => {
    const fetchImpl = jest.fn().mockResolvedValue(json({ error: code }, 400));
    const { tester, resolver } = setup(fetchImpl, { clientId: 'id', clientSecret: 'secret' });

    const result = await tester.test(connection(), resolver);

    expect(result.success).toBe(false);
    expect(result.message).toContain(fragment);
  });

  it('should refuse an unsupported API version before any call', async () => {
    const fetchImpl = jest.fn();
    const { tester, resolver } = setup(fetchImpl);

    const result = await tester.test(connection({ apiVersion: '2026-13' }), resolver);

    expect(result.success).toBe(false);
    expect(result.message).toContain('apiVersion');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
