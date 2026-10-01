import type { Connection } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';
import type { HttpTransportFactoryPort } from '@openlinker/shared/http';

import { SHOPER_REQUIRED_SCOPES } from '../../../shoper.constants';
import { ShoperConnectionTesterAdapter } from '../shoper-connection-tester.adapter';

const TOKEN = 'secret-token-value';

function connection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-1',
    platformType: 'shoper',
    name: 'Shop',
    status: 'active',
    config: { baseUrl: 'xxxxx.shoparena.pl' },
    credentialsRef: 'db:cred-1',
    ...overrides,
  } as Connection;
}

function setup(
  fetchImpl: jest.Mock,
  credentials: unknown = { token: TOKEN },
): {
  tester: ShoperConnectionTesterAdapter;
  resolver: CredentialsResolverPort;
  http: HttpTransportFactoryPort;
} {
  const http = {
    forConnection: jest.fn().mockReturnValue(fetchImpl),
  } as unknown as HttpTransportFactoryPort;
  const resolver = {
    get: jest.fn().mockResolvedValue(credentials),
  } as unknown as CredentialsResolverPort;
  return { tester: new ShoperConnectionTesterAdapter(http), resolver, http };
}

function reply(status: number, body: unknown = {}): jest.Mock {
  return jest.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

describe('ShoperConnectionTesterAdapter', () => {
  it('should succeed when application-config answers 200, through the connection-bound transport', async () => {
    const fetchImpl = reply(200, { shop: 'x' });
    const { tester, resolver, http } = setup(fetchImpl);
    const conn = connection();

    const result = await tester.test(conn, resolver);

    expect(result).toMatchObject({ success: true, status: 200, message: 'OK' });
    expect(http.forConnection).toHaveBeenCalledWith(conn);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://xxxxx.shoparena.pl/webapi/rest/application-config',
      expect.anything(),
    );
  });

  it('should explain a 401 as a rejected token', async () => {
    const { tester, resolver } = setup(reply(401, { error: 'unauthorized_client' }));

    const result = await tester.test(connection(), resolver);

    expect(result).toMatchObject({ success: false, status: 401 });
    expect(result.message).toContain('rejected the API token');
  });

  it('should list the required areas on a 403', async () => {
    const { tester, resolver } = setup(reply(403, { error: 'insufficient_scope' }));

    const result = await tester.test(connection(), resolver);

    expect(result).toMatchObject({ success: false, status: 403 });
    for (const scope of SHOPER_REQUIRED_SCOPES) {
      expect(result.message).toContain(scope);
    }
  });

  it('should say the REST API was not found on a 404', async () => {
    const { tester, resolver } = setup(reply(404));

    const result = await tester.test(connection(), resolver);

    expect(result).toMatchObject({ success: false, status: 404 });
    expect(result.message).toContain('not found');
  });

  it('should report an unexpected 5xx without leaking the shop body', async () => {
    const { tester, resolver } = setup(reply(503, { error: 'server_error' }));

    const result = await tester.test(connection(), resolver);

    expect(result).toMatchObject({ success: false, status: 503 });
    expect(result.message).toContain('HTTP 503');
  });

  it('should surface the underlying network error', async () => {
    const { tester, resolver } = setup(
      jest.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND')),
    );

    const result = await tester.test(connection(), resolver);

    expect(result.success).toBe(false);
    expect(result.message).toContain('ENOTFOUND');
  });

  it.each([
    ['no baseUrl', { config: {} }, 'Invalid connection config'],
    ['a private baseUrl', { config: { baseUrl: '10.0.0.1' } }, 'Invalid connection config'],
    ['no credentialsRef', { credentialsRef: '' }, 'no stored credentials'],
  ])('should fail without any request when the connection has %s', async (_label, patch, text) => {
    const fetchImpl = jest.fn();
    const { tester, resolver } = setup(fetchImpl);

    const result = await tester.test(connection(patch as Partial<Connection>), resolver);

    expect(result.success).toBe(false);
    expect(result.message).toContain(text);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('should fail when the stored credentials carry no token', async () => {
    const fetchImpl = jest.fn();
    const { tester, resolver } = setup(fetchImpl, {});

    const result = await tester.test(connection(), resolver);

    expect(result).toMatchObject({
      success: false,
      message: 'Stored credentials have no API token',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('should never throw or return the token, even when credential resolution fails', async () => {
    const { tester, resolver } = setup(reply(200));
    (resolver.get as jest.Mock).mockRejectedValue(new Error('vault unavailable'));

    const result = await tester.test(connection(), resolver);

    expect(result).toMatchObject({ success: false, message: 'vault unavailable' });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });
});
