/**
 * Allegro Category Catalog Client — unit tests
 *
 * Stubs `global.fetch` (sibling convention, see `erli-http-client.spec.ts`) to
 * verify client-credentials token acquisition, the proactive-refresh-window
 * cache, the category/parameter response mapping, and typed-exception
 * classification for a rejected token request and a network failure.
 *
 * Parity note (#1382 review): the "cross-plugin mapper parity" block below
 * runs Allegro's own real sandbox fixture through this client's independently
 * -maintained copy of `toNeutralCategoryParameter`, with assertions mirrored
 * from `allegro-category-parameter.mapper.spec.ts` — a change to either
 * mapper's behavior should prompt updating both spec files.
 *
 * @module libs/integrations/erli/src/infrastructure/http
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ErliAuthenticationException } from '../../../domain/exceptions/erli-authentication.exception';
import { ErliNetworkException } from '../../../domain/exceptions/erli-network.exception';
import { AllegroCategoryCatalogClient } from '../allegro-category-catalog-client';

/** Allegro's real sandbox capture (cat 257933, "Aparaty cyfrowe") — shared with `allegro-category-parameter.mapper.spec.ts`. */
const ALLEGRO_FIXTURE_PATH = resolve(
  __dirname,
  '../../../../../allegro/src/infrastructure/adapters/__fixtures__/category-parameters-257933.json'
);

interface AllegroFixtureParameter {
  id: string;
  options?: { describesProduct?: boolean };
  dictionary?: Array<{ dependsOnValueIds?: string[] }>;
}

function loadAllegroFixture(): { parameters: AllegroFixtureParameter[] } {
  return JSON.parse(readFileSync(ALLEGRO_FIXTURE_PATH, 'utf8')) as {
    parameters: AllegroFixtureParameter[];
  };
}

