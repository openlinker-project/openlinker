/**
 * Fetch Allegro Product
 *
 * Catalog product-detail fetcher (#633). Calls
 * `GET /sale/products/{productId}` and maps Allegro's `SaleProductDto` onto
 * the neutral `CatalogProduct` defined in
 * `@openlinker/core/listings`. The detail is then surfaced through the
 * `CatalogProductReader.getProduct` capability and via the eager `unique`
 * branch of `findProductsByBarcode`.
 *
 * Cache shape (`productId -> CatalogProduct`):
 * - 24 h TTL, in-memory or Redis via `CachePort`.
 * - **Cache key intentionally omits `connectionId`** — Allegro's product
 *   catalog is global per region (Allegro PL today), not seller-scoped, so
 *   keying by `productId` is sufficient and avoids per-seller fan-out.
 *   Mirrors the existing `resolve-allegro-product-card-by-ean` precedent.
 *   If Allegro ever ships seller-scoped catalogs (e.g. private listings,
 *   regional divergence beyond PL), bump this key to include `connectionId`.
 *
 * Error semantics:
 * - HTTP 404 → throws `CatalogProductNotFoundException` (domain exception).
 *   The controller maps this to a 404 response.
 * - Other HTTP failures → re-thrown as `AllegroApiException` (existing
 *   http-client behaviour); the controller surfaces these as 502/500.
 *
 * @module libs/integrations/allegro/src/infrastructure/util
 */
import type { CachePort } from '@openlinker/shared';
import type { CatalogProduct, CatalogProductParameter } from '@openlinker/core/listings';
import { CatalogProductNotFoundException } from '@openlinker/core/listings';
import type {
  AllegroProductDto,
  AllegroProductDtoParameter,
} from '../../domain/types/allegro-api.types';
import { AllegroApiException } from '../../domain/exceptions/allegro-api.exception';
import type { IAllegroHttpClient } from '../http/allegro-http-client.interface';
import type { FetchAllegroProductOptions } from './fetch-allegro-product.types';

export type { FetchAllegroProductOptions } from './fetch-allegro-product.types';

const DEFAULT_CACHE_TTL_SEC = 24 * 60 * 60;
// Connection-agnostic — Allegro's catalog is global per region and today every
// OpenLinker Allegro connection targets allegro.pl. If a future connection
// pins to allegro.cz or allegro.sk via `Connection.config`, this key must be
// re-scoped to `${region}:${productId}` to avoid cross-region collisions.
const DEFAULT_CACHE_KEY_PREFIX = 'allegro:product-detail';

export async function fetchAllegroProduct(
  httpClient: IAllegroHttpClient,
  cache: CachePort | undefined,
  productId: string,
  options?: FetchAllegroProductOptions
): Promise<CatalogProduct> {
  const ttl = options?.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
  const prefix = options?.cacheKeyPrefix ?? DEFAULT_CACHE_KEY_PREFIX;
  const cacheKey = `${prefix}:${productId}`;

  if (cache) {
    const cached = await cache.get<CatalogProduct>(cacheKey);
    if (cached) return cached;
  }

  let dto: AllegroProductDto;
  try {
    const response = await httpClient.get<AllegroProductDto>(
      `/sale/products/${encodeURIComponent(productId)}`
    );
    dto = response.data;
  } catch (error) {
    if (error instanceof AllegroApiException && error.statusCode === 404) {
      throw new CatalogProductNotFoundException(productId);
    }
    throw error;
  }

  const product = mapAllegroProductDtoToNeutral(dto);

  if (cache) {
    await cache.set<CatalogProduct>(cacheKey, product, ttl);
  }

  return product;
}

/**
 * Maps Allegro's `SaleProductDto` onto the neutral `CatalogProduct`.
 *
 * - `description` (Allegro's structured `StandardizedDescription` with
 *   sections) is intentionally omitted — the issue scopes catalog prefill
 *   to parameters only (#635 non-goal: description auto-fill from catalog).
 * - `ean` is lifted from the parameter whose `options.isGTIN === true`,
 *   first value. Allegro stores EAN as a parameter, not a top-level field.
 * - `imageUrl` (summary) is the first entry of the `images` list; `images`
 *   (full list) is preserved verbatim as plain URL strings.
 */
export function mapAllegroProductDtoToNeutral(dto: AllegroProductDto): CatalogProduct {
  const images = dto.images
    ?.map((img) => img.url)
    .filter((u): u is string => typeof u === 'string');
  const imageUrl = images?.[0];
  const ean = extractEanFromParameters(dto.parameters);
  const parameters = (dto.parameters ?? []).map(mapAllegroParameterToNeutral);

  return {
    id: dto.id,
    name: dto.name,
    ean,
    imageUrl,
    images: images && images.length > 0 ? images : undefined,
    parameters,
  };
}

function mapAllegroParameterToNeutral(p: AllegroProductDtoParameter): CatalogProductParameter {
  return {
    parameterId: p.id,
    name: p.name ?? p.id,
    valueIds: p.valuesIds && p.valuesIds.length > 0 ? p.valuesIds : undefined,
    valueStrings: p.values && p.values.length > 0 ? p.values : undefined,
  };
}

function extractEanFromParameters(
  parameters: AllegroProductDtoParameter[] | undefined
): string | undefined {
  if (!parameters) return undefined;
  for (const p of parameters) {
    if (p.options?.isGTIN === true && p.values && p.values.length > 0) {
      return p.values[0];
    }
  }
  return undefined;
}
