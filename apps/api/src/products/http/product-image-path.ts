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

/** What a variant read has to hand: its id and the pictures it dedicates to itself. */
export interface VariantImageSource {
  readonly id: string;
  readonly images?: readonly string[] | null;
}

/**
 * The pictures a variant is shown with: its own, else its product's.
 *
 * Simple precedence, deliberately NOT `resolveVariantDefaultImages`: that rule
 * is the listing builder's (own first, then the gallery minus the siblings'
 * pictures) and means something different. A screen showing "the picture of
 * this variant" wants the variant's own, or the product's when it has none.
 *
 * ONE function, shared by the DTO mapping and the variant proxy route, so the
 * index a client was handed is the index the route resolves.
 */
export function resolveVariantImageList(
  variant: VariantImageSource,
  productImages: readonly string[] | null | undefined
): { readonly urls: readonly string[]; readonly fromProduct: boolean } {
  const own = variant.images ?? [];
  if (own.length > 0) return { urls: own, fromProduct: false };
  return { urls: productImages ?? [], fromProduct: (productImages ?? []).length > 0 };
}

/** The path of one picture in a variant's RESOLVED list (see `resolveVariantImageList`). */
export function variantImageProxyPath(variant: { readonly id: string }, index: number): string {
  return `/products/variants/${encodeURIComponent(variant.id)}/images/${String(index)}`;
}

/** Proxy paths for every picture in the variant's resolved list. */
export function variantImageProxyPaths(
  variant: VariantImageSource,
  productImages: readonly string[] | null | undefined
): { readonly imageUrls: string[]; readonly imagesFromProduct: boolean } {
  const { urls, fromProduct } = resolveVariantImageList(variant, productImages);
  return {
    imageUrls: urls.map((_, i) => variantImageProxyPath(variant, i)),
    imagesFromProduct: fromProduct,
  };
}
