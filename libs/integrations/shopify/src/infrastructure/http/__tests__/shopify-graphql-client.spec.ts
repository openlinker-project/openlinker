import { ShopifyApiError } from '../../../domain/exceptions/shopify-api.error';
import { ShopifyGraphqlError } from '../../../domain/exceptions/shopify-graphql.error';
import { ShopifyUserErrorsException } from '../../../domain/exceptions/shopify-user-errors.exception';
import type { ShopifyAccessTokenProvider } from '../shopify-access-token.provider';
import { ShopifyGraphqlClient, type ShopifyThrottleMemo } from '../shopify-graphql-client';

const CONFIG = { storeDomain: 'my-shop.myshopify.com', apiVersion: '2026-10' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function tokens(renewable = true): jest.Mocked<Pick<ShopifyAccessTokenProvider, 'get' | 'invalidate'>> {
  return {
    get: jest.fn().mockResolvedValue({ token: 'tok', renewable }),
    invalidate: jest.fn().mockResolvedValue(undefined),
  };
}

function client(
  fetchImpl: jest.Mock,
  provider = tokens(),
  memo: ShopifyThrottleMemo = new Map(),
): ShopifyGraphqlClient {
  return new ShopifyGraphqlClient(CONFIG, provider as unknown as ShopifyAccessTokenProvider, fetchImpl, memo);
}

const COST = {
  cost: {
    requestedQueryCost: 10,
    throttleStatus: { maximumAvailable: 20000, currentlyAvailable: 19990, restoreRate: 1000 },
  },
};

describe('ShopifyGraphqlClient', () => {
  it('should POST the document to the versioned Admin API endpoint with the token header', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(json({ data: { shop: { name: 'S' } }, extensions: COST }));

    await expect(client(fetchImpl).query('{ shop { name } }')).resolves.toEqual({ shop: { name: 'S' } });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://my-shop.myshopify.com/admin/api/2026-10/graphql.json');
    expect((init.headers as Record<string, string>)['X-Shopify-Access-Token']).toBe('tok');
    expect(init.redirect).toBe('manual');
  });

  it('should record the throttle status Shopify reports for the store', async () => {
    const memo: ShopifyThrottleMemo = new Map();
    const fetchImpl = jest.fn().mockResolvedValue(json({ data: {}, extensions: COST }));

    await client(fetchImpl, tokens(), memo).query('{ a }');

    expect(memo.get('my-shop.myshopify.com')).toMatchObject({ lastQueryCost: 10 });
  });

  it('should renew a renewable token once after a 401', async () => {
    const provider = tokens(true);
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(json({ errors: 'Invalid' }, 401))
      .mockResolvedValueOnce(json({ data: { ok: true } }));

    await expect(client(fetchImpl, provider).query('{ ok }')).resolves.toEqual({ ok: true });
    expect(provider.invalidate).toHaveBeenCalledTimes(1);
  });

  it('should not retry a pre-issued token the API rejected', async () => {
    const provider = tokens(false);
    const fetchImpl = jest.fn().mockResolvedValue(json({}, 401));

    await expect(client(fetchImpl, provider).query('{ ok }')).rejects.toBeInstanceOf(ShopifyApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('should retry a THROTTLED answer once when the refill is short', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(
        json({
          errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }],
          extensions: {
            cost: {
              requestedQueryCost: 50,
              throttleStatus: { maximumAvailable: 20000, currentlyAvailable: 49, restoreRate: 1000 },
            },
          },
        }),
      )
      .mockResolvedValueOnce(json({ data: { ok: true } }));

    await expect(client(fetchImpl).query('{ ok }')).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('should surface a THROTTLED answer whose refill is long, for the runner to defer', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      json({
        errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }],
        extensions: {
          cost: {
            requestedQueryCost: 20000,
            throttleStatus: { maximumAvailable: 20000, currentlyAvailable: 0, restoreRate: 100 },
          },
        },
      }),
    );

    const error = await client(fetchImpl).query('{ big }').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ShopifyGraphqlError);
    expect((error as ShopifyGraphqlError).isThrottled()).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('should refuse a mutation that answered with user errors', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      json({ data: { orderCreate: { order: null, userErrors: [{ message: 'Too many attempts' }] } } }),
    );

    const error = await client(fetchImpl)
      .mutate('mutation { orderCreate }', {}, 'orderCreate')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ShopifyUserErrorsException);
    expect((error as ShopifyUserErrorsException).isRateLimited()).toBe(true);
  });
});
