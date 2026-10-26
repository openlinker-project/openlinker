/**
 * Shoper Product Images
 *
 * Reads the image rows of one product from `/product-images`. ONE page of 50 is
 * read, which bounds the cost to one request per product read; a gallery longer
 * than that is cut at 50, which no destination accepts anyway.
 *
 * The filter takes the JSON form: the bracket form answers 500 on this resource
 * (verified live). As with stocks, a row that is not this product's is dropped
 * and reported through `onForeignRows`, never returned - if the filter were ever
 * ignored, the shop's whole image table would otherwise be attributed to one
 * product.
 *
 * @module libs/integrations/shoper/src/infrastructure/http
 */
import type { ShoperProductImage } from '../../domain/types/shoper-api.types';
import type { ShoperHttpClient } from './shoper-http-client';
import { SHOPER_MAX_PAGE_SIZE, fetchShoperPage } from './shoper-pagination';

export async function fetchShoperProductImages(
  client: ShoperHttpClient,
  externalProductId: string,
  onForeignRows: (count: number) => void,
): Promise<ShoperProductImage[]> {
  const result = await fetchShoperPage<ShoperProductImage>(client, '/product-images', {
    page: 1,
    limit: SHOPER_MAX_PAGE_SIZE,
    query: { filters: JSON.stringify({ product_id: Number(externalProductId) }) },
  });
  const own = result.items.filter((image) => String(image.product_id) === externalProductId);
  if (own.length < result.items.length) {
    onForeignRows(result.items.length - own.length);
  }
  return own;
}
