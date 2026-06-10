/**
 * WooCommerce HTTP Client — unit tests
 *
 * Covers: Basic Auth, siteUrl normalisation, query params, retry behaviour,
 * typed exception mapping, and timeout/abort handling for all HTTP methods.
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

function makeClient(overrides?: Partial<{ maxRetries: number; initialDelayMs: number }>): WooCommerceHttpClient {
  return new WooCommerceHttpClient(SITE_URL, CONSUMER_KEY, CONSUMER_SECRET, {
    maxRetries: 0,
    initialDelayMs: 0,
    backoffMultiplier: 1,
    maxDelayMs: 0,
    ...overrides,
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

    it('should NOT claim retries in the message for a non-retryable 400', async () => {
      // 400 is non-retryable; the message must not say "after N retries".
      jest.spyOn(global, 'fetch').mockImplementation(
        makeFetchStub(400, { code: 'product_invalid_sku', message: 'Invalid or duplicated SKU.' }),
      );
      const client = new WooCommerceHttpClient(SITE_URL, CONSUMER_KEY, CONSUMER_SECRET, {
        maxRetries: 3,
      });
      const err = await client.post('/test', {}).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(WooCommerceHttpResponseException);
      expect((err as WooCommerceHttpResponseException).statusCode).toBe(400);
      expect((err as WooCommerceHttpResponseException).message).not.toContain('retries');
      // Only one attempt — no retry happened.
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should expose the WC error code from the response body on errorCode', async () => {
      jest.spyOn(global, 'fetch').mockImplementation(
        makeFetchStub(400, { code: 'product_invalid_sku', message: 'Invalid or duplicated SKU.' }),
      );
      const client = makeClient();
      const err = await client.post('/test', {}).catch((e: unknown) => e);
      expect((err as WooCommerceHttpResponseException).errorCode).toBe('product_invalid_sku');
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

  // ─── Write methods ─────────────────────────────────────────────────────────

  describe('post', () => {
    it('should send POST with JSON body and Content-Type header', async () => {
      const stub = makeFetchStub(201, { id: 10 });
      jest.spyOn(global, 'fetch').mockImplementation(stub);
      const client = makeClient();
      const body = { name: 'New Product', sku: 'SKU-1' };
      await client.post('/wp-json/wc/v3/products', body);
      const [url, init] = stub.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${SITE_URL}/wp-json/wc/v3/products`);
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
      expect(init.body).toBe(JSON.stringify(body));
    });

    it('should return parsed JSON on success', async () => {
      const response = { id: 10, name: 'New Product' };
      jest.spyOn(global, 'fetch').mockImplementation(makeFetchStub(201, response));
      const client = makeClient();
      const result = await client.post<typeof response>('/wp-json/wc/v3/products', {});
      expect(result).toEqual(response);
    });

    it('should throw WooCommerceUnauthorizedException on 401', async () => {
      jest.spyOn(global, 'fetch').mockImplementation(makeFetchStub(401));
      const client = makeClient();
      await expect(client.post('/test', {})).rejects.toBeInstanceOf(WooCommerceUnauthorizedException);
    });

    it('should throw WooCommerceHttpResponseException on 404', async () => {
      jest.spyOn(global, 'fetch').mockImplementation(makeFetchStub(404));
      const client = makeClient();
      const err = await client.post('/test', {}).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(WooCommerceHttpResponseException);
      expect((err as WooCommerceHttpResponseException).statusCode).toBe(404);
    });

    it('should retry on 5xx and succeed on second attempt', async () => {
      const stub = jest
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.resolve({}) })
        .mockResolvedValueOnce({ ok: true, status: 201, json: () => Promise.resolve({ id: 1 }) });
      jest.spyOn(global, 'fetch').mockImplementation(stub);
      const client = new WooCommerceHttpClient(SITE_URL, CONSUMER_KEY, CONSUMER_SECRET, {
        maxRetries: 1,
        initialDelayMs: 0,
        backoffMultiplier: 1,
        maxDelayMs: 0,
      });
      const result = await client.post('/test', {});
      expect(result).toEqual({ id: 1 });
      expect(stub).toHaveBeenCalledTimes(2);
    });

    it('should throw WooCommerceNetworkException on timeout', async () => {
      const abortError = new Error('The operation was aborted.');
      abortError.name = 'AbortError';
      jest.spyOn(global, 'fetch').mockRejectedValue(abortError);
      const client = makeClient();
      await expect(client.post('/test', {})).rejects.toBeInstanceOf(WooCommerceNetworkException);
    });
  });

  describe('put', () => {
    it('should send PUT with JSON body and Content-Type header', async () => {
      const stub = makeFetchStub(200, { id: 5 });
      jest.spyOn(global, 'fetch').mockImplementation(stub);
      const client = makeClient();
      const body = { name: 'Updated' };
      await client.put('/wp-json/wc/v3/products/5', body);
      const [url, init] = stub.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${SITE_URL}/wp-json/wc/v3/products/5`);
      expect(init.method).toBe('PUT');
      expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
      expect(init.body).toBe(JSON.stringify(body));
    });

    it('should return parsed JSON on success', async () => {
      const response = { id: 5, name: 'Updated' };
      jest.spyOn(global, 'fetch').mockImplementation(makeFetchStub(200, response));
      const client = makeClient();
      const result = await client.put<typeof response>('/wp-json/wc/v3/products/5', {});
      expect(result).toEqual(response);
    });

    it('should throw WooCommerceUnauthorizedException on 401', async () => {
      jest.spyOn(global, 'fetch').mockImplementation(makeFetchStub(401));
      const client = makeClient();
      await expect(client.put('/test', {})).rejects.toBeInstanceOf(WooCommerceUnauthorizedException);
    });

    it('should throw WooCommerceHttpResponseException on 404', async () => {
      jest.spyOn(global, 'fetch').mockImplementation(makeFetchStub(404));
      const client = makeClient();
      const err = await client.put('/test', {}).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(WooCommerceHttpResponseException);
      expect((err as WooCommerceHttpResponseException).statusCode).toBe(404);
    });

    it('should throw WooCommerceNetworkException on timeout', async () => {
      const abortError = new Error('The operation was aborted.');
      abortError.name = 'AbortError';
      jest.spyOn(global, 'fetch').mockRejectedValue(abortError);
      const client = makeClient();
      await expect(client.put('/test', {})).rejects.toBeInstanceOf(WooCommerceNetworkException);
    });
  });

  describe('delete', () => {
    it('should send DELETE request to correct URL', async () => {
      const stub = makeFetchStub(200, { id: 5, status: 'trash' });
      jest.spyOn(global, 'fetch').mockImplementation(stub);
      const client = makeClient();
      await client.delete('/wp-json/wc/v3/products/5');
      const [url, init] = stub.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${SITE_URL}/wp-json/wc/v3/products/5`);
      expect(init.method).toBe('DELETE');
    });

    it('should append query params when provided', async () => {
      const stub = makeFetchStub(200, {});
      jest.spyOn(global, 'fetch').mockImplementation(stub);
      const client = makeClient();
      await client.delete('/wp-json/wc/v3/products/5', { force: true });
      const [url] = stub.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('force=true');
    });

    it('should return parsed JSON on success', async () => {
      const response = { id: 5, status: 'trash' };
      jest.spyOn(global, 'fetch').mockImplementation(makeFetchStub(200, response));
      const client = makeClient();
      const result = await client.delete<typeof response>('/wp-json/wc/v3/products/5');
      expect(result).toEqual(response);
    });

    it('should throw WooCommerceUnauthorizedException on 401', async () => {
      jest.spyOn(global, 'fetch').mockImplementation(makeFetchStub(401));
      const client = makeClient();
      await expect(client.delete('/test')).rejects.toBeInstanceOf(WooCommerceUnauthorizedException);
    });

    it('should throw WooCommerceHttpResponseException on 404', async () => {
      jest.spyOn(global, 'fetch').mockImplementation(makeFetchStub(404));
      const client = makeClient();
      const err = await client.delete('/test').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(WooCommerceHttpResponseException);
      expect((err as WooCommerceHttpResponseException).statusCode).toBe(404);
    });

    it('should throw WooCommerceNetworkException on timeout', async () => {
      const abortError = new Error('The operation was aborted.');
      abortError.name = 'AbortError';
      jest.spyOn(global, 'fetch').mockRejectedValue(abortError);
      const client = makeClient();
      await expect(client.delete('/test')).rejects.toBeInstanceOf(WooCommerceNetworkException);
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
