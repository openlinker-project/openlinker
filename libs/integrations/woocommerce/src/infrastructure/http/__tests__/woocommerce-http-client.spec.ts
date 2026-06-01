/**
 * WooCommerce HTTP Client — unit tests
 *
 * Stubs `global.fetch` to verify Basic Auth header generation, siteUrl
 * normalisation, and the HTTP status → error mapping. At scaffold stage the
 * client performs a single attempt with no retry loop; retry behaviour is
 * tested in #874 alongside typed domain exceptions.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/http/__tests__
 */
import { WooCommerceHttpClient } from '../woocommerce-http-client';

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
  describe('constructor — siteUrl normalisation', () => {
    it('should strip a trailing slash from siteUrl', async () => {
      const fetchStub = makeFetchStub(200);
      jest.spyOn(global, 'fetch').mockImplementation(fetchStub);

      const client = new WooCommerceHttpClient(`${SITE_URL}/`, CONSUMER_KEY, CONSUMER_SECRET);
      await client.get('/wp-json/wc/v3/products?per_page=1');

      expect(fetchStub).toHaveBeenCalledWith(
        `${SITE_URL}/wp-json/wc/v3/products?per_page=1`,
        expect.anything(),
      );
    });

    it('should strip multiple trailing slashes from siteUrl', async () => {
      const fetchStub = makeFetchStub(200);
      jest.spyOn(global, 'fetch').mockImplementation(fetchStub);

      const client = new WooCommerceHttpClient(`${SITE_URL}///`, CONSUMER_KEY, CONSUMER_SECRET);
      await client.get('/test');

      expect(fetchStub).toHaveBeenCalledWith(`${SITE_URL}/test`, expect.anything());
    });

    it('should preserve siteUrl without trailing slash unchanged', async () => {
      const fetchStub = makeFetchStub(200);
      jest.spyOn(global, 'fetch').mockImplementation(fetchStub);

      const client = new WooCommerceHttpClient(SITE_URL, CONSUMER_KEY, CONSUMER_SECRET);
      await client.get('/wp-json/wc/v3/products?per_page=1');

      expect(fetchStub).toHaveBeenCalledWith(
        `${SITE_URL}/wp-json/wc/v3/products?per_page=1`,
        expect.anything(),
      );
    });
  });

  describe('Basic Auth header', () => {
    it('should generate correct Basic Auth header from consumerKey and consumerSecret', async () => {
      const fetchStub = makeFetchStub(200);
      jest.spyOn(global, 'fetch').mockImplementation(fetchStub);

      const client = new WooCommerceHttpClient(SITE_URL, CONSUMER_KEY, CONSUMER_SECRET);
      await client.get('/test');

      const [, init] = fetchStub.mock.calls[0] as [string, RequestInit];
      expect((init.headers as Record<string, string>)['Authorization']).toBe(
        expectedAuthHeader(CONSUMER_KEY, CONSUMER_SECRET),
      );
    });

    it('should include Accept: application/json header', async () => {
      const fetchStub = makeFetchStub(200);
      jest.spyOn(global, 'fetch').mockImplementation(fetchStub);

      const client = new WooCommerceHttpClient(SITE_URL, CONSUMER_KEY, CONSUMER_SECRET);
      await client.get('/test');

      const [, init] = fetchStub.mock.calls[0] as [string, RequestInit];
      expect((init.headers as Record<string, string>)['Accept']).toBe('application/json');
    });
  });

  describe('get()', () => {
    it('should return parsed JSON body on 200 response', async () => {
      const body = [{ id: 1, name: 'Test Product' }];
      jest.spyOn(global, 'fetch').mockImplementation(makeFetchStub(200, body));

      const client = new WooCommerceHttpClient(SITE_URL, CONSUMER_KEY, CONSUMER_SECRET);
      const result = await client.get<typeof body>('/wp-json/wc/v3/products?per_page=1');

      expect(result).toEqual(body);
    });

    it('should throw with statusCode 401 on 401 response', async () => {
      jest.spyOn(global, 'fetch').mockImplementation(makeFetchStub(401));

      const client = new WooCommerceHttpClient(SITE_URL, CONSUMER_KEY, CONSUMER_SECRET);

      await expect(client.get('/test')).rejects.toMatchObject({ statusCode: 401 });
    });

    it('should throw with statusCode 404 on 404 response', async () => {
      jest.spyOn(global, 'fetch').mockImplementation(makeFetchStub(404));

      const client = new WooCommerceHttpClient(SITE_URL, CONSUMER_KEY, CONSUMER_SECRET);

      await expect(client.get('/test')).rejects.toMatchObject({ statusCode: 404 });
    });

    it('should throw with statusCode 500 on 500 response', async () => {
      jest.spyOn(global, 'fetch').mockImplementation(makeFetchStub(500));

      const client = new WooCommerceHttpClient(SITE_URL, CONSUMER_KEY, CONSUMER_SECRET);

      await expect(client.get('/test')).rejects.toMatchObject({ statusCode: 500 });
    });

    it('should propagate network errors from fetch', async () => {
      const networkError = new Error('Network failure');
      jest.spyOn(global, 'fetch').mockRejectedValue(networkError);

      const client = new WooCommerceHttpClient(SITE_URL, CONSUMER_KEY, CONSUMER_SECRET);

      await expect(client.get('/test')).rejects.toThrow('Network failure');
    });
  });
});
