/**
 * Which pictures a variant is shown with
 *
 * Pure rule shared by the DTO mapping (interface layer) and the variant proxy
 * route's service (application layer). It lives here, not under `http/`, so the
 * application layer does not depend on the interface layer.
 *
 * @module apps/api/src/products/application/services
 */

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