function findFixtureParam(
  fixture: { parameters: AllegroFixtureParameter[] },
  id: string
): AllegroFixtureParameter {
  const found = fixture.parameters.find((p) => p.id === id);
  if (!found) throw new Error(`Fixture missing parameter ${id}`);
  return found;
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: (): Promise<unknown> => Promise.resolve(body),
    text: (): Promise<string> => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

/** Typed view of the recorded `fetch(url, init)` calls (avoids `any` access). */
type RecordedCall = [url: string, init?: { method?: string; headers?: Record<string, string> }];
function recordedCalls(mock: jest.Mock): RecordedCall[] {
  return mock.mock.calls as RecordedCall[];
}

const CLIENT_ID = 'test-client-id';
const CLIENT_SECRET = 'test-client-secret';

describe('AllegroCategoryCatalogClient', () => {
  let fetchMock: jest.Mock;
  let client: AllegroCategoryCatalogClient;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    client = new AllegroCategoryCatalogClient(CLIENT_ID, CLIENT_SECRET, 'sandbox');
  });

  describe('token acquisition', () => {
    it('should acquire a token via grant_type=client_credentials on first call', async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse(200, { access_token: 'app-token-1', expires_in: 3600, token_type: 'bearer' })
        )
        .mockResolvedValueOnce(jsonResponse(200, { categories: [] }));

      await client.fetchCategories();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const [tokenUrl, tokenInit] = recordedCalls(fetchMock)[0];
      expect(tokenUrl).toBe('https://allegro.pl.allegrosandbox.pl/auth/oauth/token');
      expect(tokenInit?.method).toBe('POST');
      expect(tokenInit?.headers?.Authorization).toBe(
        `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`
      );
    });

    it('should reuse the cached token within the freshness window', async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse(200, { access_token: 'app-token-1', expires_in: 3600, token_type: 'bearer' })
        )
        .mockResolvedValueOnce(jsonResponse(200, { categories: [] }))
        .mockResolvedValueOnce(jsonResponse(200, { categories: [] }));

      await client.fetchCategories();
      await client.fetchCategories();

      // One token request + two category requests — token not re-acquired.
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('should re-acquire the token after it expires', async () => {
      const nowSpy = jest.spyOn(Date, 'now');
      nowSpy.mockReturnValue(1_000_000);

      fetchMock
        .mockResolvedValueOnce(
          // expires_in: 30s — well inside the 60s refresh window, so any
          // later call proactively re-acquires.
          jsonResponse(200, { access_token: 'app-token-1', expires_in: 30, token_type: 'bearer' })
        )
        .mockResolvedValueOnce(jsonResponse(200, { categories: [] }))
        .mockResolvedValueOnce(
          jsonResponse(200, { access_token: 'app-token-2', expires_in: 3600, token_type: 'bearer' })
        )
        .mockResolvedValueOnce(jsonResponse(200, { categories: [] }));

      await client.fetchCategories();
      nowSpy.mockReturnValue(1_000_000 + 31_000);
      await client.fetchCategories();

      expect(fetchMock).toHaveBeenCalledTimes(4);
      const secondCategoriesCall = recordedCalls(fetchMock)[3];
      expect(secondCategoriesCall[1]?.headers?.Authorization).toBe('Bearer app-token-2');

      nowSpy.mockRestore();
    });

    it('should throw ErliAuthenticationException for a non-2xx token response', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: 'invalid_client' }));

      await expect(client.fetchCategories()).rejects.toThrow(ErliAuthenticationException);
    });

    it('should throw ErliNetworkException when the token request fails at the network level', async () => {
      fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      await expect(client.fetchCategories()).rejects.toThrow(ErliNetworkException);
    });
  });

  describe('fetchCategories', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, { access_token: 'app-token-1', expires_in: 3600, token_type: 'bearer' })
      );
    });

    it('should map the raw category response to the neutral OfferCategory shape', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, {
          categories: [
            { id: '1', name: 'Root', parent: null, leaf: false },
            { id: '2', name: 'Child', parent: { id: '1' }, leaf: true },
          ],
        })
      );

      const result = await client.fetchCategories('1');

      expect(result).toEqual([
        { id: '1', name: 'Root', parentId: null, leaf: false },
        { id: '2', name: 'Child', parentId: '1', leaf: true },
      ]);
      const [categoriesUrl] = recordedCalls(fetchMock)[1];
      expect(categoriesUrl).toBe(
        'https://api.allegro.pl.allegrosandbox.pl/sale/categories?parent.id=1'
      );
    });

    it('should request the root category list when parentId is omitted', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { categories: [] }));

      await client.fetchCategories();

      const [categoriesUrl] = recordedCalls(fetchMock)[1];
      expect(categoriesUrl).toBe('https://api.allegro.pl.allegrosandbox.pl/sale/categories');
    });

    it('should throw ErliNetworkException when the categories request fails at the network level', async () => {
      fetchMock.mockRejectedValueOnce(new Error('ETIMEDOUT'));

      await expect(client.fetchCategories()).rejects.toThrow(ErliNetworkException);
    });
  });

  describe('fetchCategoryParameters', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, { access_token: 'app-token-1', expires_in: 3600, token_type: 'bearer' })
      );
    });

    it('should map the raw parameter response to the neutral CategoryParameter shape', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, {
          parameters: [
            {
              id: 'p1',
              name: 'Stan',
              type: 'dictionary',
              required: true,
              options: { describesProduct: false },
              dictionary: [
                { id: 'v1', value: 'Nowy' },
                { id: 'v2', value: 'Używany' },
              ],
              restrictions: { multipleChoices: false },
            },
            {
              id: 'p2',
              name: 'Marka',
              type: 'string',
              required: false,
              options: { describesProduct: true, customValuesEnabled: true },
              restrictions: { allowedNumberOfValues: 5 },
            },
          ],
        })
      );

      const result = await client.fetchCategoryParameters('123');

      expect(result).toEqual([
        {
          id: 'p1',
          name: 'Stan',
          type: 'dictionary',
          required: true,
          multiValue: false,
          unit: undefined,
          dictionary: [
            { id: 'v1', value: 'Nowy', dependsOnValueIds: undefined },
            { id: 'v2', value: 'Używany', dependsOnValueIds: undefined },
          ],
          restrictions: {
            multipleChoices: false,
            range: undefined,
            min: undefined,
            max: undefined,
            minLength: undefined,
            maxLength: undefined,
            precision: undefined,
            allowedNumberOfValues: undefined,
            customValuesEnabled: undefined,
          },
          dependsOn: undefined,
          section: 'offer',
        },
        {
          id: 'p2',
          name: 'Marka',
          type: 'string',
          required: false,
          multiValue: true,
          unit: undefined,
          dictionary: undefined,
          restrictions: {
            multipleChoices: undefined,
            range: undefined,
            min: undefined,
            max: undefined,
            minLength: undefined,
            maxLength: undefined,
            precision: undefined,
            allowedNumberOfValues: 5,
            customValuesEnabled: true,
          },
          dependsOn: undefined,
          section: 'product',
        },
      ]);
      const [parametersUrl] = recordedCalls(fetchMock)[1];
      expect(parametersUrl).toBe(
        'https://api.allegro.pl.allegrosandbox.pl/sale/categories/123/parameters'
      );
    });

    it('should surface parameter-level dependsOn from dictionary entry dependsOnValueIds', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, {
          parameters: [
            {
              id: 'p3',
              name: 'Rozmiar',
              type: 'dictionary',
              required: false,
              options: { dependsOnParameterId: 'p1' },
              dictionary: [
                { id: 'v3', value: 'S', dependsOnValueIds: ['v1'] },
                { id: 'v4', value: 'M', dependsOnValueIds: ['v1', 'v2'] },
              ],
            },
          ],
        })
      );

      const result = await client.fetchCategoryParameters('123');

      expect(result[0].dependsOn).toEqual({
        parameterId: 'p1',
        valueIds: expect.arrayContaining(['v1', 'v2']),
      });
    });
  });

  describe('token single-flight', () => {
    it('should issue exactly one token request for two concurrent calls on a cold cache', async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse(200, { access_token: 'app-token-1', expires_in: 3600, token_type: 'bearer' })
        )
        .mockResolvedValueOnce(jsonResponse(200, { categories: [] }))
        .mockResolvedValueOnce(jsonResponse(200, { parameters: [] }));

      await Promise.all([client.fetchCategories(), client.fetchCategoryParameters('1')]);

      const tokenRequests = recordedCalls(fetchMock).filter(([url]) => url.includes('/auth/oauth/token'));
      expect(tokenRequests).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('should treat a token response missing expires_in as already-expired', async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse(200, { access_token: 'app-token-1', token_type: 'bearer' })
        )
        .mockResolvedValueOnce(jsonResponse(200, { categories: [] }))
        .mockResolvedValueOnce(
          jsonResponse(200, { access_token: 'app-token-2', expires_in: 3600, token_type: 'bearer' })
        )
        .mockResolvedValueOnce(jsonResponse(200, { categories: [] }));

      await client.fetchCategories();
      await client.fetchCategories();

      // A token with no expires_in must never be treated as never-expiring —
      // the second call re-acquires rather than reusing app-token-1 forever.
      expect(fetchMock).toHaveBeenCalledTimes(4);
      const secondCategoriesCall = recordedCalls(fetchMock)[3];
      expect(secondCategoriesCall[1]?.headers?.Authorization).toBe('Bearer app-token-2');
    });
  });

  describe('distributed token cache (#1399 review)', () => {
    function inMemoryCachePort(): {
      get: jest.Mock;
      set: jest.Mock;
      delete: jest.Mock;
      store: Map<string, unknown>;
    } {
      const store = new Map<string, unknown>();
      return {
        store,
        get: jest.fn((key: string) => Promise.resolve(store.has(key) ? store.get(key) : null)),
        set: jest.fn((key: string, value: unknown) => {
          store.set(key, value);
          return Promise.resolve();
        }),
        delete: jest.fn((key: string) => {
          store.delete(key);
          return Promise.resolve();
        }),
      };
    }

    it('should write the acquired token to the cache keyed by clientId', async () => {
      const cache = inMemoryCachePort();
      const cachedClient = new AllegroCategoryCatalogClient(CLIENT_ID, CLIENT_SECRET, 'sandbox', cache);
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse(200, { access_token: 'app-token-1', expires_in: 3600, token_type: 'bearer' })
        )
        .mockResolvedValueOnce(jsonResponse(200, { categories: [] }));

      await cachedClient.fetchCategories();

      expect(cache.set).toHaveBeenCalledWith(
        `erli:allegro-category-token:${CLIENT_ID}`,
        expect.objectContaining({ accessToken: 'app-token-1' }),
        expect.any(Number)
      );
    });

    it('should reuse a token found in the cache instead of re-acquiring, across separate client instances', async () => {
      const cache = inMemoryCachePort();
      const first = new AllegroCategoryCatalogClient(CLIENT_ID, CLIENT_SECRET, 'sandbox', cache);
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse(200, { access_token: 'shared-token', expires_in: 3600, token_type: 'bearer' })
        )
        .mockResolvedValueOnce(jsonResponse(200, { categories: [] }));
      await first.fetchCategories();

      // A fresh instance (e.g. built by a later, unrelated `createAdapters`
      // call) sharing the same CachePort must find the token in `cache`
      // rather than paying another OAuth round-trip.
      const second = new AllegroCategoryCatalogClient(CLIENT_ID, CLIENT_SECRET, 'sandbox', cache);
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { categories: [] }));
      await second.fetchCategories();

      const tokenRequests = recordedCalls(fetchMock).filter(([url]) => url.includes('/auth/oauth/token'));
      expect(tokenRequests).toHaveLength(1);
      const secondCategoriesCall = recordedCalls(fetchMock)[2];
      expect(secondCategoriesCall[1]?.headers?.Authorization).toBe('Bearer shared-token');
    });

    it('should re-acquire when the cached entry is expired, even if present in the cache', async () => {
      const cache = inMemoryCachePort();
      const nowSpy = jest.spyOn(Date, 'now');
      nowSpy.mockReturnValue(1_000_000);
      cache.store.set(`erli:allegro-category-token:${CLIENT_ID}`, {
        accessToken: 'stale-shared-token',
        expiresAt: 1_000_000 - 1,
      });
      const cachedClient = new AllegroCategoryCatalogClient(CLIENT_ID, CLIENT_SECRET, 'sandbox', cache);
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse(200, { access_token: 'fresh-token', expires_in: 3600, token_type: 'bearer' })
        )
        .mockResolvedValueOnce(jsonResponse(200, { categories: [] }));

      await cachedClient.fetchCategories();

      const tokenRequests = recordedCalls(fetchMock).filter(([url]) => url.includes('/auth/oauth/token'));
      expect(tokenRequests).toHaveLength(1);
      nowSpy.mockRestore();
    });

    it('should behave exactly as before (in-memory only) when no cache is supplied', async () => {
      // `client` (from the outer beforeEach) is constructed without a cache —
      // backward-compat: no CachePort dependency introduced for existing callers.
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse(200, { access_token: 'app-token-1', expires_in: 3600, token_type: 'bearer' })
        )
        .mockResolvedValueOnce(jsonResponse(200, { categories: [] }));

      await client.fetchCategories();

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('auth rejection on a data call (distinct from the token endpoint)', () => {
    it('should throw ErliAuthenticationException when /sale/categories itself rejects the bearer token', async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse(200, { access_token: 'stale-token', expires_in: 3600, token_type: 'bearer' })
        )
        .mockResolvedValueOnce(jsonResponse(401, { error: 'invalid_token' }));

      await expect(client.fetchCategories()).rejects.toThrow(ErliAuthenticationException);
    });

    it('should throw ErliAuthenticationException when /sale/categories/{id}/parameters rejects the bearer token', async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse(200, { access_token: 'stale-token', expires_in: 3600, token_type: 'bearer' })
        )
        .mockResolvedValueOnce(jsonResponse(403, { error: 'access_denied' }));

      await expect(client.fetchCategoryParameters('1')).rejects.toThrow(ErliAuthenticationException);
    });
  });

  describe('cross-plugin mapper parity (#1382 review — Allegro mapper drift guard)', () => {
    let fixture: { parameters: AllegroFixtureParameter[] };

    beforeAll(() => {
      fixture = loadAllegroFixture();
    });

    beforeEach(() => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, { access_token: 'app-token-1', expires_in: 3600, token_type: 'bearer' })
      );
    });

    it('should map every parameter in Allegro\'s real sandbox capture without throwing', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(200, fixture));

      const result = await client.fetchCategoryParameters('257933');

      expect(result).toHaveLength(fixture.parameters.length);
    });

    it("should emit section: 'product' for the Marka parameter (describesProduct: true)", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(200, fixture));
      const raw = findFixtureParam(fixture, '248811'); // "Marka" — same case as the Allegro spec
      expect(raw.options?.describesProduct).toBe(true);

      const result = await client.fetchCategoryParameters('257933');

      const neutral = result.find((p) => p.id === '248811');
      expect(neutral?.section).toBe('product');
    });

    it("should emit section: 'offer' for the Stan parameter (describesProduct absent)", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(200, fixture));
      const raw = findFixtureParam(fixture, '11323'); // "Stan" — same case as the Allegro spec
      expect(raw.options?.describesProduct).not.toBe(true);

      const result = await client.fetchCategoryParameters('257933');

      const neutral = result.find((p) => p.id === '11323');
      expect(neutral?.section).toBe('offer');
    });

    it('should build dependsOn from the parameter-level dependency + entry-value union, matching the Allegro mapper', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(200, fixture));
      const raw = findFixtureParam(fixture, '229205'); // "Stan opakowania" — same case as the Allegro spec

      const result = await client.fetchCategoryParameters('257933');

      const neutral = result.find((p) => p.id === '229205');
      expect(neutral?.dependsOn?.parameterId).toBe('11323');
      const expectedValueIds = raw.dictionary?.[0]?.dependsOnValueIds ?? [];
      expect(new Set(neutral?.dependsOn?.valueIds ?? [])).toEqual(new Set(expectedValueIds));
    });
  });
});
