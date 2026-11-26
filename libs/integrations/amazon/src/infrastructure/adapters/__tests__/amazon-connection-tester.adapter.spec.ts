/**
 * AmazonConnectionTesterAdapter tests (#3741 foundation)
 *
 * Drives the real factory, token provider and client over a stubbed
 * transport: one LWA call, then the participations probe.
 *
 * @module libs/integrations/amazon/src/infrastructure/adapters/__tests__
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { HttpTransportFactoryPort } from '@openlinker/shared/http';

import { AmazonConnectionTesterAdapter } from '../amazon-connection-tester.adapter';

const CREDENTIALS = { clientId: 'cid', clientSecret: 'cs', refreshToken: 'Atzr|t' };

function connection(config: Record<string, unknown>): Connection {
  return {
    id: 'conn-amz-1',
    platformType: 'amazon',
    name: 'Amazon DE',
    status: 'active',
    config,
    credentialsRef: 'db:ref-1',
    enabledCapabilities: [],
    adapterKey: 'amazon.spapi.v1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const resolver = (credentials: unknown = CREDENTIALS): CredentialsResolverPort =>
  ({ get: jest.fn().mockResolvedValue(credentials) }) as unknown as CredentialsResolverPort;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

/** A transport answering LWA first, then the probe. Each test gets its own credentials, so no memo leaks. */
function transport(...responses: Response[]): { http: HttpTransportFactoryPort; fetchImpl: jest.Mock } {
  const fetchImpl = jest.fn();
  for (const r of responses) {
    fetchImpl.mockResolvedValueOnce(r);
  }
  return { http: { forConnection: jest.fn().mockReturnValue(fetchImpl), evict: jest.fn() } as unknown as HttpTransportFactoryPort, fetchImpl };
}

const participations = (...ids: string[]): Record<string, unknown> => ({
  payload: ids.map((id) => ({ marketplace: { id }, participation: { isParticipating: true } })),
});

/** URL of the n-th transport call. */
function calledUrl(fetchImpl: jest.Mock, index: number): string {
  return (fetchImpl.mock.calls[index] as [string, RequestInit])[0];
}

let seq = 0;
const uniqueCredentials = (): typeof CREDENTIALS => ({ ...CREDENTIALS, refreshToken: `Atzr|t${(seq += 1)}` });

describe('AmazonConnectionTesterAdapter', () => {
  it('should pass when the seller sells in every configured marketplace', async () => {
    const { http, fetchImpl } = transport(
      json(200, { access_token: 'Atza|1', expires_in: 3600 }),
      json(200, participations('A1PA6795UKMFR9', 'A13V1IB3VIYZZH')),
    );
    const result = await new AmazonConnectionTesterAdapter(http).test(
      connection({ marketplaceIds: ['A1PA6795UKMFR9'] }),
      resolver(uniqueCredentials()),
    );

    expect(result).toMatchObject({ success: true, status: 200 });
    expect(calledUrl(fetchImpl, 1)).toBe(
      'https://sellingpartnerapi-eu.amazon.com/sellers/v1/marketplaceParticipations',
    );
  });

  it('should fail and name a configured marketplace the seller does not sell in', async () => {
    const { http } = transport(
      json(200, { access_token: 'Atza|1' }),
      json(200, participations('A1PA6795UKMFR9')),
    );
    const result = await new AmazonConnectionTesterAdapter(http).test(
      connection({ marketplaceIds: ['A1PA6795UKMFR9', 'A1C3SOZRARQ6R3'] }),
      resolver(uniqueCredentials()),
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain('A1C3SOZRARQ6R3');
  });

  it('should skip the marketplace check on the sandbox', async () => {
    const { http, fetchImpl } = transport(
      json(200, { access_token: 'Atza|1' }),
      json(200, participations('ATVPDKIKX0DER')),
    );
    const result = await new AmazonConnectionTesterAdapter(http).test(
      connection({ environment: 'sandbox', marketplaceIds: ['A1PA6795UKMFR9'] }),
      resolver(uniqueCredentials()),
    );

    expect(result.success).toBe(true);
    expect(calledUrl(fetchImpl, 1)).toContain('sandbox.sellingpartnerapi-eu.amazon.com');
  });

  it('should report refused credentials as unauthorized without echoing them', async () => {
    const credentials = uniqueCredentials();
    const { http } = transport(json(400, { error: 'invalid_grant' }));
    const result = await new AmazonConnectionTesterAdapter(http).test(
      connection({ marketplaceIds: ['A1PA6795UKMFR9'] }),
      resolver(credentials),
    );

    expect(result).toMatchObject({ success: false, outcome: 'unauthorized' });
    expect(result.message).not.toContain(credentials.refreshToken);
  });

  it('should report a missing role as misconfigured, not as bad credentials', async () => {
    // The client renews the token once on a 403 Unauthorized, so the role error
    // is answered twice, with a fresh token in between.
    const denied = { errors: [{ code: 'Unauthorized', message: 'Access to requested resource is denied.' }] };
    const { http } = transport(
      json(200, { access_token: 'Atza|1' }),
      json(403, denied),
      json(200, { access_token: 'Atza|2' }),
      json(403, denied),
    );
    const result = await new AmazonConnectionTesterAdapter(http).test(
      connection({ marketplaceIds: ['A1PA6795UKMFR9'] }),
      resolver(uniqueCredentials()),
    );

    expect(result).toMatchObject({ success: false, status: 403, outcome: 'misconfigured' });
    expect(result.message).toContain('lacks a role');
  });

  it('should explain a throttled test instead of passing the Amazon message through', async () => {
    const { http } = transport(
      json(200, { access_token: 'Atza|1' }),
      json(429, { errors: [{ code: 'QuotaExceeded', message: 'You exceeded your quota for the requested resource.' }] }),
    );
    const result = await new AmazonConnectionTesterAdapter(http).test(
      connection({ marketplaceIds: ['A1PA6795UKMFR9'] }),
      resolver(uniqueCredentials()),
    );

    expect(result).toMatchObject({ success: false, status: 429 });
    expect(result.message).toContain('one connection test a minute');
  });

  it('should report an unusable config as misconfigured before any call', async () => {
    const { http, fetchImpl } = transport();
    const result = await new AmazonConnectionTesterAdapter(http).test(
      connection({ marketplaceIds: [] }),
      resolver(uniqueCredentials()),
    );

    expect(result).toMatchObject({ success: false, outcome: 'misconfigured' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('should collapse a network failure to a fixed sentence', async () => {
    const http = {
      forConnection: jest.fn().mockReturnValue(jest.fn().mockRejectedValue(new TypeError('getaddrinfo ENOTFOUND internal-host'))),
      evict: jest.fn(),
    } as unknown as HttpTransportFactoryPort;
    const result = await new AmazonConnectionTesterAdapter(http).test(
      connection({ marketplaceIds: ['A1PA6795UKMFR9'] }),
      resolver(uniqueCredentials()),
    );

    expect(result).toMatchObject({ success: false, outcome: 'unreachable' });
    expect(result.message).not.toContain('internal-host');
  });
});
