/**
 * Where a product's picture is read from (#3915)
 *
 * A product's stored picture url is the one the catalogue sync used, which on
 * a Docker install names a container host the browser cannot resolve, so it is
 * never put in an `<img src>`. Pictures are read through the API image proxy
 * (`GET /products/:productId/images/:index`), the route the gallery, the order
 * peek and the pack bench already use.
 *
 * @module apps/web/src/features/products/lib
 */

/** The proxy path for one of a product's pictures. */
export function productImageProxyPath(productId: string, index = 0): string {
  return `/products/${encodeURIComponent(productId)}/images/${String(index)}`;
}

/**
 * The proxy path for a product's first picture, or `null` when it has none -
 * so a thumbnail shows its placeholder without asking the API for anything.
 */
export function productImagePath(product: {
  readonly id: string;
  readonly images?: readonly string[] | null;
}): string | null {
  return product.images?.[0] ? productImageProxyPath(product.id) : null;
}
