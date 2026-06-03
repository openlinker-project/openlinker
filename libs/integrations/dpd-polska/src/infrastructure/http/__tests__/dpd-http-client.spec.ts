/**
 * DPD DPDServices HTTP Client — unit tests
 *
 * Stubs `global.fetch` to verify Basic-auth (+ optional `X-DPD-FID`), the
 * status → domain-exception classification, and the retry ASYMMETRY that
 * guards double-COD: HTTP 429/5xx always retry; a network/timeout retries only
 * when the caller opts in, so the non-idempotent create fails fast.
 *
 * @module libs/integrations/dpd-polska/src/infrastructure/http
 */
import { ShippingProviderRejectionException } from '@openlinker/core/shipping';
import { DpdUnauthorizedException } from '../../../domain/exceptions/dpd-unauthorized.exception';
import { DpdNetworkException } from '../../../domain/exceptions/dpd-network.exception';
import { DpdHttpClient } from '../dpd-http-client';

interface FakeResponseInit {
  ok: boolean;
  status: number;
  body?: string;
  retryAfter?: string;
}

function fakeResponse(init: FakeResponseInit): Response {
  return {
    ok: init.ok,
    status: init.status,
    headers: {
      get: (name: string): string | null =>
        name.toLowerCase() === 'retry-after' ? init.retryAfter ?? null : null,
    },
    text: (): Promise<string> => Promise.resolve(init.body ?? ''),
  } as unknown as Response;
}

const originalFetch = global.fetch;
const BASE_URL = 'https://dpdservices.dpd.com.pl';
const CREATE_PATH = '/public/shipment/v1/generatePackagesNumbers';

describe('DpdHttpClient', () => {
  let fetchMock: jest.Mock;
  let client: DpdHttpClient;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    client = new DpdHttpClient(
      BASE_URL,
      { login: 'user', password: 'pass' },
      { maxRetries: 2, initialDelayMs: 1, backoffMultiplier: 1, maxDelayMs: 1 },
    );
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('should parse a 2xx JSON body and attach the Basic auth header', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ ok: true, status: 200, body: '{"status":"OK"}' }));

    const result = await client.request<{ status: string }>({ method: 'POST', path: CREATE_PATH });

    expect(result).toEqual({ status: 'OK' });
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}${CREATE_PATH}`,
      expect.objectContaining({
        headers: expect.objectContaining({
          // base64('user:pass') === 'dXNlcjpwYXNz'
          Authorization: 'Basic dXNlcjpwYXNz',
        }),
      }),
    );
  });

  it('should attach the X-DPD-FID header when masterFid is configured', async () => {
    const fidClient = new DpdHttpClient(BASE_URL, {
      login: 'user',
      password: 'pass',
      masterFid: '1495',
    });
    fetchMock.mockResolvedValueOnce(fakeResponse({ ok: true, status: 200, body: '{"status":"OK"}' }));

    await fidClient.request({ method: 'POST', path: CREATE_PATH });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-DPD-FID': '1495' }),
      }),
    );
  });

  it('should map 401 to DpdUnauthorizedException without retrying', async () => {
    fetchMock.mockResolvedValue(
      fakeResponse({ ok: false, status: 401, body: '{"status":"MISSING_PERMISSION"}' }),
    );

    await expect(client.request({ method: 'POST', path: CREATE_PATH })).rejects.toBeInstanceOf(
      DpdUnauthorizedException,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('should map a 400 DpdErrors body to ShippingProviderRejectionException (no retry)', async () => {
    fetchMock.mockResolvedValue(
      fakeResponse({
        ok: false,
        status: 400,
        body: '{"errors":[{"code":"INCORRECT_PAYER_FID","subCode":"X","userMessage":"bad fid","field":"payerFID"}],"traceId":"t1"}',
      }),
    );

    const error = await client
      .request({ method: 'POST', path: CREATE_PATH })
      .then(() => null)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ShippingProviderRejectionException);
    expect(error).toMatchObject({
      providerName: 'dpd',
      providerCode: 'INCORRECT_PAYER_FID',
      message: 'bad fid',
      providerDetails: { field: 'payerFID', subCode: 'X' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('should retry a 429 and then succeed', async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse({ ok: false, status: 429, retryAfter: '0', body: '{}' }))
      .mockResolvedValueOnce(fakeResponse({ ok: true, status: 200, body: '{"status":"OK"}' }));

    await expect(client.request({ method: 'POST', path: CREATE_PATH })).resolves.toEqual({
      status: 'OK',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('should retry a 5xx and then succeed', async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse({ ok: false, status: 503, body: '{}' }))
      .mockResolvedValueOnce(fakeResponse({ ok: true, status: 200, body: '{"status":"OK"}' }));

    await expect(client.request({ method: 'POST', path: CREATE_PATH })).resolves.toEqual({
      status: 'OK',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('should surface DpdNetworkException after exhausting retries on persistent 429', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ ok: false, status: 429, retryAfter: '0', body: '{}' }));

    await expect(client.request({ method: 'POST', path: CREATE_PATH })).rejects.toBeInstanceOf(
      DpdNetworkException,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('should NOT retry a network/timeout on the create call (guards double-COD)', async () => {
    fetchMock.mockRejectedValue(new Error('ETIMEDOUT'));

    await expect(
      // retryOnNetworkError omitted ⇒ false for the non-idempotent create.
      client.request({ method: 'POST', path: CREATE_PATH }),
    ).rejects.toBeInstanceOf(DpdNetworkException);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('should retry a network/timeout when the caller opts in (idempotent read)', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));

    await expect(
      client.request({ method: 'GET', path: '/public/shipment/v1/generateSpedLabels', retryOnNetworkError: true }),
    ).rejects.toBeInstanceOf(DpdNetworkException);
    expect(fetchMock).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});
