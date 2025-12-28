/**
 * PrestaShop WebService Client Tests
 *
 * Unit tests for PrestashopWebserviceClient. Tests HTTP requests, authentication,
 * retry logic, error handling, and response parsing.
 *
 * @module libs/integrations/prestashop/src/infrastructure/http/__tests__
 */
import { PrestashopWebserviceClient } from '../prestashop-webservice.client';
import {
  PrestashopConnectionConfig,
  PrestashopCredentials,
  PrestashopAuthenticationException,
  PrestashopResourceNotFoundException,
  PrestashopApiException,
} from '@openlinker/integrations-prestashop';

// Mock fetch globally
global.fetch = jest.fn();

describe('PrestashopWebserviceClient', () => {
  let client: PrestashopWebserviceClient;
  let baseUrl: string;
  let credentials: PrestashopCredentials;
  let config: PrestashopConnectionConfig;

  beforeEach(() => {
    baseUrl = 'https://shop.example.com';
    credentials = {
      webserviceApiKey: 'test-api-key-12345',
    };
    config = {
      baseUrl: baseUrl,
      timeoutMs: 30000,
      pageSize: 100,
      langId: 1,
      responseFormat: 'auto',
    };

    client = new PrestashopWebserviceClient(baseUrl, credentials, config);
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should normalize baseUrl by removing trailing slash', () => {
      const clientWithSlash = new PrestashopWebserviceClient(
        'https://shop.example.com/',
        credentials,
        config,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((clientWithSlash as any).baseUrl).toBe('https://shop.example.com');
    });

    it('should use default config values', () => {
      const minimalConfig: PrestashopConnectionConfig = {
        baseUrl: baseUrl,
      };
      const clientWithDefaults = new PrestashopWebserviceClient(
        baseUrl,
        credentials,
        minimalConfig,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((clientWithDefaults as any).config.timeoutMs).toBe(30000);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((clientWithDefaults as any).config.pageSize).toBe(100);
    });

    it('should override default config values', () => {
      const customConfig: PrestashopConnectionConfig = {
        baseUrl: baseUrl,
        timeoutMs: 60000,
        pageSize: 50,
        langId: 2,
      };
      const clientWithCustom = new PrestashopWebserviceClient(baseUrl, credentials, customConfig);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((clientWithCustom as any).config.timeoutMs).toBe(60000);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((clientWithCustom as any).config.pageSize).toBe(50);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((clientWithCustom as any).config.langId).toBe(2);
    });
  });

  describe('getResource', () => {
    it('should fetch a single resource successfully', async () => {
      const mockResponse = {
        prestashop: {
          product: {
            id: '1',
            name: 'Test Product',
          },
        },
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const result = await client.getResource('products', '1');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://shop.example.com/api/products/1',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        expect.objectContaining({
          method: 'GET',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          headers: expect.objectContaining({
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            get: expect.any(Function),
          }),
        }),
      );

      expect(result).toBeDefined();
    });

    it('should include Basic Auth header', async () => {
      const mockResponse = {
        prestashop: { product: { id: '1' } },
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      await client.getResource('products', '1');

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      const headers = fetchCall[1].headers as Headers;

      expect(headers.get('Authorization')).toBe('Basic dGVzdC1hcGkta2V5LTEyMzQ1Og==');
      expect(headers.get('Output-Format')).toBe('JSON');
    });

    it('should throw PrestashopResourceNotFoundException for 404', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers(),
        text: () => Promise.resolve('Not Found'),
      });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      await expect(client.getResource('products', '999')).rejects.toThrow(
        PrestashopResourceNotFoundException,
      );
    });

    it('should throw PrestashopAuthenticationException for 401', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers(),
        text: () => Promise.resolve('Unauthorized'),
      });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      await expect(client.getResource('products', '1')).rejects.toThrow(
        PrestashopAuthenticationException,
      );
    });

    it('should throw PrestashopApiException for 500', async () => {
      // Disable retries for error-handling tests
      const clientNoRetry = new PrestashopWebserviceClient(baseUrl, credentials, config, {
        maxRetries: 0,
      });

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers(),
        text: () => Promise.resolve('Internal Server Error'),
      });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      await expect(clientNoRetry.getResource('products', '1')).rejects.toThrow(PrestashopApiException);
    });
  });

  describe('listResources', () => {
    it('should list resources successfully', async () => {
      const mockResponse = {
        prestashop: {
          products: {
            product: [
              { id: '1', name: 'Product 1' },
              { id: '2', name: 'Product 2' },
            ],
          },
        },
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const result = await client.listResources('products');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('https://shop.example.com/api/products'),
        expect.any(Object),
      );

      expect(Array.isArray(result)).toBe(true);
    });

    it('should include pagination parameters', async () => {
      const mockResponse = {
        prestashop: { products: { product: [] } },
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      await client.listResources('products', undefined, 50, 100);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      const url = fetchCall[0] as string;

      expect(url).toContain('limit=50');
      expect(url).toContain('offset=100');
    });

    it('should use default page size when limit not provided', async () => {
      const mockResponse = {
        prestashop: { products: { product: [] } },
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      await client.listResources('products');

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      const url = fetchCall[0] as string;

      expect(url).toContain('limit=100'); // Default page size
    });

    it('should normalize collection response to array', async () => {
      const mockResponse = {
        prestashop: {
          products: {
            product: [{ id: '1' }],
          },
        },
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const result = await client.listResources('products');

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
      expect(result[0]).toHaveProperty('id', '1');
    });

    it('should handle single item in collection', async () => {
      const mockResponse = {
        prestashop: {
          products: {
            product: { id: '1', name: 'Single Product' }, // Single object, not array
          },
        },
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const result = await client.listResources('products');

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
      expect(result[0]).toHaveProperty('id', '1');
      expect(result[0]).toHaveProperty('name', 'Single Product');
    });
  });

  describe('retry logic', () => {
    it('should retry on server errors (5xx)', async () => {
      const mockResponse = {
        prestashop: { products: { product: [] } },
      };

      // First two attempts fail with 500, third succeeds
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          headers: new Headers(),
          text: () => Promise.resolve('Server Error'),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          headers: new Headers(),
          text: () => Promise.resolve('Server Error'),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockResponse)),
        });

      // Use real timers with zero delay to avoid hanging
      jest.useRealTimers();

      const clientWithFastRetry = new PrestashopWebserviceClient(baseUrl, credentials, config, {
        maxRetries: 2, // 2 retries = 3 total attempts
        initialDelayMs: 0, // Zero delay - instant retry for test
        maxDelayMs: 1000,
        backoffMultiplier: 2,
      });

      try {
        const result = await clientWithFastRetry.listResources('products');

        expect(global.fetch).toHaveBeenCalledTimes(3);
        expect(Array.isArray(result)).toBe(true);
      } finally {
        // Restore fake timers
        jest.useFakeTimers();
      }
    });

    it('should not retry on client errors (4xx)', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: new Headers(),
        text: () => Promise.resolve('Bad Request'),
      });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      await expect(client.listResources('products')).rejects.toThrow(PrestashopApiException);

      expect(global.fetch).toHaveBeenCalledTimes(1); // No retry
    });

    it('should retry on 429 (rate limit)', async () => {
      const mockResponse = {
        prestashop: { products: { product: [] } },
      };

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: new Headers(),
          text: () => Promise.resolve('Too Many Requests'),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockResponse)),
        });

      // Use real timers with zero delay to avoid hanging
      jest.useRealTimers();

      const clientWithFastRetry = new PrestashopWebserviceClient(baseUrl, credentials, config, {
        maxRetries: 1,
        initialDelayMs: 0, // Zero delay - instant retry for test
        maxDelayMs: 1000,
        backoffMultiplier: 2,
      });

      try {
        await clientWithFastRetry.listResources('products');

        expect(global.fetch).toHaveBeenCalledTimes(2);
      } finally {
        // Restore fake timers
        jest.useFakeTimers();
      }
    });

    it('should not retry on authentication errors', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers(),
        text: () => Promise.resolve('Unauthorized'),
      });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      await expect(client.listResources('products')).rejects.toThrow(
        PrestashopAuthenticationException,
      );

      expect(global.fetch).toHaveBeenCalledTimes(1); // No retry
    });

    it('should not retry on not found errors', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers(),
        text: () => Promise.resolve('Not Found'),
      });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      await expect(client.getResource('products', '999')).rejects.toThrow(
        PrestashopResourceNotFoundException,
      );

      expect(global.fetch).toHaveBeenCalledTimes(1); // No retry
    });

    it('should retry on server errors', async () => {
      const mockResponse = {
        prestashop: { products: { product: [] } },
      };

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          headers: new Headers(),
          text: () => Promise.resolve('Server Error'),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockResponse)),
        });

      // Use real timers with zero delay to avoid hanging
      jest.useRealTimers();

      const clientWithFastRetry = new PrestashopWebserviceClient(baseUrl, credentials, config, {
        maxRetries: 1, // Only 1 retry for faster test
        initialDelayMs: 0, // Zero delay - instant retry for test
        maxDelayMs: 1000,
        backoffMultiplier: 2,
      });

      try {
        const result = await clientWithFastRetry.listResources('products');

        // Verify the result and that retry happened
        expect(result).toBeDefined();
        expect(global.fetch).toHaveBeenCalledTimes(2); // Initial + retry
      } finally {
        // Restore fake timers
        jest.useFakeTimers();
      }
    });
  });

  describe('timeout handling', () => {
    it('should abort request after timeout', async () => {
      // Disable retries for timeout test
      const clientWithShortTimeout = new PrestashopWebserviceClient(
        baseUrl,
        credentials,
        {
          ...config,
          timeoutMs: 50,
        },
        {
          maxRetries: 0,
        },
      );

      // Simulate timeout by immediately rejecting with AbortError
      (global.fetch as jest.Mock).mockImplementationOnce(
        (_url: string, _options?: unknown) => {
          // Create an AbortError
          const abortError = new Error('The operation was aborted');
          abortError.name = 'AbortError';
          return Promise.reject(abortError);
        },
      );

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      await expect(clientWithShortTimeout.listResources('products')).rejects.toThrow(
        PrestashopApiException,
      );
    });
  });

  describe('error handling', () => {
    it('should handle network errors', async () => {
      // Disable retries for error-handling tests
      const clientNoRetry = new PrestashopWebserviceClient(baseUrl, credentials, config, {
        maxRetries: 0,
      });

      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      await expect(clientNoRetry.listResources('products')).rejects.toThrow(PrestashopApiException);
    });

    it('should include status code in error for 5xx', async () => {
      // Disable retries for error-handling tests
      const clientNoRetry = new PrestashopWebserviceClient(baseUrl, credentials, config, {
        maxRetries: 0,
      });

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 503,
        headers: new Headers(),
        text: () => Promise.resolve('Service Unavailable'),
      });

      try {
        await clientNoRetry.getResource('products', '1');
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(PrestashopApiException);
        if (error instanceof PrestashopApiException) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const apiError = error;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        expect(apiError.statusCode).toBe(503);
        }
      }
    });

    it('should truncate error body to 500 characters', async () => {
      // Disable retries for error-handling tests
      const clientNoRetry = new PrestashopWebserviceClient(baseUrl, credentials, config, {
        maxRetries: 0,
      });

      const longErrorBody = 'x'.repeat(1000);
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers(),
        text: () => Promise.resolve(longErrorBody),
      });

      try {
        await clientNoRetry.getResource('products', '1');
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(PrestashopApiException);
        if (error instanceof PrestashopApiException) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const apiError = error;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        expect(apiError.responseBody?.length).toBeLessThanOrEqual(500);
        }
      }
    });
  });

  describe('response format', () => {
    it('should prefer JSON format', async () => {
      const mockResponse = {
        prestashop: { product: { id: '1' } },
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      await client.getResource('products', '1');

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      const headers = fetchCall[1].headers as Headers;

      expect(headers.get('Output-Format')).toBe('JSON');
    });

    it('should handle XML response when JSON not available', async () => {
      const xmlResponse = `<?xml version="1.0"?>
        <prestashop>
          <product id="1">
            <name>Test Product</name>
          </product>
        </prestashop>`;

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/xml' }),
        text: () => Promise.resolve(xmlResponse),
      });

      const result = await client.getResource('products', '1');

      expect(result).toBeDefined();
    });
  });
});

