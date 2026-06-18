/**
 * Erli Connection Tester — unit tests
 *
 * Stubs `global.fetch` to verify the probe maps a 2xx to success, a 401 to a
 * clear auth failure, and a transport error to a failure result — never
 * throwing (the tester always returns a `ConnectionTestResult`) (#982).
 *
 * @module libs/integrations/erli/src/infrastructure/adapters/__tests__
 */
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { ErliApiException } from '../../../domain/exceptions/erli-api.exception';
import { ErliConnectionTesterAdapter } from '../erli-connection-tester.adapter';

function connection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-1',
    platformType: 'erli',
    name: 'Erli',
    status: 'active',
    config: {},
    credentialsRef: 'ref-1',
    enabledCapabilities: [],
    adapterKey: 'erli.shopapi.v1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const resolver: CredentialsResolverPort = { get: jest.fn().mockResolvedValue({ apiKey: 'k-123' }) };

function fakeResponse(ok: boolean, status: number): Response {
  return {
    ok,
    status,
    headers: { get: (): string | null => null },
    text: (): Promise<string> => Promise.resolve(ok ? '{}' : ''),
  } as unknown as Response;
}

const originalFetch = global.fetch;

describe('ErliConnectionTesterAdapter', () => {
  let tester: ErliConnectionTesterAdapter;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    tester = new ErliConnectionTesterAdapter();
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should return success with the probe status on a 2xx response', async () => {
    fetchMock.mockResolvedValue(fakeResponse(true, 200));

    const result = await tester.test(connection(), resolver);

    expect(result.success).toBe(true);
    expect(result.status).toBe(200);
    expect(result.message).toContain('credentials accepted');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('should return a failure with status 401 when the key is rejected', async () => {
    fetchMock.mockResolvedValue(fakeResponse(false, 401));

    const result = await tester.test(connection(), resolver);

    expect(result.success).toBe(false);
    expect(result.status).toBe(401);
  });

  it('should return a failure (not throw) on a transport error, collapsing the raw cause', async () => {
    fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.1:443 /secret-path'));

    const result = await tester.test(connection(), resolver);

    expect(result.success).toBe(false);
    expect(result.status).toBeUndefined();
    // Bounded fixed string — the raw undici cause (which can embed host/path)
    // must not reach the operator-facing result (PR1057-SEC-01).
    expect(result.message).toBe('Erli connection failed (network error)');
    expect(result.message).not.toContain('ECONNREFUSED');
    expect(result.message).not.toContain('secret-path');
  });

  it('should return a failure with status 403 when the key is forbidden', async () => {
    fetchMock.mockResolvedValue(fakeResponse(false, 403));

    const result = await tester.test(connection(), resolver);

    expect(result.success).toBe(false);
    expect(result.status).toBe(403);
  });

  it('should surface status 429 on a rate-limit response', async () => {
    fetchMock.mockResolvedValue(fakeResponse(false, 429));

    const result = await tester.test(connection(), resolver);

    expect(result.success).toBe(false);
    // Rate-limit carries retryAfterMs, not statusCode — the tester maps it to 429
    // so the operator sees the real cause (PR1057-TECH-02).
    expect(result.status).toBe(429);
    expect(result.message).toContain('rate limit');
  });

  it('should collapse an unrecognized error to a fixed message (no detail leak)', async () => {
    // A non-Erli error must NOT have its raw message surfaced in the result —
    // only recognized Erli exceptions carry bounded, bearer-safe messages.
    const leakyFactory = {
      createHttpClient: jest
        .fn()
        .mockRejectedValue(new Error('connect ECONNREFUSED https://internal.host/secret-path')),
    } as unknown as ConstructorParameters<typeof ErliConnectionTesterAdapter>[0];
    const leakyTester = new ErliConnectionTesterAdapter(leakyFactory);

    const result = await leakyTester.test(connection(), resolver);

    expect(result.success).toBe(false);
    expect(result.status).toBeUndefined();
    expect(result.message).toBe('Erli probe failed');
    expect(result.message).not.toContain('internal.host');
  });

  it('should never surface ErliApiException.responseBody in the result message', async () => {
    // The tester surfaces `ErliApiException.message` verbatim because it is
    // bounded and bearer-safe. `responseBody` is a SEPARATE field that "may echo
    // back submitted data" (see the exception docblock) and must never leak to
    // OL Admin. This locks that property so a future #981 change can't fold the
    // body into `.message` unnoticed (PR1057-SUG-04).
    const responseBody = 'apiKey=super-secret-echoed-back';
    const apiError = new ErliApiException('Erli GET /me failed (422)', 422, responseBody);
    const throwingFactory = {
      createHttpClient: jest.fn().mockResolvedValue({
        get: jest.fn().mockRejectedValue(apiError),
      }),
    } as unknown as ConstructorParameters<typeof ErliConnectionTesterAdapter>[0];
    const throwingTester = new ErliConnectionTesterAdapter(throwingFactory);

    const result = await throwingTester.test(connection(), resolver);

    expect(result.success).toBe(false);
    expect(result.status).toBe(422);
    expect(result.message).toBe('Erli GET /me failed (422)');
    expect(result.message).not.toContain(responseBody);
    expect(result.message).not.toContain('super-secret');
  });

  it('should return a failure (not throw) when credential resolution fails', async () => {
    // No HTTP call is made — the factory throws ErliConfigException before the
    // probe; the tester must still return a structured failure, never throw.
    const result = await tester.test(connection({ credentialsRef: undefined }), resolver);

    expect(result.success).toBe(false);
    expect(result.message.length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
