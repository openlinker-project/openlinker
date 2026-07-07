/**
 * Allegro Category Catalog Client — unit tests
 *
 * Stubs `global.fetch` (sibling convention, see `erli-http-client.spec.ts`) to
 * verify client-credentials token acquisition, the proactive-refresh-window
 * cache, the category/parameter response mapping, and typed-exception
 * classification for a rejected token request and a network failure.
 *
 * @module libs/integrations/erli/src/infrastructure/http
 */
import { ErliAuthenticationException } from '../../../domain/exceptions/erli-authentication.exception';
import { ErliNetworkException } from '../../../domain/exceptions/erli-network.exception';
import { AllegroCategoryCatalogClient } from '../allegro-category-catalog-client';

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
});
