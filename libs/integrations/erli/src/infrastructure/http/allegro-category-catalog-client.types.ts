/**
 * Allegro Category Catalog Client Types
 *
 * Wire-shape types for `AllegroCategoryCatalogClient` — the
 * `grant_type=client_credentials` token response and the raw
 * `/sale/categories` / `/sale/categories/{id}/parameters` response shapes.
 * Extracted to a separate file per engineering-standards.md § "Type
 * Definitions in Separate Files" — mirrors the sibling `erli-http-client.ts`
 * → `erli-http-client.types.ts` split, and Allegro's own equivalent types at
 * `domain/types/allegro-api.types.ts`.
 *
 * @module libs/integrations/erli/src/infrastructure/http
 */

export interface AllegroTokenResponse {
  access_token: string;
  expires_in?: number;
  token_type: string;
}

/** Raw Allegro category item — `GET /sale/categories`. */
export interface AllegroCategoryItem {
  id: string;
  name: string;
  parent?: { id: string } | null;
  leaf: boolean;
}

export interface AllegroCategoriesResponse {
  categories: AllegroCategoryItem[];
}

/** Raw Allegro category parameter — `GET /sale/categories/{id}/parameters`. */
export interface AllegroCategoryParameter {
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

export interface AllegroCategoryParametersResponse {
  parameters: AllegroCategoryParameter[];
}

/** Cached client-credentials token state for one client instance. */
export interface CachedToken {
  accessToken: string;
  expiresAt: number | undefined;
}
