/**
 * DPD Connection Tester Adapter Unit Tests
 *
 * Verifies the empty-body auth probe interprets DPDServices statuses correctly
 * (400 ⇒ auth OK, 401/403 ⇒ failure), gates the `X-DPD-FID` header on
 * `masterFid`, and never throws — failures become structured
 * `ConnectionTestResult` values.
 *
 * @module libs/integrations/dpd-polska/src/infrastructure/adapters/__tests__
 */
import { DpdConnectionTesterAdapter } from '../dpd-connection-tester.adapter';
import { Connection } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';

function buildConnection(config: Record<string, unknown>): Connection {
  return new Connection(
    'c1',
    'dpd',
    'DPD Sandbox',
    'active',
    config,
    'db:ref',
    new Date(),
    new Date(),
    'dpd.polska.rest.v1',
    ['ShippingProviderManager'],
  );
}

describe('DpdConnectionTesterAdapter', () => {
  const tester = new DpdConnectionTesterAdapter();
  const resolver: CredentialsResolverPort = {
    get: jest.fn().mockResolvedValue({ login: 'test', password: 'secret' }),
  } as unknown as CredentialsResolverPort;

  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('returns success when the probe is rejected at validation (HTTP 400)', async () => {
    fetchMock.mockResolvedValue({ status: 400 } as Response);

    const result = await tester.test(buildConnection({ environment: 'sandbox', masterFid: '1495' }), resolver);

    expect(result.success).toBe(true);
    expect(result.status).toBe(400);
    expect(result.message).toBe('OK');
  });

  it('returns failure with status 401 when credentials are rejected', async () => {
    fetchMock.mockResolvedValue({ status: 401 } as Response);

    const result = await tester.test(buildConnection({ environment: 'sandbox', masterFid: '1495' }), resolver);

    expect(result.success).toBe(false);
    expect(result.status).toBe(401);
    expect(result.message).toContain('401');
  });

  it('returns failure for an unexpected status', async () => {
    fetchMock.mockResolvedValue({ status: 500 } as Response);

    const result = await tester.test(buildConnection({ environment: 'sandbox', masterFid: '1495' }), resolver);

    expect(result.success).toBe(false);
    expect(result.status).toBe(500);
  });

  function firstCall(): [string, RequestInit] {
    return fetchMock.mock.calls[0] as [string, RequestInit];
  }

  it('sends the X-DPD-FID header when masterFid is set', async () => {
    fetchMock.mockResolvedValue({ status: 400 } as Response);

    await tester.test(buildConnection({ environment: 'sandbox', masterFid: '1495' }), resolver);

    const headers = firstCall()[1].headers as Record<string, string>;
    expect(headers['X-DPD-FID']).toBe('1495');
    expect(headers.Authorization).toMatch(/^Basic /);
  });

  it('omits the X-DPD-FID header when masterFid is absent', async () => {
    fetchMock.mockResolvedValue({ status: 400 } as Response);

    await tester.test(buildConnection({ environment: 'sandbox' }), resolver);

    const headers = firstCall()[1].headers as Record<string, string>;
    expect(headers['X-DPD-FID']).toBeUndefined();
  });

  it('targets the sandbox host for a sandbox connection', async () => {
    fetchMock.mockResolvedValue({ status: 400 } as Response);

    await tester.test(buildConnection({ environment: 'sandbox', masterFid: '1495' }), resolver);

    expect(firstCall()[0]).toBe(
      'https://dpdservicesdemo.dpd.com.pl/public/shipment/v1/generatePackagesNumbers',
    );
  });

  it('fails without throwing on a network error', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));

    const result = await tester.test(buildConnection({ environment: 'sandbox', masterFid: '1495' }), resolver);

    expect(result.success).toBe(false);
    expect(result.message).toContain('network down');
  });

  it('fails when the environment is missing', async () => {
    const result = await tester.test(buildConnection({ masterFid: '1495' }), resolver);

    expect(result.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
