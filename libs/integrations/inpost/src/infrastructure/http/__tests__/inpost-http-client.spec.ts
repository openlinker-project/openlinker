/**
 * InPost ShipX HTTP Client — unit tests
 *
 * Stubs `global.fetch` to verify the retry loop, the HTTP-status → domain
 * exception classification, and the success/204 paths. Retry delays are tuned
 * to ~1ms so the suite stays fast.
 *
 * @module libs/integrations/inpost/src/infrastructure/http
 */
import { ShippingProviderRejectionException } from '@openlinker/core/shipping';
import { InpostUnauthorizedException } from '../../../domain/exceptions/inpost-unauthorized.exception';
import { InpostNetworkException } from '../../../domain/exceptions/inpost-network.exception';
import { InpostHttpClient } from '../inpost-http-client';

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
        name.toLowerCase() === 'retry-after' ? (init.retryAfter ?? null) : null,
    },
    text: (): Promise<string> => Promise.resolve(init.body ?? ''),
  } as unknown as Response;
}

const originalFetch = global.fetch;

describe('InpostHttpClient', () => {
  let fetchMock: jest.Mock;
  let client: InpostHttpClient;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    client = new InpostHttpClient('https://sandbox-api-shipx-pl.easypack24.net', 'test-token', {
      maxRetries: 2,
      initialDelayMs: 1,
      backoffMultiplier: 1,
      maxDelayMs: 1,
    });
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('should parse a 2xx JSON body and attach the Bearer token', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ ok: true, status: 200, body: '{"id":1}' }));

    const result = await client.request<{ id: number }>({ method: 'GET', path: '/v1/shipments/1' });

    expect(result).toEqual({ id: 1 });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sandbox-api-shipx-pl.easypack24.net/v1/shipments/1',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
      }),
    );
  });

  it('should resolve undefined for a 204 No Content response', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ ok: true, status: 204 }));

    await expect(
      client.request<void>({ method: 'DELETE', path: '/v1/shipments/abc' }),
    ).resolves.toBeUndefined();
  });

  it('should map 401 to InpostUnauthorizedException without retrying', async () => {
    fetchMock.mockResolvedValue(
      fakeResponse({ ok: false, status: 401, body: '{"error":"unauthorized","message":"bad token"}' }),
    );

    await expect(client.request({ method: 'GET', path: '/v1/x' })).rejects.toBeInstanceOf(
      InpostUnauthorizedException,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('should map other 4xx to ShippingProviderRejectionException with fieldErrors, no retry (#885)', async () => {
    fetchMock.mockResolvedValue(
      fakeResponse({
        ok: false,
        status: 400,
        body: '{"error":"validation_failed","message":"x","details":{"name":["required"]}}',
      }),
    );

    const error = await client
      .request({ method: 'POST', path: '/v1/x' })
      .then(() => null)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ShippingProviderRejectionException);
    expect(error).toMatchObject({
      providerName: 'inpost',
      providerCode: 'name',
      providerDetails: { fieldErrors: { name: ['required'] } },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('should retry a 429 and then succeed', async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse({ ok: false, status: 429, retryAfter: '0', body: '{}' }))
      .mockResolvedValueOnce(fakeResponse({ ok: true, status: 200, body: '{"ok":true}' }));

    await expect(client.request({ method: 'GET', path: '/v1/x' })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('should retry a 5xx and then succeed', async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse({ ok: false, status: 503, body: '{}' }))
      .mockResolvedValueOnce(fakeResponse({ ok: true, status: 200, body: '{"ok":true}' }));

    await expect(client.request({ method: 'GET', path: '/v1/x' })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('should surface InpostNetworkException after exhausting retries on persistent 429', async () => {
    fetchMock.mockResolvedValue(
      fakeResponse({ ok: false, status: 429, retryAfter: '0', body: '{}' }),
    );

    await expect(client.request({ method: 'GET', path: '/v1/x' })).rejects.toBeInstanceOf(
      InpostNetworkException,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('should surface InpostNetworkException after exhausting retries on network errors', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));

    await expect(client.request({ method: 'GET', path: '/v1/x' })).rejects.toBeInstanceOf(
      InpostNetworkException,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
