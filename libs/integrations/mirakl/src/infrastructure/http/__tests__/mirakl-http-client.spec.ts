/**
 * Mirakl HTTP Client: unit tests
 *
 * Stubs the injected `fetch` to verify the raw-key auth header, `shop_id`
 * scoping, both Mirakl error shapes, the retry rules (429 always; 5xx and
 * transport only when idempotent; file uploads never), the response cap, text
 * bodies and the host-escape guard. Retry delays are ~1 ms.
 *
 * @module libs/integrations/mirakl/src/infrastructure/http
 */
import { MiraklApiException } from '../../../domain/exceptions/mirakl-api.exception';
import { MiraklAuthenticationException } from '../../../domain/exceptions/mirakl-authentication.exception';
import { MiraklConfigException } from '../../../domain/exceptions/mirakl-config.exception';
import { MiraklNetworkException } from '../../../domain/exceptions/mirakl-network.exception';
import { MiraklRateLimitException } from '../../../domain/exceptions/mirakl-rate-limit.exception';
import { MiraklHttpClient, parseErrorBody } from '../mirakl-http-client';

interface FakeResponseInit {
  status: number;
  body?: string;
  retryAfter?: string;
}

function fakeResponse(init: FakeResponseInit): Response {
  return {
    ok: init.status >= 200 && init.status < 300,
    status: init.status,
    body: null,
    headers: {
      get: (name: string): string | null =>
        name.toLowerCase() === 'retry-after' ? (init.retryAfter ?? null) : null,
    },
    text: (): Promise<string> => Promise.resolve(init.body ?? ''),
  } as unknown as Response;
}

const BASE_URL = 'https://stg1.marketplace.empik.com';
const API_KEY = 'shop-key-123';
const FAST_RETRY = { initialDelayMs: 1, maxDelayMs: 1, backoffMultiplier: 1, maxRetries: 2 };

type RecordedCall = [url: string, init: { method: string; headers: Record<string, string>; body?: unknown }];
function calls(mock: jest.Mock): RecordedCall[] {
  return mock.mock.calls as RecordedCall[];
}

function makeClient(fetchMock: jest.Mock, shopId?: string): MiraklHttpClient {
  return new MiraklHttpClient(
    'conn-1',
    BASE_URL,
    API_KEY,
    fetchMock as unknown as typeof fetch,
    shopId,
    FAST_RETRY,
  );
}

