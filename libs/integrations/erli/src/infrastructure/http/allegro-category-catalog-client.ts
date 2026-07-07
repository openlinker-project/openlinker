/**
 * Allegro Category Catalog Client
 *
 * Erli-owned, self-contained HTTP client that lets an Erli connection browse
 * Allegro's public `/sale/categories` and `/sale/categories/{id}/parameters`
 * catalog via an Allegro app's `grant_type=client_credentials` token — no
 * seller/user OAuth context, no Allegro `Connection` required (#1382,
 * ADR-030).
 *
 * Deliberately does NOT import anything from `@openlinker/integrations-allegro`
 * — plugin packages are architecturally independent (ADR-003), and Erli must
 * remain buildable/shippable on its own. The proactive-refresh-window token
 * caching shape mirrors `AllegroConnectionTokenState` as a *design pattern*
 * only, re-implemented here in a simplified form: client-credentials tokens
 * are re-requested proactively before expiry rather than reactively refreshed
 * on a 401 (there's no `refresh_token` for this grant).
 *
 * Category/parameter response mapping mirrors
 * `AllegroOfferManagerAdapter.fetchCategories` /
 * `.fetchCategoryParametersRaw` field-for-field (read there for the source of
 * truth) — duplicated here per ADR-030 rather than shared, since sharing
 * would require the forbidden cross-plugin dependency.
 *
 * Plain class, no NestJS/DI — constructed per-connection by
 * `ErliAdapterFactory` (#1383) exactly like `ErliHttpClient`.
 *
 * @module libs/integrations/erli/src/infrastructure/http
 */
import type {
  CategoryParameter,
  CategoryParameterDictionaryEntry,
  OfferCategory,
} from '@openlinker/core/listings';
import { ErliAuthenticationException } from '../../domain/exceptions/erli-authentication.exception';
import { ErliNetworkException } from '../../domain/exceptions/erli-network.exception';

/** Allegro environment → web host (serves `/auth/oauth/token`). */
const SANDBOX_WEB_BASE_URL = 'https://allegro.pl.allegrosandbox.pl';
const PRODUCTION_WEB_BASE_URL = 'https://allegro.pl';

/** Allegro environment → REST host (serves `/sale/categories*`). */
const SANDBOX_REST_API_BASE_URL = 'https://api.allegro.pl.allegrosandbox.pl';
const PRODUCTION_REST_API_BASE_URL = 'https://api.allegro.pl';

const ALLEGRO_ACCEPT_HEADER = 'application/vnd.allegro.public.v1+json';

/**
 * Proactive token-refresh window — re-request when the cached token is within
 * this many ms of `expiresAt`, so a request never pays a wasted 401 round-trip
 * after an idle period. Mirrors `AllegroConnectionTokenState.TOKEN_REFRESH_WINDOW_MS`.
 */
const TOKEN_REFRESH_WINDOW_MS = 60_000;

interface AllegroTokenResponse {
  access_token: string;
  expires_in?: number;
  token_type: string;
}

/** Raw Allegro category item — `GET /sale/categories`. */
interface AllegroCategoryItem {
  id: string;
  name: string;
  parent?: { id: string } | null;
  leaf: boolean;
}

interface AllegroCategoriesResponse {
  categories: AllegroCategoryItem[];
}

/** Raw Allegro category parameter — `GET /sale/categories/{id}/parameters`. */
interface AllegroCategoryParameter {
  id: string;
  name: string;
  type: 'dictionary' | 'string' | 'integer' | 'float';
  required: boolean;
  unit?: string;
  options?: {
    dependsOnParameterId?: string;
    describesProduct?: boolean;
    customValuesEnabled?: boolean;
  };
  dictionary?: Array<{
    id: string;
    value: string;
    dependsOnValueIds?: string[];
  }>;
  restrictions?: {
    multipleChoices?: boolean;
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
    range?: boolean;
    precision?: number;
    allowedNumberOfValues?: number;
  };
}

interface AllegroCategoryParametersResponse {
  parameters: AllegroCategoryParameter[];
}

/** Cached client-credentials token state for one client instance. */
interface CachedToken {
  accessToken: string;
  expiresAt: number | undefined;
}

