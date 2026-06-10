/**
 * WooCommerce HTTP Client — unit tests
 *
 * Covers: Basic Auth, siteUrl normalisation, query params, retry behaviour,
 * typed exception mapping, and timeout/abort handling.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/http/__tests__
 */
import { WooCommerceHttpClient } from '../woocommerce-http-client';
import { WooCommerceUnauthorizedException } from '../../../domain/exceptions/woocommerce-unauthorized.exception';
import { WooCommerceNetworkException } from '../../../domain/exceptions/woocommerce-network.exception';
import { WooCommerceHttpResponseException } from '../woocommerce-http-response.exception';

const CONSUMER_KEY = 'ck_abc123';
const CONSUMER_SECRET = 'cs_xyz789';
const SITE_URL = 'https://myshop.com';

function expectedAuthHeader(key: string, secret: string): string {
  return 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64');
}

function makeFetchStub(status: number, body: unknown = {}): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

describe('WooCommerceHttpClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('siteUrl normalisation', () => {
    it('should strip a trailing slash', async () => {
      const stub = makeFetchStub(200);
      jest.spyOn(global, 'fetch').mockImplementation(stub);
      const client = new WooCommerceHttpClient(`${SITE_URL}/`, CONSUMER_KEY, CONSUMER_SECRET);
      await client.get('/wp-json/wc/v3/products');
      expect(stub).toHaveBeenCalledWith(
        `${SITE_URL}/wp-json/wc/v3/products`,
        expect.anything(),
      );
    });

    it('should strip multiple trailing slashes', async () => {
      const stub = makeFetchStub(200);
      jest.spyOn(global, 'fetch').mockImplementation(stub);
      const client = new WooCommerceHttpClient(`${SITE_URL}///`, CONSUMER_KEY, CONSUMER_SECRET);
      await client.get('/test');
      expect(stub).toHaveBeenCalledWith(`${SITE_URL}/test`, expect.anything());
    });
  });

  describe('Basic Auth header', () => {
    it('should generate correct Basic Auth header', async () => {
      const stub = makeFetchStub(200);
      jest.spyOn(global, 'fetch').mockImplementation(stub);
      const client = new WooCommerceHttpClient(SITE_URL, CONSUMER_KEY, CONSUMER_SECRET);
      await client.get('/test');
      const [, init] = stub.mock.calls[0] as [string, RequestInit];
      expect((init.headers as Record<string, string>)['Authorization']).toBe(
        expectedAuthHeader(CONSUMER_KEY, CONSUMER_SECRET),
      );
    });

    it('should include Accept: application/json header', async () => {
      const stub = makeFetchStub(200);
      jest.spyOn(global, 'fetch').mockImplementation(stub);
      const client = new WooCommerceHttpClient(SITE_URL, CONSUMER_KEY, CONSUMER_SECRET);
      await client.get('/test');
      const [, init] = stub.mock.calls[0] as [string, RequestInit];
      expect((init.headers as Record<string, string>)['Accept']).toBe('application/json');
    });
  });

  describe('query params', () => {
    it('should append params as query string', async () => {
      const stub = makeFetchStub(200);
      jest.spyOn(global, 'fetch').mockImplementation(stub);
      const client = new WooCommerceHttpClient(SITE_URL, CONSUMER_KEY, CONSUMER_SECRET);
      await client.get('/wp-json/wc/v3/products', { per_page: 100, page: 1 });
      const [url] = stub.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('per_page=100');
      expect(url).toContain('page=1');
    });

    it('should append with & when path already contains ?', async () => {
      const stub = makeFetchStub(200);
      jest.spyOn(global, 'fetch').mockImplementation(stub);
      const client = new WooCommerceHttpClient(SITE_URL, CONSUMER_KEY, CONSUMER_SECRET);
      await client.get('/wp-json/wc/v3/products?status=publish', { per_page: 10 });
      const [url] = stub.mock.calls[0] as [string, RequestInit];
      expect(url).toMatch(/\?status=publish&per_page=10/);
    });

    it('should not append query string when params is undefined', async () => {
      const stub = makeFetchStub(200);
      jest.spyOn(global, 'fetch').mockImplementation(stub);
      const client = new WooCommerceHttpClient(SITE_URL, CONSUMER_KEY, CONSUMER_SECRET);
      await client.get('/wp-json/wc/v3/products');
      const [url] = stub.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${SITE_URL}/wp-json/wc/v3/products`);
    });
  });

  describe('successful response', () => {
    it('should return parsed JSON body on 200', async () => {
      const body = [{ id: 1, name: 'Test Product' }];
      jest.spyOn(global, 'fetch').mockImplementation(makeFetchStub(200, body));
      const client = new WooCommerceHttpClient(SITE_URL, CONSUMER_KEY, CONSUMER_SECRET);
      const result = await client.get<typeof body>('/wp-json/wc/v3/products');
      expect(result).toEqual(body);
    });
  });

  describe('typed exceptions', () => {
    it('should throw WooCommerceUnauthorizedException on 401', async () => {
      jest.spyOn(global, 'fetch').mockImplementation(makeFetchStub(401));
      const client = new WooCommerceHttpClient(SITE_URL, CONSUMER_KEY, CONSUMER_SECRET, {
        maxRetries: 0,
      });
      await expect(client.get('/test')).rejects.toBeInstanceOf(WooCommerceUnauthorizedException);
    });

    it('should throw WooCommerceUnauthorizedException on 403', async () => {
      jest.spyOn(global, 'fetch').mockImplementation(makeFetchStub(403));
      const client = new WooCommerceHttpClient(SITE_URL, CONSUMER_KEY, CONSUMER_SECRET, {
        maxRetries: 0,
      });
      await expect(client.get('/test')).rejects.toBeInstanceOf(WooCommerceUnauthorizedException);
    });

    it('should throw WooCommerceHttpResponseException with statusCode 404 on 404', async () => {
      jest.spyOn(global, 'fetch').mockImplementation(makeFetchStub(404));
      const client = new WooCommerceHttpClient(SITE_URL, CONSUMER_KEY, CONSUMER_SECRET, {
        maxRetries: 0,
      });
      const err = await client.get('/test').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(WooCommerceHttpResponseException);
      expect((err as WooCommerceHttpResponseException).statusCode).toBe(404);
    });

    it('should throw WooCommerceNetworkException on AbortError', async () => {
      const abortError = new Error('The operation was aborted.');
      abortError.name = 'AbortError';
      jest.spyOn(global, 'fetch').mockRejectedValue(abortError);
      const client = new WooCommerceHttpClient(SITE_URL, CONSUMER_KEY, CONSUMER_SECRET, {
        maxRetries: 0,
      });
      await expect(client.get('/test')).rejects.toBeInstanceOf(WooCommerceNetworkException);
    });

    it('should throw WooCommerceHttpResponseException on 5xx after retries exhausted', async () => {
      jest.spyOn(global, 'fetch').mockImplementation(makeFetchStub(500));
      const client = new WooCommerceHttpClient(SITE_URL, CONSUMER_KEY, CONSUMER_SECRET, {
        maxRetries: 0,
      });
      const err = await client.get('/test').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(WooCommerceHttpResponseException);
      expect((err as WooCommerceHttpResponseException).statusCode).toBe(500);
    });
  });

  describe('retry behaviour', () => {
    it('should retry on 429 and succeed on second attempt', async () => {
      const stub = jest
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 429, json: () => Promise.resolve({}) })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: 1 }),
        });
      jest.spyOn(global, 'fetch').mockImplementation(stub);
      const client = new WooCommerceHttpClient(SITE_URL, CONSUMER_KEY, CONSUMER_SECRET, {
        maxRetries: 1,
        initialDelayMs: 0,
        backoffMultiplier: 1,
        maxDelayMs: 0,
      });
      const result = await client.get('/test');
      expect(result).toEqual({ id: 1 });
      expect(stub).toHaveBeenCalledTimes(2);
    });

    it('should retry on 500 and succeed on second attempt', async () => {
      const stub = jest
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.resolve({}) })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ ok: true }),
        });
      jest.spyOn(global, 'fetch').mockImplementation(stub);
      const client = new WooCommerceHttpClient(SITE_URL, CONSUMER_KEY, CONSUMER_SECRET, {
        maxRetries: 1,
        initialDelayMs: 0,
        backoffMultiplier: 1,
        maxDelayMs: 0,
      });
      await client.get('/test');
      expect(stub).toHaveBeenCalledTimes(2);
    });

    it('should NOT retry on 401', async () => {
      const stub = makeFetchStub(401);
      jest.spyOn(global, 'fetch').mockImplementation(stub);
      const client = new WooCommerceHttpClient(SITE_URL, CONSUMER_KEY, CONSUMER_SECRET, {
        maxRetries: 3,
        initialDelayMs: 0,
        backoffMultiplier: 1,
        maxDelayMs: 0,
      });
      await expect(client.get('/test')).rejects.toBeInstanceOf(WooCommerceUnauthorizedException);
      expect(stub).toHaveBeenCalledTimes(1);
    });

    it('should NOT retry on 404', async () => {
      const stub = makeFetchStub(404);
      jest.spyOn(global, 'fetch').mockImplementation(stub);
      const client = new WooCommerceHttpClient(SITE_URL, CONSUMER_KEY, CONSUMER_SECRET, {
        maxRetries: 3,
        initialDelayMs: 0,
        backoffMultiplier: 1,
        maxDelayMs: 0,
      });
      await expect(client.get('/test')).rejects.toBeInstanceOf(WooCommerceHttpResponseException);
      expect(stub).toHaveBeenCalledTimes(1);
    });

    it('should stop at maxRetries and throw WooCommerceHttpResponseException', async () => {
      const stub = makeFetchStub(500);
      jest.spyOn(global, 'fetch').mockImplementation(stub);
      const client = new WooCommerceHttpClient(SITE_URL, CONSUMER_KEY, CONSUMER_SECRET, {
        maxRetries: 2,
        initialDelayMs: 0,
        backoffMultiplier: 1,
        maxDelayMs: 0,
      });
      const err = await client.get('/test').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(WooCommerceHttpResponseException);
      expect((err as WooCommerceHttpResponseException).statusCode).toBe(500);
      expect(stub).toHaveBeenCalledTimes(3); // initial + 2 retries
    });

    it('should use maxRetries: 0 for single attempt with no retry', async () => {
      const stub = makeFetchStub(500);
      jest.spyOn(global, 'fetch').mockImplementation(stub);
      const client = new WooCommerceHttpClient(SITE_URL, CONSUMER_KEY, CONSUMER_SECRET, {
        maxRetries: 0,
        initialDelayMs: 0,
        backoffMultiplier: 1,
        maxDelayMs: 0,
      });
      const err = await client.get('/test').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(WooCommerceHttpResponseException);
      expect(stub).toHaveBeenCalledTimes(1);
    });
  });

  // ── SSRF redirect guard (#969) ─────────────────────────────────────────────

  describe('redirect SSRF guard', () => {
    function redirectResponse(status: number, location: string | null): unknown {
      return {
        ok: false,
        status,
        headers: { get: (name: string) => (name.toLowerCase() === 'location' ? location : null) },
        json: () => Promise.resolve({}),
      };
    }

    function okResponse(body: unknown = { ok: true }): unknown {
      return { ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve(body) };
    }

    function makeClient(): WooCommerceHttpClient {
      return new WooCommerceHttpClient(SITE_URL, CONSUMER_KEY, CONSUMER_SECRET, {
        maxRetries: 0,
        initialDelayMs: 0,
        backoffMultiplier: 1,
        maxDelayMs: 0,
      });
    }

    it('should reject a redirect to a private IP target', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue(
        redirectResponse(302, 'https://10.0.0.5/wp-json/wc/v3/products') as Response,
      );
      const client = makeClient();
      await expect(client.get('/wp-json/wc/v3/products')).rejects.toBeInstanceOf(
        WooCommerceNetworkException,
      );
    });

    it('should reject a redirect to a cleartext http target', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue(
        redirectResponse(301, 'http://attacker.example.com/') as Response,
      );
      const client = makeClient();
      await expect(client.get('/wp-json/wc/v3/products')).rejects.toBeInstanceOf(
        WooCommerceNetworkException,
      );
    });

    it('should reject a redirect to the cloud-metadata endpoint', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue(
        redirectResponse(307, 'https://169.254.169.254/latest/meta-data/') as Response,
      );
      const client = makeClient();
      await expect(client.get('/wp-json/wc/v3/products')).rejects.toBeInstanceOf(
        WooCommerceNetworkException,
      );
    });

    it('should reject a redirect with no Location header', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue(redirectResponse(302, null) as Response);
      const client = makeClient();
      await expect(client.get('/wp-json/wc/v3/products')).rejects.toBeInstanceOf(
        WooCommerceNetworkException,
      );
    });

    it('should follow a redirect to a safe public https target and return its body', async () => {
      const stub = jest
        .fn()
        .mockResolvedValueOnce(redirectResponse(302, 'https://other.example.com/wp-json/wc/v3/products'))
        .mockResolvedValueOnce(okResponse({ id: 1 }));
      jest.spyOn(global, 'fetch').mockImplementation(stub as unknown as typeof fetch);
      const client = makeClient();

      const result = await client.get<{ id: number }>('/wp-json/wc/v3/products');

      expect(result).toEqual({ id: 1 });
      expect(stub).toHaveBeenCalledTimes(2);
      expect(stub).toHaveBeenNthCalledWith(
        2,
        'https://other.example.com/wp-json/wc/v3/products',
        expect.objectContaining({ redirect: 'manual' }),
      );
    });

    it('should normal (non-redirect) requests still work', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue(okResponse({ id: 7 }) as Response);
      const client = makeClient();
      await expect(client.get<{ id: number }>('/wp-json/wc/v3/products/7')).resolves.toEqual({ id: 7 });
    });
  });
});
