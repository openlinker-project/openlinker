import { ShoperApiError } from '../../../domain/exceptions/shoper-api.error';
import { ShoperNetworkError } from '../../../domain/exceptions/shoper-network.error';
import { ShoperHttpClient } from '../shoper-http-client';

const TOKEN = 'secret-token-value';

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function build(fetchImpl: jest.Mock): ShoperHttpClient {
  return new ShoperHttpClient(
    { host: 'xxxxx.shoparena.pl', token: TOKEN },
    fetchImpl as unknown as typeof fetch,
  );
}

describe('ShoperHttpClient', () => {
  it('should GET the API URL with a Bearer token and never follow redirects', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, { ok: true }));

    const response = await build(fetchImpl).get<{ ok: boolean }>('/application-config');

    expect(response).toEqual({ status: 200, data: { ok: true } });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://xxxxx.shoparena.pl/webapi/rest/application-config',
      expect.objectContaining({
        method: 'GET',
        redirect: 'manual',
        headers: expect.objectContaining({ Authorization: `Bearer ${TOKEN}` }),
      }),
    );
  });

  it('should map a 401 to ShoperApiError carrying the shop error code', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      jsonResponse(401, {
        error: 'unauthorized_client',
        error_description: 'Provided access token is invalid',
      }),
    );

    const error = await build(fetchImpl)
      .get('/x')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ShoperApiError);
    expect(error).toMatchObject({ statusCode: 401, errorCode: 'unauthorized_client' });
    expect((error as Error).message).toContain('Provided access token is invalid');
  });

  it('should map a 403 insufficient_scope to ShoperApiError', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(403, { error: 'insufficient_scope' }));

    await expect(build(fetchImpl).get('/x')).rejects.toMatchObject({
      statusCode: 403,
      errorCode: 'insufficient_scope',
    });
  });

  it('should survive a non-JSON error body', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(new Response('<html>oops</html>', { status: 502 }));

    await expect(build(fetchImpl).get('/x')).rejects.toMatchObject({
      statusCode: 502,
      errorCode: undefined,
    });
  });

  it('should treat a redirect as an error instead of following it', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'https://evil.example' } }),
    );

    await expect(build(fetchImpl).get('/x')).rejects.toMatchObject({ statusCode: 302 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('should wrap a transport failure in ShoperNetworkError', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const error = await build(fetchImpl)
      .get('/x')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ShoperNetworkError);
    expect(error).toMatchObject({ timedOut: false });
    expect((error as ShoperNetworkError).originalError?.message).toBe('ECONNREFUSED');
  });

  it('should refuse a response that declares a body over the size cap', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, {}, { 'content-length': String(5 * 1024 * 1024) }));

    await expect(build(fetchImpl).get('/x')).rejects.toBeInstanceOf(ShoperNetworkError);
  });

  it('should report a timeout when the request is aborted', async () => {
    jest.useFakeTimers();
    try {
      const fetchImpl = jest.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      );
      const pending = build(fetchImpl as unknown as jest.Mock)
        .get('/x')
        .catch((e: unknown) => e);

      await jest.advanceTimersByTimeAsync(15_001);

      const error = await pending;
      expect(error).toBeInstanceOf(ShoperNetworkError);
      expect(error).toMatchObject({ timedOut: true });
    } finally {
      jest.useRealTimers();
    }
  });
});
