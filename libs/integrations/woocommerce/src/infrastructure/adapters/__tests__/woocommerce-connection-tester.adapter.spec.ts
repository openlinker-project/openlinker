/**
 * WooCommerce Connection Tester Adapter — unit tests
 *
 * Stubs `WooCommerceHttpClient.get` via `global.fetch` to verify that
 * the tester maps HTTP responses to the correct `ConnectionTestResult`
 * shape, including the right success flag, status code, and human-readable
 * message for each response branch.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/__tests__
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import { WooCommerceConnectionTesterAdapter } from '../woocommerce-connection-tester.adapter';

const SITE_URL = 'https://myshop.com';

// SECURITY WARNING: These are test fixtures only, never use hardcoded credentials in production.
// Use environment variables or secure credential storage instead.
const CONSUMER_KEY = 'ck_abc123';
const CONSUMER_SECRET = 'cs_xyz789';

function makeConnection(siteUrl: string = SITE_URL): Connection {
  return {
    id: 'conn-1',
    credentialsRef: 'ref-1',
    config: { siteUrl },
  } as unknown as Connection;
}

function makeCredentialsResolver(): jest.Mocked<CredentialsResolverPort> {
  return {
    get: jest.fn().mockResolvedValue({
      consumerKey: CONSUMER_KEY,
      consumerSecret: CONSUMER_SECRET,
    }),
  } as unknown as jest.Mocked<CredentialsResolverPort>;
}

function stubFetch(status: number, ok = status >= 200 && status < 300): void {
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve([]),
  } as Response);
}

describe('WooCommerceConnectionTesterAdapter', () => {
  const adapter = new WooCommerceConnectionTesterAdapter();

  it('should return success when products endpoint responds 200', async () => {
    stubFetch(200);
    const result = await adapter.test(makeConnection(), makeCredentialsResolver());
    expect(result.success).toBe(true);
    // status is not set on success — we don't have access to the raw response status
    expect(result.status).toBeUndefined();
  });

  it('should return success when siteUrl has a trailing slash', async () => {
    stubFetch(200);
    const result = await adapter.test(
      makeConnection(`${SITE_URL}/`),
      makeCredentialsResolver(),
    );
    expect(result.success).toBe(true);
    // Verify the request URL was normalised (no double slash)
    const [url] = (global.fetch as jest.Mock).mock.calls[0] as [string, ...unknown[]];
    expect(url).toContain(`${SITE_URL}/wp-json`);
    expect(url).not.toContain('//wp-json');
  });

  it('should return failure with auth message when response is 401', async () => {
    stubFetch(401);
    const result = await adapter.test(makeConnection(), makeCredentialsResolver());
    expect(result.success).toBe(false);
    expect(result.status).toBe(401);
    expect(result.message).toContain('authentication failed');
  });

  it('should return failure with auth message when response is 403', async () => {
    stubFetch(403);
    const result = await adapter.test(makeConnection(), makeCredentialsResolver());
    expect(result.success).toBe(false);
    expect(result.status).toBe(403);
    expect(result.message).toContain('authentication failed');
  });

  it('should return failure with REST API not found message when response is 404', async () => {
    stubFetch(404);
    const result = await adapter.test(makeConnection(), makeCredentialsResolver());
    expect(result.success).toBe(false);
    expect(result.status).toBe(404);
    expect(result.message).toContain('REST API not found');
  });

  it('should return failure with unexpected error message when response is 500', async () => {
    stubFetch(500);
    const result = await adapter.test(makeConnection(), makeCredentialsResolver());
    expect(result.success).toBe(false);
    expect(result.status).toBe(500);
    expect(result.message).toContain('unexpected error');
    expect(result.message).toContain('500');
  });

  it('should return failure when fetch throws a network error', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await adapter.test(makeConnection(), makeCredentialsResolver());
    expect(result.success).toBe(false);
    expect(result.message).toContain('ECONNREFUSED');
  });

  it('should return a timeout message when fetch is aborted by the request timeout', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    jest.spyOn(global, 'fetch').mockRejectedValue(abortError);
    const result = await adapter.test(makeConnection(), makeCredentialsResolver());
    expect(result.success).toBe(false);
    expect(result.status).toBeUndefined();
    expect(result.message).toContain('timed out');
  });

  it('should return failure when connection config is missing siteUrl', async () => {
    const connection = { id: 'conn-1', credentialsRef: 'ref-1', config: {} } as unknown as Connection;
    const result = await adapter.test(connection, makeCredentialsResolver());
    expect(result.success).toBe(false);
    expect(result.message).toContain('siteUrl');
  });

  it('should include latencyMs in result', async () => {
    stubFetch(200);
    const result = await adapter.test(makeConnection(), makeCredentialsResolver());
    expect(typeof result.latencyMs).toBe('number');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
