/**
 * Allegro Token Refresh Service Tests (#499)
 *
 * Focused unit tests for the network-vs-credential failure classification
 * at the source — the bare `fetch()` call in `callRefreshEndpoint` is
 * wrapped so that fetch-level errors (`TypeError: fetch failed`, abort,
 * DNS, ECONNREFUSED) surface as `AllegroNetworkException` rather than
 * leaking out as untyped `TypeError`s. Downstream classification depends
 * on this typing.
 *
 * The full refresh flow (Redis lock, credentials resolver, DB update)
 * is exercised end-to-end through the HTTP-client spec
 * (`inherits 401 reactive token-refresh from the request loop`); these
 * tests target only the new try/catch around `fetch()`.
 *
 * @module libs/integrations/allegro/src/infrastructure/token-refresh/__tests__
 */
import { AllegroNetworkException } from '../../../domain/exceptions/allegro-network.exception';
import { AllegroTokenRefreshService } from '../allegro-token-refresh.service';
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { CredentialsResolverPort } from '@openlinker/core/integrations';

global.fetch = jest.fn();

describe('AllegroTokenRefreshService — network failure classification (#499)', () => {
  let service: AllegroTokenRefreshService;
  let credentialsResolver: jest.Mocked<CredentialsResolverPort>;
  let connection: Connection;

  beforeEach(() => {
    // No Redis client → service warns + proceeds without a distributed lock,
    // which is the path we want for unit testing.
    service = new AllegroTokenRefreshService(undefined, undefined);

    credentialsResolver = {
      get: jest.fn().mockResolvedValue({
        accessToken: 'stale',
        refreshToken: 'refresh-token-xyz',
        clientId: 'client-id-abc',
        clientSecret: 'client-secret-def',
      }),
    } as unknown as jest.Mocked<CredentialsResolverPort>;

    // Cast through unknown — the spec only exercises the fetch-wrapping
    // path and doesn't read `enabledCapabilities` / other Connection fields.
    connection = {
      id: 'conn-1',
      platformType: 'allegro',
      name: 'Test',
      status: 'active',
      config: { environment: 'sandbox' },
      credentialsRef: 'db:allegro-1',
      adapterKey: 'allegro.publicapi.v1',
      enabledCapabilities: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as Connection;

    (global.fetch as jest.Mock).mockReset();
  });

  it('wraps fetch-level failures as AllegroNetworkException with cause chain', async () => {
    // Simulates the Node native fetch failure mode — `TypeError: fetch failed`
    // — which is what hits us when DNS / TLS / connection-refused. Pre-#499
    // this leaked out as a bare TypeError and got reclassified upstream as
    // AllegroAuthenticationException, killing jobs at attempt 1/10.
    const fetchFailure = new TypeError('fetch failed');
    (global.fetch as jest.Mock).mockRejectedValueOnce(fetchFailure);

    const captured = await service
      .refreshToken(connection, credentialsResolver)
      .catch((err: Error) => err);

    expect(captured).toBeInstanceOf(AllegroNetworkException);
    expect((captured as AllegroNetworkException).message).toContain('Token refresh network failure');
    expect((captured as AllegroNetworkException).message).toContain('fetch failed');
    expect((captured as AllegroNetworkException).url).toContain('/auth/oauth/token');
    expect((captured as AllegroNetworkException).cause).toBe(fetchFailure);
  });

  it('keeps the existing throw shape when the auth endpoint responds with 4xx (credential rejection)', async () => {
    // !response.ok path is unchanged — Allegro responded with a real
    // credential rejection (refresh token revoked / invalid_grant) which
    // SHOULD be non-retryable. Don't accidentally widen the network branch
    // to swallow this case.
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: () => Promise.resolve('{"error":"invalid_grant"}'),
    });

    const captured = await service
      .refreshToken(connection, credentialsResolver)
      .catch((err: Error) => err);

    expect(captured).not.toBeInstanceOf(AllegroNetworkException);
    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).message).toContain('Failed to refresh access token');
    expect((captured as Error).message).toContain('invalid_grant');
  });
});