export class AllegroCategoryCatalogClient {
  private readonly webBaseUrl: string;
  private readonly restApiBaseUrl: string;
  private cached: CachedToken | undefined;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    environment: 'sandbox' | 'production'
  ) {
    this.webBaseUrl = environment === 'production' ? PRODUCTION_WEB_BASE_URL : SANDBOX_WEB_BASE_URL;
    this.restApiBaseUrl =
      environment === 'production' ? PRODUCTION_REST_API_BASE_URL : SANDBOX_REST_API_BASE_URL;
  }

  /**
   * `CategoryBrowser.fetchCategories` — `GET /sale/categories?parent.id=`.
   * Mirrors `AllegroOfferManagerAdapter.fetchCategories`'s field mapping.
   */
  async fetchCategories(parentId?: string): Promise<OfferCategory[]> {
    const query = parentId ? `?parent.id=${encodeURIComponent(parentId)}` : '';
    const response = await this.requestJson<AllegroCategoriesResponse>(
      `${this.restApiBaseUrl}/sale/categories${query}`
    );
    const categories = response.categories ?? [];
    return categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      parentId: cat.parent?.id ?? null,
      leaf: cat.leaf,
    }));
  }

  /**
   * `CategoryParametersReader.fetchCategoryParameters` —
   * `GET /sale/categories/{categoryId}/parameters`. Mirrors
   * `AllegroOfferManagerAdapter.fetchCategoryParametersRaw` +
   * `toNeutralCategoryParameter`'s field mapping.
   */
  async fetchCategoryParameters(categoryId: string): Promise<CategoryParameter[]> {
    const response = await this.requestJson<AllegroCategoryParametersResponse>(
      `${this.restApiBaseUrl}/sale/categories/${encodeURIComponent(categoryId)}/parameters`
    );
    return (response.parameters ?? []).map(toNeutralCategoryParameter);
  }

  /**
   * Returns a cached app token if it's more than {@link TOKEN_REFRESH_WINDOW_MS}
   * away from expiry, else acquires a fresh one via `grant_type=client_credentials`.
   */
  private async ensureToken(): Promise<string> {
    if (
      this.cached &&
      (this.cached.expiresAt === undefined ||
        Date.now() < this.cached.expiresAt - TOKEN_REFRESH_WINDOW_MS)
    ) {
      return this.cached.accessToken;
    }
    this.cached = await this.acquireToken();
    return this.cached.accessToken;
  }

  private async acquireToken(): Promise<CachedToken> {
    const tokenUrl = `${this.webBaseUrl}/auth/oauth/token`;
    const basicAuth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

    let response: Response;
    try {
      response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${basicAuth}`,
        },
        body: new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
      });
    } catch (cause) {
      throw new ErliNetworkException(
        `Allegro category-catalog token network failure: ${(cause as Error).message}`,
        cause
      );
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new ErliAuthenticationException(
        `Allegro category-catalog token request rejected (${response.status}): ${errorText}`,
        response.status,
        tokenUrl
      );
    }

    const tokenData = (await response.json()) as AllegroTokenResponse;
    return {
      accessToken: tokenData.access_token,
      expiresAt: tokenData.expires_in ? Date.now() + tokenData.expires_in * 1000 : undefined,
    };
  }

  private async requestJson<T>(url: string): Promise<T> {
    const accessToken = await this.ensureToken();

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: ALLEGRO_ACCEPT_HEADER,
        },
      });
    } catch (cause) {
      throw new ErliNetworkException(
        `Allegro category-catalog network failure: ${(cause as Error).message}`,
        cause
      );
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      if (response.status === 401 || response.status === 403) {
        throw new ErliAuthenticationException(
          `Allegro category-catalog request rejected (${response.status}): ${errorText}`,
          response.status,
          url
        );
      }
      throw new ErliNetworkException(
        `Allegro category-catalog request failed (${response.status}): ${errorText}`
      );
    }

    return (await response.json()) as T;
  }
}

/**
 * Maps Allegro's raw category-parameter shape to the neutral `CategoryParameter`
 * contract — field-for-field copy of
 * `libs/integrations/allegro/src/infrastructure/mappers/allegro-category-parameter.mapper.ts`
 * (kept in sync manually per ADR-030's no-cross-plugin-dependency decision).
 */
function toNeutralCategoryParameter(raw: AllegroCategoryParameter): CategoryParameter {
  const dependsOnParameterId = raw.options?.dependsOnParameterId;
  const visibilityValueIds = dependsOnParameterId
    ? unionEntryParentValues(raw.dictionary ?? [])
    : [];

  return {
    id: raw.id,
    name: raw.name,
    type: raw.type,
    required: raw.required,
    multiValue:
      raw.restrictions?.multipleChoices === true ||
      (raw.restrictions?.allowedNumberOfValues ?? 1) > 1,
    unit: raw.unit,
    dictionary: raw.dictionary?.map(toNeutralEntry),
    restrictions: {
      multipleChoices: raw.restrictions?.multipleChoices,
      range: raw.restrictions?.range,
      min: raw.restrictions?.min,
      max: raw.restrictions?.max,
      minLength: raw.restrictions?.minLength,
      maxLength: raw.restrictions?.maxLength,
      precision: raw.restrictions?.precision,
      allowedNumberOfValues: raw.restrictions?.allowedNumberOfValues,
      customValuesEnabled: raw.options?.customValuesEnabled,
    },
    dependsOn:
      dependsOnParameterId && visibilityValueIds.length > 0
        ? { parameterId: dependsOnParameterId, valueIds: visibilityValueIds }
        : undefined,
    section: raw.options?.describesProduct === true ? 'product' : 'offer',
  };
}

function toNeutralEntry(
  raw: NonNullable<AllegroCategoryParameter['dictionary']>[number]
): CategoryParameterDictionaryEntry {
  return {
    id: raw.id,
    value: raw.value,
    dependsOnValueIds:
      raw.dependsOnValueIds && raw.dependsOnValueIds.length > 0 ? raw.dependsOnValueIds : undefined,
  };
}

function unionEntryParentValues(dict: ReadonlyArray<{ dependsOnValueIds?: string[] }>): string[] {
  const set = new Set<string>();
  for (const entry of dict) {
    for (const id of entry.dependsOnValueIds ?? []) set.add(id);
  }
  return [...set];
}
