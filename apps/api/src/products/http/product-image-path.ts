/**
 * Where a browser asks for a product's picture (#3340 follow-up)
 *
 * Every read that hands a product image to the frontend routes it through
 * here rather than passing `product.images[0]` along. What the catalogue sync
 * stored is the address the BACKEND used to reach the shop; on any deployment
 * where the shop sits on the backend's own network it is not resolvable from
 * a browser at all, and even where it is, it may be http against an https app
 * (blocked as mixed content) or an internal host the operator would rather
 * not publish.
 *
 * ONE function, so a second read cannot start emitting raw urls again by
 * accident — `ProductImageProxyService` explains the rest.
 *
 * Relative on purpose: the API is mounted under a version prefix and served
 * from whatever origin the deployment chose, and a relative path is correct
 * under all of them without this module having to know which.
 *
 * @module apps/api/src/products/http
 */

/** The shape every caller has to hand: whatever it read for the product. */
export interface ProductImageSource {
  readonly id: string;
  readonly images: readonly string[] | null;
}

/**
 * The path for a product's first image, or `null` when it has none.
 *
 * `null` means "this product has no picture" and must be passed on as `null`
 * rather than as a path that would 404 — a surface distinguishes the two, and
 * a 404 per row is a request the shop should never be asked for.
 */
export function productImageProxyPath(
  product: ProductImageSource | null | undefined,
  index = 0
): string | null {
  if (product === null || product === undefined) return null;
  const url = product.images?.[index];
  if (url === undefined || url === null || url === '') return null;
  return `/products/${encodeURIComponent(product.id)}/images/${String(index)}`;
}
