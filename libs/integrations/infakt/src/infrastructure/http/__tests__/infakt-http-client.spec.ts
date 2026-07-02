/**
 * Infakt HTTP Client — unit tests
 *
 * Stubs `global.fetch` to verify the `X-inFakt-ApiKey` header injection, JSON
 * serialize/deserialize on GET/POST, query-string building, and
 * `InfaktApiError` on non-2xx responses (including a non-JSON response body).
 *
 * @module libs/integrations/infakt/src/infrastructure/http/__tests__
 */
import type { LoggerPort } from '@openlinker/shared/logging';
import { InfaktApiError } from '../../../domain/exceptions/infakt-api.error';
import { InfaktHttpClient, INFAKT_DEFAULT_BASE_URL } from '../infakt-http-client';

function fakeResponse(status: number, body: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: (): Promise<string> => Promise.resolve(body),
  } as unknown as Response;
}

function fakeLogger(): jest.Mocked<LoggerPort> {
  return {
    log: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

const originalFetch = global.fetch;

describe('InfaktHttpClient', () => {
  let fetchMock: jest.Mock;
  let logger: jest.Mocked<LoggerPort>;
  let client: InfaktHttpClient;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    logger = fakeLogger();
    client = new InfaktHttpClient({ apiKey: 'test-api-key' }, logger);
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe('baseUrl resolution', () => {
    it('should default to INFAKT_DEFAULT_BASE_URL when no baseUrl is configured', async () => {
      fetchMock.mockResolvedValue(fakeResponse(200, '{}'));
      await client.get('invoices.json');
      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toBe(`${INFAKT_DEFAULT_BASE_URL}/invoices.json`);
    });

    it('should strip a trailing slash from a configured baseUrl', async () => {
      const sandboxClient = new InfaktHttpClient(
        { apiKey: 'k', baseUrl: 'https://api.sandbox.infakt.pl/api/v3/' },
        logger,
      );
      fetchMock.mockResolvedValue(fakeResponse(200, '{}'));
      await sandboxClient.get('invoices.json');
      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toBe('https://api.sandbox.infakt.pl/api/v3/invoices.json');
    });
  });

  describe('GET', () => {
    it('should attach the X-inFakt-ApiKey header', async () => {
      fetchMock.mockResolvedValue(fakeResponse(200, '{"uuid":"abc"}'));
      await client.get('invoices/abc.json');
      const [, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
      expect(init.headers['X-inFakt-ApiKey']).toBe('test-api-key');
    });

    it('should append query params as a query string', async () => {
      fetchMock.mockResolvedValue(fakeResponse(200, '{}'));
      await client.get('clients.json', { nip: '1234567890' });
      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toBe(`${INFAKT_DEFAULT_BASE_URL}/clients.json?nip=1234567890`);
    });

    it('should omit the query string when query is empty', async () => {
      fetchMock.mockResolvedValue(fakeResponse(200, '{}'));
      await client.get('clients.json', {});
      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toBe(`${INFAKT_DEFAULT_BASE_URL}/clients.json`);
    });

    it('should deserialize the JSON response body', async () => {
      fetchMock.mockResolvedValue(fakeResponse(200, '{"uuid":"abc-123"}'));
      const result = await client.get<{ uuid: string }>('invoices/abc-123.json');
      expect(result).toEqual({ uuid: 'abc-123' });
    });
  });

  describe('POST', () => {
    it('should attach the X-inFakt-ApiKey header and Content-Type', async () => {
      fetchMock.mockResolvedValue(fakeResponse(201, '{"uuid":"new-1"}'));
      await client.post('invoices.json', { invoice: { kind: 'vat' } });
      const [, init] = fetchMock.mock.calls[0] as [
        string,
        { method: string; headers: Record<string, string>; body: string },
      ];
      expect(init.method).toBe('POST');
      expect(init.headers['X-inFakt-ApiKey']).toBe('test-api-key');
      expect(init.headers['Content-Type']).toBe('application/json');
    });

    it('should serialize the request body as JSON', async () => {
      fetchMock.mockResolvedValue(fakeResponse(201, '{}'));
      const payload = { invoice: { kind: 'vat', client_uuid: 'c-1' } };
      await client.post('invoices.json', payload);
      const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
      expect(JSON.parse(init.body)).toEqual(payload);
    });

    it('should deserialize the JSON response body', async () => {
      fetchMock.mockResolvedValue(fakeResponse(201, '{"uuid":"new-1","number":null}'));
      const result = await client.post<{ uuid: string }>('invoices.json', {});
      expect(result).toEqual({ uuid: 'new-1', number: null });
    });
  });

  describe('PUT', () => {
    it('should attach the X-inFakt-ApiKey header and Content-Type', async () => {
      fetchMock.mockResolvedValue(fakeResponse(200, '{"id":1,"default":true}'));
      await client.put('bank_accounts/1.json', { bank_account: { default: true } });
      const [, init] = fetchMock.mock.calls[0] as [
        string,
        { method: string; headers: Record<string, string>; body: string },
      ];
      expect(init.method).toBe('PUT');
      expect(init.headers['X-inFakt-ApiKey']).toBe('test-api-key');
      expect(init.headers['Content-Type']).toBe('application/json');
    });

    it('should serialize the request body as JSON', async () => {
      fetchMock.mockResolvedValue(fakeResponse(200, '{}'));
      const payload = { bank_account: { default: true } };
      await client.put('bank_accounts/1.json', payload);
      const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
      expect(JSON.parse(init.body)).toEqual(payload);
    });

    it('should deserialize the JSON response body', async () => {
      fetchMock.mockResolvedValue(fakeResponse(200, '{"id":1,"default":true}'));
      const result = await client.put<{ id: number; default: boolean }>('bank_accounts/1.json', {});
      expect(result).toEqual({ id: 1, default: true });
    });
  });

  describe('error handling', () => {
    it('should throw InfaktApiError on a non-2xx JSON response', async () => {
      fetchMock.mockResolvedValue(fakeResponse(422, '{"error":"invalid nip"}'));
      await expect(client.post('invoices.json', {})).rejects.toBeInstanceOf(InfaktApiError);
      await expect(client.post('invoices.json', {})).rejects.toMatchObject({
        statusCode: 422,
        responseBody: { error: 'invalid nip' },
      });
    });

    it('should throw InfaktApiError with statusCode on a 500 response', async () => {
      fetchMock.mockResolvedValue(fakeResponse(500, '{"error":"internal"}'));
      await expect(client.get('invoices/x.json')).rejects.toMatchObject({ statusCode: 500 });
    });

    it('should throw InfaktApiError carrying the raw text when the body is not JSON', async () => {
      fetchMock.mockResolvedValue(fakeResponse(502, '<html>Bad Gateway</html>'));
      await expect(client.get('invoices/x.json')).rejects.toMatchObject({
        statusCode: 502,
        responseBody: '<html>Bad Gateway</html>',
      });
    });

    it('should log a warning on a non-2xx response', async () => {
      fetchMock.mockResolvedValue(fakeResponse(404, '{"error":"not found"}'));
      await expect(client.get('invoices/missing.json')).rejects.toBeInstanceOf(InfaktApiError);
      expect(logger.warn).toHaveBeenCalled();
    });
  });
});
