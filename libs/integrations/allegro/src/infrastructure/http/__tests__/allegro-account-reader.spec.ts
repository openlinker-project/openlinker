/**
 * AllegroAccountReader unit tests (#820).
 *
 * Mocks global fetch to cover the `/me` happy path and the two failure modes
 * the OAuth flow treats as fatal (non-200, missing account id).
 */
import { AllegroAccountReader } from '../allegro-account-reader';
import { AllegroApiException } from '../../../domain/exceptions/allegro-api.exception';
import { AllegroAuthenticationException } from '../../../domain/exceptions/allegro-authentication.exception';
import { AllegroNetworkException } from '../../../domain/exceptions/allegro-network.exception';

// REST API host — `/me` and other REST calls live on the `api.` subdomain;
// the OAuth/site host (`allegro.pl.allegrosandbox.pl`) used to land here
// historically and returned 403 because it doesn't serve the REST API.
const BASE_URL = 'https://api.allegro.pl.allegrosandbox.pl';
const TOKEN = 'access-tok';

describe('AllegroAccountReader', () => {
  let reader: AllegroAccountReader;
  const originalFetch = global.fetch;

  beforeEach(() => {
    reader = new AllegroAccountReader();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function mockFetch(impl: () => Partial<Response>): jest.Mock {
    const fn = jest.fn().mockResolvedValue(impl());
    global.fetch = fn as unknown as typeof fetch;
    return fn;
  }

  it('should return the seller identity from a 200 /me response', async () => {
    const fetchMock = mockFetch(() => ({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: '12345678', login: 'my_shop' }),
    }));

    const identity = await reader.fetchSellerIdentity(BASE_URL, TOKEN);

    expect(identity).toEqual({ sellerId: '12345678', login: 'my_shop' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/me`);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect((init.headers as Record<string, string>).Accept).toBe(
      'application/vnd.allegro.public.v1+json'
    );
  });

  it('should fall back to the id for login when login is absent', async () => {
    mockFetch(() => ({ ok: true, status: 200, json: () => Promise.resolve({ id: '999' }) }));

    await expect(reader.fetchSellerIdentity(BASE_URL, TOKEN)).resolves.toEqual({
      sellerId: '999',
      login: '999',
    });
  });

  it('should throw AllegroAuthenticationException on a 401', async () => {
    mockFetch(() => ({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: () => Promise.resolve('{"error":"invalid_token"}'),
    }));

    await expect(reader.fetchSellerIdentity(BASE_URL, TOKEN)).rejects.toBeInstanceOf(
      AllegroAuthenticationException
    );
  });

  it('should throw AllegroApiException on a non-401 error response', async () => {
    mockFetch(() => ({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: () => Promise.resolve('upstream boom'),
    }));

    await expect(reader.fetchSellerIdentity(BASE_URL, TOKEN)).rejects.toBeInstanceOf(
      AllegroApiException
    );
  });

  it('should throw AllegroApiException when the body carries no account id', async () => {
    mockFetch(() => ({ ok: true, status: 200, json: () => Promise.resolve({ login: 'x' }) }));

    await expect(reader.fetchSellerIdentity(BASE_URL, TOKEN)).rejects.toBeInstanceOf(
      AllegroApiException
    );
  });

  it('should throw AllegroNetworkException when the request fails at the network level', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof fetch;

    await expect(reader.fetchSellerIdentity(BASE_URL, TOKEN)).rejects.toBeInstanceOf(
      AllegroNetworkException
    );
  });
});