describe('MiraklHttpClient', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
  });

  describe('construction', () => {
    it('should refuse a non-https base URL when constructed', () => {
      expect(
        () => new MiraklHttpClient('c', 'http://stg1.marketplace.empik.com', API_KEY, fetchMock as unknown as typeof fetch),
      ).toThrow(MiraklConfigException);
    });

    it('should refuse an unparseable base URL when constructed', () => {
      expect(
        () => new MiraklHttpClient('c', 'not a url', API_KEY, fetchMock as unknown as typeof fetch),
      ).toThrow(MiraklConfigException);
    });
  });

  describe('requests', () => {
    it('should send the raw key without a Bearer prefix when calling', async () => {
      fetchMock.mockResolvedValue(fakeResponse({ status: 200, body: '{"shop_id":6881}' }));
      const response = await makeClient(fetchMock).get<{ shop_id: number }>('/api/account');

      expect(response).toEqual({ status: 200, data: { shop_id: 6881 } });
      const [url, init] = calls(fetchMock)[0];
      expect(url).toBe('https://stg1.marketplace.empik.com/api/account');
      expect(init.headers.Authorization).toBe(API_KEY);
      expect(init.headers.Accept).toBe('application/json');
    });

    it('should add shop_id to every request when the connection names a shop', async () => {
      fetchMock.mockResolvedValue(fakeResponse({ status: 200, body: '{}' }));
      await makeClient(fetchMock, '6881').get('/api/orders', { queryParams: { max: 10 } });

      const url = new URL(calls(fetchMock)[0][0]);
      expect(url.searchParams.get('shop_id')).toBe('6881');
      expect(url.searchParams.get('max')).toBe('10');
    });

    it('should not add shop_id when the connection names no shop', async () => {
      fetchMock.mockResolvedValue(fakeResponse({ status: 200, body: '{}' }));
      await makeClient(fetchMock).get('/api/orders');

      expect(new URL(calls(fetchMock)[0][0]).searchParams.has('shop_id')).toBe(false);
    });

    it('should repeat a query parameter when given an array and drop undefined values', async () => {
      fetchMock.mockResolvedValue(fakeResponse({ status: 200, body: '{}' }));
      await makeClient(fetchMock).get('/api/orders', {
        queryParams: { order_state_codes: ['SHIPPING', 'SHIPPED'], page_token: undefined },
      });

      const url = new URL(calls(fetchMock)[0][0]);
      expect(url.searchParams.getAll('order_state_codes')).toEqual(['SHIPPING', 'SHIPPED']);
      expect(url.searchParams.has('page_token')).toBe(false);
    });

    it('should send a JSON body with a JSON content type when posting', async () => {
      fetchMock.mockResolvedValue(fakeResponse({ status: 201, body: '{"import_id":2156101}' }));
      const response = await makeClient(fetchMock).post('/api/offers', { offers: [] });

      expect(response.data).toEqual({ import_id: 2156101 });
      const [, init] = calls(fetchMock)[0];
      expect(init.method).toBe('POST');
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(init.body).toBe('{"offers":[]}');
    });

    it('should send multipart form data without a manual content type when uploading a file', async () => {
      fetchMock.mockResolvedValue(fakeResponse({ status: 201, body: '{"import_id":"6c75dbb9"}' }));
      await makeClient(fetchMock).postFile('/api/offers/stock/imports', {
        fieldName: 'file',
        fileName: 'stock.csv',
        contentType: 'text/csv',
        content: 'offer-sku;quantity\nSKU-1;7\n',
      });

      const [, init] = calls(fetchMock)[0];
      expect(init.body).toBeInstanceOf(FormData);
      expect(init.headers['Content-Type']).toBeUndefined();
      const file = (init.body as FormData).get('file') as File;
      expect(file.name).toBe('stock.csv');
      expect(await file.text()).toBe('offer-sku;quantity\nSKU-1;7\n');
    });

    it('should send binary content and extra form fields when uploading a document', async () => {
      fetchMock.mockResolvedValue(fakeResponse({ status: 200, body: '{"errors_count":0}' }));
      await makeClient(fetchMock).postFile('/api/orders/1001-A/documents', {
        fieldName: 'files',
        fileName: 'FV-1.pdf',
        contentType: 'application/pdf',
        content: new Uint8Array([37, 80, 68, 70]),
        fields: { order_documents: '{"order_documents":[]}' },
      });

      const form = calls(fetchMock)[0][1].body as FormData;
      const file = form.get('files') as File;
      expect(file.name).toBe('FV-1.pdf');
      expect(await file.text()).toBe('%PDF');
      expect(form.get('order_documents')).toBe('{"order_documents":[]}');
    });

    it('should return the body verbatim when reading text', async () => {
      fetchMock.mockResolvedValue(fakeResponse({ status: 200, body: 'line-number;errors\n2;bad\n' }));
      const response = await makeClient(fetchMock).getText('/api/offers/stock/imports/x/error_report');

      expect(response.data).toBe('line-number;errors\n2;bad\n');
      expect(calls(fetchMock)[0][1].headers.Accept).toContain('text/csv');
    });

    it('should return undefined data when the response is 204', async () => {
      fetchMock.mockResolvedValue(fakeResponse({ status: 204 }));
      const response = await makeClient(fetchMock).put('/api/orders/1/accept', { order_lines: [] });

      expect(response).toEqual({ status: 204, data: undefined });
    });

    it('should refuse a path that escapes the configured host', async () => {
      await expect(makeClient(fetchMock).get('https://evil.example/api/account')).rejects.toThrow(
        MiraklConfigException,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should keep a protocol-relative path on the configured host', async () => {
      fetchMock.mockResolvedValue(fakeResponse({ status: 200, body: '{}' }));
      await makeClient(fetchMock).get('//evil.example/api/account');

      expect(new URL(calls(fetchMock)[0][0]).origin).toBe(BASE_URL);
    });
  });

  describe('errors', () => {
    it('should raise an authentication exception without retrying when Mirakl answers 401', async () => {
      fetchMock.mockResolvedValue(fakeResponse({ status: 401, body: '{"status":401,"message":"Unauthorized"}' }));

      await expect(makeClient(fetchMock).get('/api/account')).rejects.toBeInstanceOf(
        MiraklAuthenticationException,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('should carry the Mirakl code when the error body has one', async () => {
      fetchMock.mockResolvedValue(
        fakeResponse({
          status: 404,
          body: '{"code":"ORDER_NOT_FOUND","message":"No order found with id \'X\'","status":404}',
        }),
      );

      const error = (await makeClient(fetchMock)
        .put('/api/orders/X/accept', { order_lines: [] })
        .catch((e: unknown) => e)) as MiraklApiException;
      expect(error).toBeInstanceOf(MiraklApiException);
      expect(error.statusCode).toBe(404);
      expect(error.miraklCode).toBe('ORDER_NOT_FOUND');
      expect(error.miraklMessage).toBe("No order found with id 'X'");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('should leave the Mirakl code empty when the error body has only a message', async () => {
      fetchMock.mockResolvedValue(
        fakeResponse({ status: 400, body: '{"message":"Param \'order_lines\' is required","status":400}' }),
      );

      const error = (await makeClient(fetchMock)
        .put('/api/orders/X/accept', {})
        .catch((e: unknown) => e)) as MiraklApiException;
      expect(error.miraklCode).toBeUndefined();
      expect(error.miraklMessage).toBe("Param 'order_lines' is required");
    });

    it('should retry with Retry-After and then raise a rate-limit exception when 429 persists', async () => {
      fetchMock.mockResolvedValue(fakeResponse({ status: 429, retryAfter: '0' }));

      await expect(makeClient(fetchMock).get('/api/orders')).rejects.toBeInstanceOf(
        MiraklRateLimitException,
      );
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('should succeed after a 429 when the next attempt is answered', async () => {
      fetchMock
        .mockResolvedValueOnce(fakeResponse({ status: 429, retryAfter: '0' }))
        .mockResolvedValueOnce(fakeResponse({ status: 200, body: '{"ok":true}' }));

      await expect(makeClient(fetchMock).get('/api/orders')).resolves.toEqual({
        status: 200,
        data: { ok: true },
      });
    });

    it('should retry a 5xx when the request is a GET', async () => {
      fetchMock
        .mockResolvedValueOnce(fakeResponse({ status: 503 }))
        .mockResolvedValueOnce(fakeResponse({ status: 200, body: '{}' }));

      await makeClient(fetchMock).get('/api/orders');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('should fail fast on a 5xx when the request is a plain POST', async () => {
      fetchMock.mockResolvedValue(fakeResponse({ status: 502 }));

      await expect(makeClient(fetchMock).post('/api/offers', {})).rejects.toBeInstanceOf(
        MiraklNetworkException,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('should never retry a file upload on a 5xx even when marked idempotent', async () => {
      fetchMock.mockResolvedValue(fakeResponse({ status: 500 }));

      await expect(
        makeClient(fetchMock).postFile(
          '/api/offers/pricing/imports',
          { fieldName: 'file', fileName: 'p.csv', contentType: 'text/csv', content: 'x' },
          { idempotent: true },
        ),
      ).rejects.toBeInstanceOf(MiraklNetworkException);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('should never retry a file upload on a transport failure', async () => {
      fetchMock.mockRejectedValue(new TypeError('socket hang up'));

      await expect(
        makeClient(fetchMock).postFile('/api/products/imports', {
          fieldName: 'file',
          fileName: 'p.csv',
          contentType: 'text/csv',
          content: 'x',
        }),
      ).rejects.toBeInstanceOf(MiraklNetworkException);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('should raise a network exception when a JSON response cannot be parsed', async () => {
      fetchMock.mockResolvedValue(fakeResponse({ status: 200, body: '<html>' }));

      await expect(makeClient(fetchMock).get('/api/account')).rejects.toBeInstanceOf(
        MiraklNetworkException,
      );
    });

    it('should raise a network exception when the body exceeds the size cap', async () => {
      const chunk = new Uint8Array(1024 * 1024);
      let sent = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller): void {
          if (sent++ < 9) {
            controller.enqueue(chunk);
          } else {
            controller.close();
          }
        },
      });
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        body: stream,
        headers: { get: () => null },
        text: () => Promise.resolve(''),
      } as unknown as Response);

      await expect(makeClient(fetchMock).get('/api/values_lists')).rejects.toThrow(/ceiling/);
    });
  });

  describe('parseErrorBody', () => {
    it('should return nothing when the body is not JSON', () => {
      expect(parseErrorBody('Forbidden')).toEqual({});
    });

    it('should return nothing when the body is empty', () => {
      expect(parseErrorBody(undefined)).toEqual({});
    });
  });
});
