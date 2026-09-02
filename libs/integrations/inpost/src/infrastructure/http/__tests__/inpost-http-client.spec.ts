/**
 * InPost ShipX HTTP Client — unit tests
 *
 * Injects a mock `fetchImpl` (now a required constructor argument) to verify
 * the retry loop, the HTTP-status → domain exception classification, and the
 * success/204 paths. Retry delays are tuned to ~1ms so the suite stays fast.
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
  contentType?: string;
  bytes?: Uint8Array;
}

function fakeResponse(init: FakeResponseInit): Response {
  return {
    ok: init.ok,
    status: init.status,
    headers: {
      get: (name: string): string | null => {
        const n = name.toLowerCase();
        if (n === 'retry-after') return init.retryAfter ?? null;
        if (n === 'content-type') return init.contentType ?? null;
        return null;
      },
    },
    text: (): Promise<string> => Promise.resolve(init.body ?? ''),
    arrayBuffer: (): Promise<ArrayBuffer> => {
      const bytes = init.bytes ?? new Uint8Array();
      // Return a standalone ArrayBuffer copy (the Uint8Array's buffer may be a
      // shared/pooled SharedArrayBuffer slice in some runtimes).
      const copy = new Uint8Array(bytes);
      return Promise.resolve(copy.buffer);
    },
  } as unknown as Response;
}

describe('InpostHttpClient', () => {
  let fetchMock: jest.Mock;
  let client: InpostHttpClient;

  beforeEach(() => {
    fetchMock = jest.fn();
    client = new InpostHttpClient(
      'https://sandbox-api-shipx-pl.easypack24.net',
      'test-token',
      fetchMock as unknown as typeof fetch,
      {
        maxRetries: 2,
        initialDelayMs: 1,
        backoffMultiplier: 1,
        maxDelayMs: 1,
      },
    );
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

  it('should serialise an array query param as repeated key[]= pairs (ShipX shipment_ids)', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ ok: true, status: 200, body: '{"ok":true}' }));

    await client.request({
      method: 'GET',
      path: '/v1/organizations/org-1/dispatch_orders/printouts',
      query: { shipment_ids: ['11', '22'], format: 'Pdf' },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('shipment_ids%5B%5D=11'),
      expect.anything(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('shipment_ids%5B%5D=22'),
      expect.anything(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('format=Pdf'),
      expect.anything(),
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

  it('should fall back to the response body\'s `error` code as providerCode when `details` is empty (#2804)', async () => {
    // Shape modelled on ShipX's documented error envelope for an unfetchable
    // label document: ShipX answers with an `error` code but no `details`
    // object at all, so the field-level classifier above has nothing to key
    // on. The exact `error` code ShipX returns in this situation has not
    // been live-confirmed against the sandbox (#2804 review) — `not_found`
    // is a plausible placeholder, not a verified value. Without the
    // fallback, `providerCode` was `null` and the operator saw only the
    // generic `message` with no actionable reference.
    fetchMock.mockResolvedValue(
      fakeResponse({
        ok: false,
        status: 400,
        contentType: 'application/pdf',
        body: '{"error":"not_found","message":"There was a problem with label generation. Check details object for more info."}',
      }),
    );

    const error = await client
      .requestBinary({ method: 'GET', path: '/v1/shipments/1/label' })
      .then(() => null)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ShippingProviderRejectionException);
    expect(error).toMatchObject({
      providerName: 'inpost',
      providerCode: 'not_found',
      providerDetails: undefined,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('should ignore a non-string or blank `error` field rather than surfacing it as providerCode (#2804 review)', async () => {
    fetchMock.mockResolvedValue(
      fakeResponse({
        ok: false,
        status: 400,
        body: '{"error":"   ","message":"blank error code"}',
      }),
    );

    const error = await client
      .request({ method: 'GET', path: '/v1/x' })
      .then(() => null)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ShippingProviderRejectionException);
    expect(error).toMatchObject({ providerName: 'inpost', providerCode: null });
  });

  it('should still report providerCode: null when neither `details` nor `error` are present (#2804)', async () => {
    fetchMock.mockResolvedValue(
      fakeResponse({
        ok: false,
        status: 400,
        body: '{"message":"unmodeled failure shape"}',
      }),
    );

    const error = await client
      .request({ method: 'GET', path: '/v1/x' })
      .then(() => null)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ShippingProviderRejectionException);
    expect(error).toMatchObject({ providerName: 'inpost', providerCode: null });
  });

  it('should flatten a nested ShipX field-error map (custom_attributes.target_point) onto its leaf key, not the outer field (#1807)', async () => {
    // Live-reproduced shape for a paczkomat id ShipX doesn't recognise: the
    // offending field (`target_point`) is nested one level inside the outer
    // `custom_attributes` key, not a flat top-level key like `name` above.
    fetchMock.mockResolvedValue(
      fakeResponse({
        ok: false,
        status: 400,
        body: '{"error":"validation_failed","message":"There are some validation errors. Check details object for more info.","details":{"custom_attributes":[{"target_point":["does_not_exist"]}]}}',
      }),
    );

    const error = await client
      .request({ method: 'POST', path: '/v1/x' })
      .then(() => null)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ShippingProviderRejectionException);
    expect(error).toMatchObject({
      providerName: 'inpost',
      providerCode: 'target_point',
      providerDetails: { fieldErrors: { target_point: ['does_not_exist'] } },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('should merge messages for a leaf key repeated across array items rather than dropping all but the last (#1807)', async () => {
    // Two array items reject the same leaf key. Last-write-wins would surface
    // only the second message; both must survive so the FE renders every one.
    fetchMock.mockResolvedValue(
      fakeResponse({
        ok: false,
        status: 400,
        body: '{"error":"validation_failed","message":"x","details":{"parcels":[{"weight":["required"]},{"weight":["too_heavy"]}]}}',
      }),
    );

    const error = await client
      .request({ method: 'POST', path: '/v1/x' })
      .then(() => null)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ShippingProviderRejectionException);
    expect(error).toMatchObject({
      providerName: 'inpost',
      providerCode: 'weight',
      providerDetails: { fieldErrors: { weight: ['required', 'too_heavy'] } },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('should not throw on a malformed nested details payload and simply omit the unparseable keys (#1807)', async () => {
    // Defensive contract: a null nested item, a non-array leaf value, and a
    // doubly-nested shape are all skipped without throwing. Only the one
    // well-formed leaf key survives.
    fetchMock.mockResolvedValue(
      fakeResponse({
        ok: false,
        status: 400,
        body: '{"error":"validation_failed","message":"x","details":{"custom_attributes":[null,{"target_point":"oops"},{"sending_method":["required"]}],"deep":[{"a":[{"b":["nope"]}]}]}}',
      }),
    );

    const error = await client
      .request({ method: 'POST', path: '/v1/x' })
      .then(() => null)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ShippingProviderRejectionException);
    expect(error).toMatchObject({
      providerName: 'inpost',
      providerDetails: { fieldErrors: { sending_method: ['required'] } },
    });
    expect((error as ShippingProviderRejectionException).providerDetails?.fieldErrors).not.toHaveProperty(
      'target_point',
    );
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

  describe('requestBinary', () => {
    it('should read a 2xx response as raw bytes and surface the content type', async () => {
      const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
      fetchMock.mockResolvedValueOnce(
        fakeResponse({ ok: true, status: 200, contentType: 'application/pdf', bytes }),
      );

      const result = await client.requestBinary({ method: 'GET', path: '/v1/shipments/1/label' });

      expect(result.contentType).toBe('application/pdf');
      expect(Array.from(result.body)).toEqual([0x25, 0x50, 0x44, 0x46]);
    });

    it('should parse the JSON error envelope (NOT bytes) on a non-ok response', async () => {
      // The error body must still go through the text/JSON error path — never
      // read as bytes. A 4xx maps to ShippingProviderRejectionException.
      fetchMock.mockResolvedValueOnce(
        fakeResponse({
          ok: false,
          status: 400,
          body: '{"message":"bad label request","details":{"shipment":["invalid"]}}',
        }),
      );

      await expect(
        client.requestBinary({ method: 'GET', path: '/v1/shipments/1/label' }),
      ).rejects.toBeInstanceOf(ShippingProviderRejectionException);
    });

    it('should retry binary requests on 5xx and eventually surface InpostNetworkException', async () => {
      fetchMock.mockResolvedValue(fakeResponse({ ok: false, status: 503 }));

      await expect(
        client.requestBinary({ method: 'GET', path: '/v1/shipments/1/label' }),
      ).rejects.toBeInstanceOf(InpostNetworkException);
      expect(fetchMock).toHaveBeenCalledTimes(3); // initial + 2 retries
    });
  });
});
