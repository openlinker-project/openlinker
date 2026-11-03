/**
 * Shoper Product Images
 *
 * Reads the `product-images` gallery rows of one product, or of a chunk of
 * products for a bulk prefetch. A product payload carries only its
 * `main_image`, so the rest of the gallery - and the picture a variant stock
 * points at through `gfx_id` - is only reachable here.
 *
 * Both reads use the JSON filter form (`filters={"product_id":161}` and
 * `{"product_id":{"in":[161,163]}}`, both verified live on this resource) and
 * order by `gfx_id ASC`, so offset paging over a product's rows is stable. The
 * gallery ORDER a buyer sees is decided by the mapper, not by this sort.
 *
 * Same guard as `shoper-stocks.ts`: Shoper silently rewrites parameters it does
 * not accept, so a dropped filter would answer with every image of the shop.
 * The single-product read drops a foreign row and reports it; the bulk read
 * throws, because every requested product would otherwise be handed a wrong
 * gallery.
 *
 * @module libs/integrations/shoper/src/infrastructure/http
 */
import type { ShoperProductImage } from '../../domain/types/shoper-api.types';
import type { ShoperHttpClient } from './shoper-http-client';
import { SHOPER_MAX_PAGE_SIZE, fetchShoperPage } from './shoper-pagination';

const IMAGES_PATH = '/product-images';
const IMAGES_ORDER = 'gfx_id ASC';

export async function fetchShoperProductImages(
  client: ShoperHttpClient,
  externalProductId: string,
  onForeignRows: (count: number) => void,
): Promise<ShoperProductImage[]> {
  const filters = JSON.stringify({ product_id: Number(externalProductId) });
  const images: ShoperProductImage[] = [];
  for (let page = 1; ; page += 1) {
    const result = await fetchShoperPage<ShoperProductImage>(client, IMAGES_PATH, {
      page,
      limit: SHOPER_MAX_PAGE_SIZE,
      query: { filters, order: IMAGES_ORDER },
    });
    const own = result.items.filter((image) => String(image.product_id) === externalProductId);
    if (own.length < result.items.length) {
      onForeignRows(result.items.length - own.length);
    }
    images.push(...own);
    if (result.items.length === 0 || page >= result.pages) {
      return images;
    }
  }
}

/**
 * The gallery rows of MANY products in one filtered read, paged to the end. The
 * caller chunks the ids (at most {@link SHOPER_MAX_PAGE_SIZE} per call keeps the
 * filter short). Every requested id gets a bucket, empty when the shop listed no
 * image for it.
 *
 * THROWS on a row of an id nobody asked for: that is the shape of a dropped
 * filter, and the caller falls back to per-product reads.
 */
export async function fetchShoperProductImagesForProducts(
  client: ShoperHttpClient,
  externalProductIds: readonly string[],
): Promise<Map<string, ShoperProductImage[]>> {
  const buckets = new Map<string, ShoperProductImage[]>(
    externalProductIds.map((id) => [id, []]),
  );
  const filters = JSON.stringify({ product_id: { in: externalProductIds.map(Number) } });
  for (let page = 1; ; page += 1) {
    const result = await fetchShoperPage<ShoperProductImage>(client, IMAGES_PATH, {
      page,
      limit: SHOPER_MAX_PAGE_SIZE,
      query: { filters, order: IMAGES_ORDER },
    });
    for (const image of result.items) {
      const bucket = buckets.get(String(image.product_id));
      if (bucket === undefined) {
        throw new Error(
          `Shoper answered a product-images read for ${externalProductIds.length} ` +
            `product(s) with an image of product ${String(image.product_id)}, which was not ` +
            'asked for - the filter was not applied',
        );
      }
      bucket.push(image);
    }
    if (result.items.length === 0 || page >= result.pages) {
      return buckets;
    }
  }
}
