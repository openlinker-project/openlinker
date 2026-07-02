/**
 * Infakt Connection Tester — unit tests
 *
 * Stubs `global.fetch` to verify the probe maps a 2xx to success, a 401 to a
 * clear auth failure, and a transport error to a failure result — never
 * throwing (the tester always returns a `ConnectionTestResult`).
 *
 * @module libs/integrations/infakt/src/infrastructure/adapters/__tests__
 */
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { InfaktConnectionTesterAdapter } from '../infakt-connection-tester.adapter';

function connection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-1',
    platformType: 'infakt',
    name: 'Infakt',
    status: 'active',
    config: {},
    credentialsRef: 'ref-1',
    enabledCapabilities: [],
    adapterKey: 'infakt.accounting.v1',
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
    text: (): Promise<string> => Promise.resolve(ok ? '{"entities":[]}' : '{"error":"unauthorized"}'),
  } as unknown as Response;
}

const originalFetch = global.fetch;

describe('InfaktConnectionTesterAdapter', () => {
  let tester: InfaktConnectionTesterAdapter;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    tester = new InfaktConnectionTesterAdapter();
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
    expect(result.message).toBe('Infakt probe failed');
    expect(result.message).not.toContain('ECONNREFUSED');
    expect(result.message).not.toContain('secret-path');
  });

  it('should never surface InfaktApiError.responseBody in the result message', async () => {
    fetchMock.mockResolvedValue(fakeResponse(false, 422));

    const result = await tester.test(connection(), resolver);

    expect(result.success).toBe(false);
    expect(result.status).toBe(422);
    expect(result.message).not.toContain('unauthorized');
  });

  it('should return a failure (not throw) when the connection has no stored credentials', async () => {
    const result = await tester.test(connection({ credentialsRef: undefined }), resolver);

    expect(result.success).toBe(false);
    expect(result.message.length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
