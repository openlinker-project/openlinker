/**
 * AllegroOAuthCompletionAdapter unit tests (#859).
 *
 * Pins the three port methods relocated from the host:
 *   - buildAuthorizationUrl: per-environment base URL + query params.
 *   - exchangeCode: the *normalized* credential-blob shape the host persists
 *     verbatim (exactly {accessToken, refreshToken, expiresAt, clientId,
 *     clientSecret}) + the 400-vs-500 error split (OAuthCodeExchangeException
 *     on non-OK, AllegroNetworkException on transport failure).
 *   - fetchAccountIdentity: delegates to AllegroAccountReader and maps the
 *     seller identity to the neutral OAuthAccountIdentity; throws on failure.
 */
import { OAuthCodeExchangeException } from '@openlinker/core/integrations';
import { AllegroOAuthCompletionAdapter } from '../allegro-oauth-completion.adapter';
import type { AllegroAccountReader } from '../../http/allegro-account-reader';
import { AllegroNetworkException } from '../../../domain/exceptions/allegro-network.exception';

describe('AllegroOAuthCompletionAdapter', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function mockFetchResolve(value: Partial<Response>): jest.Mock {
    const fn = jest.fn().mockResolvedValue(value);
    global.fetch = fn as unknown as typeof fetch;
    return fn;
  }

  function mockFetchReject(error: unknown): jest.Mock {
    const fn = jest.fn().mockRejectedValue(error);
    global.fetch = fn as unknown as typeof fetch;
    return fn;
  }

  describe('buildAuthorizationUrl', () => {
    it('builds the sandbox authorize URL with the OAuth query params', () => {
      const adapter = new AllegroOAuthCompletionAdapter();
      const url = new URL(
        adapter.buildAuthorizationUrl({
          clientId: 'client-1',
          redirectUri: 'https://ol.test/cb',
          state: 'st-1',
          config: { environment: 'sandbox' },
        })
      );

      expect(url.origin).toBe('https://allegro.pl.allegrosandbox.pl');
      expect(url.pathname).toBe('/auth/oauth/authorize');
      expect(url.searchParams.get('client_id')).toBe('client-1');
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('redirect_uri')).toBe('https://ol.test/cb');
      expect(url.searchParams.get('state')).toBe('st-1');
    });

    it('uses the production base URL when environment is production', () => {
      const adapter = new AllegroOAuthCompletionAdapter();
      const url = new URL(
        adapter.buildAuthorizationUrl({
          clientId: 'c',
          redirectUri: 'https://ol.test/cb',
          state: 's',
          config: { environment: 'production' },
        })
      );
      expect(url.origin).toBe('https://allegro.pl');
    });

    it('defaults to sandbox when config/environment is absent', () => {
      const adapter = new AllegroOAuthCompletionAdapter();
      const url = new URL(
        adapter.buildAuthorizationUrl({ clientId: 'c', redirectUri: 'https://ol.test/cb', state: 's' })
      );
      expect(url.origin).toBe('https://allegro.pl.allegrosandbox.pl');
    });
  });

  describe('exchangeCode', () => {
    const input = {
      code: 'auth-code',
      clientId: 'client-1',
      clientSecret: 'secret-1',
      redirectUri: 'https://ol.test/cb',
      config: { environment: 'sandbox' },
    };

    it('returns the normalized credential blob with exactly the persisted keys', async () => {
      const fetchMock = mockFetchResolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            access_token: 'at-1',
            refresh_token: 'rt-1',
            expires_in: 3600,
            token_type: 'bearer',
          }),
      });
      const adapter = new AllegroOAuthCompletionAdapter();

      const blob = await adapter.exchangeCode(input);

      // The blob is persisted verbatim and read back by AllegroTokenRefreshService —
      // its key set is the contract.
      expect(Object.keys(blob).sort()).toEqual(
        ['accessToken', 'clientId', 'clientSecret', 'expiresAt', 'refreshToken'].sort()
      );
      expect(blob.accessToken).toBe('at-1');
      expect(blob.refreshToken).toBe('rt-1');
      expect(blob.clientId).toBe('client-1');
      expect(blob.clientSecret).toBe('secret-1');
      expect(typeof blob.expiresAt).toBe('string');

      // Token endpoint + Basic auth + form grant.
      const [url, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://allegro.pl.allegrosandbox.pl/auth/oauth/token');
      expect((requestInit.headers as Record<string, string>).Authorization).toBe(
        `Basic ${Buffer.from('client-1:secret-1').toString('base64')}`
      );
      expect(requestInit.body).toContain('grant_type=authorization_code');
      expect(requestInit.body).toContain('code=auth-code');
    });

    it('leaves expiresAt undefined when the provider omits expires_in (key still present)', async () => {
      mockFetchResolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ access_token: 'at', token_type: 'bearer' }),
      });
      const adapter = new AllegroOAuthCompletionAdapter();

      const blob = await adapter.exchangeCode(input);

      expect(blob.expiresAt).toBeUndefined();
      expect('expiresAt' in blob).toBe(true);
    });

    it('throws OAuthCodeExchangeException on a non-OK token response (host maps to 400)', async () => {
      mockFetchResolve({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: () => Promise.resolve('invalid_grant'),
      });
      const adapter = new AllegroOAuthCompletionAdapter();

      await expect(adapter.exchangeCode(input)).rejects.toBeInstanceOf(OAuthCodeExchangeException);
    });

    it('throws AllegroNetworkException on a transport failure (host maps to 500)', async () => {
      mockFetchReject(new TypeError('fetch failed'));
      const adapter = new AllegroOAuthCompletionAdapter();

      await expect(adapter.exchangeCode(input)).rejects.toBeInstanceOf(AllegroNetworkException);
    });

    it('uses the OAuth host (not the REST api. host) for the token endpoint', async () => {
      // Negative regression guard for the symmetrical inverse of the /me
      // host bug: the token endpoint must never inherit the `api.` REST
      // host. Token exchange lives on Allegro's OAuth/site origin.
      const fetchMock = mockFetchResolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ access_token: 'at', refresh_token: 'rt', token_type: 'bearer' }),
      });
      const adapter = new AllegroOAuthCompletionAdapter();

      await adapter.exchangeCode(input);

      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).not.toMatch(/^https:\/\/api\./);
    });
  });

  describe('fetchAccountIdentity', () => {
    it('maps the Allegro seller identity to the neutral OAuthAccountIdentity', async () => {
      const reader = {
        fetchSellerIdentity: jest.fn().mockResolvedValue({ sellerId: '12345', login: 'my_shop' }),
      } as unknown as AllegroAccountReader;
      const adapter = new AllegroOAuthCompletionAdapter(reader);

      const identity = await adapter.fetchAccountIdentity({
        credentials: { accessToken: 'at-1' },
        config: { environment: 'production' },
      });

      expect(identity).toEqual({ accountId: '12345', label: 'my_shop' });
      // `/me` lives on Allegro's REST API host (`api.` subdomain), not the
      // OAuth/site host the authorize + token endpoints use.
      expect(reader.fetchSellerIdentity).toHaveBeenCalledWith('https://api.allegro.pl', 'at-1');
    });

    it('passes the sandbox REST API host (api. subdomain) when environment is sandbox', async () => {
      const reader = {
        fetchSellerIdentity: jest.fn().mockResolvedValue({ sellerId: '999', login: 'sb_shop' }),
      } as unknown as AllegroAccountReader;
      const adapter = new AllegroOAuthCompletionAdapter(reader);

      await adapter.fetchAccountIdentity({
        credentials: { accessToken: 'at-2' },
        config: { environment: 'sandbox' },
      });

      expect(reader.fetchSellerIdentity).toHaveBeenCalledWith(
        'https://api.allegro.pl.allegrosandbox.pl',
        'at-2',
      );
    });

    it('propagates the reader failure (host treats it as fatal to completion)', async () => {
      const boom = new AllegroNetworkException('GET /me failed', '/me');
      const reader = {
        fetchSellerIdentity: jest.fn().mockRejectedValue(boom),
      } as unknown as AllegroAccountReader;
      const adapter = new AllegroOAuthCompletionAdapter(reader);

      await expect(
        adapter.fetchAccountIdentity({ credentials: { accessToken: 'at-1' } })
      ).rejects.toBe(boom);
    });

    it('throws when the credential blob carries no usable access token', async () => {
      const reader = { fetchSellerIdentity: jest.fn() } as unknown as AllegroAccountReader;
      const adapter = new AllegroOAuthCompletionAdapter(reader);

      await expect(adapter.fetchAccountIdentity({ credentials: {} })).rejects.toBeInstanceOf(
        AllegroNetworkException
      );
      expect(reader.fetchSellerIdentity).not.toHaveBeenCalled();
    });
  });
});
