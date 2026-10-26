/**
 * Variant Images
 *
 * Rules for the pictures a master dedicates to one variant
 * (`ProductVariant.images`) and for the image list a variant is LISTED with by
 * default. Pure: no I/O, no framework - the offer builder, the shop publish
 * builder and the products read API all call `resolveVariantDefaultImages`, so
 * what an operator is shown as a variant's default is what is published.
 *
 * @module libs/core/src/products/domain/utils
 */
import type { ProductVariant } from '../entities/product-variant.entity';

/**
 * The stored form of a variant's own images: trimmed, non-empty, first
 * occurrence kept, the master's order preserved - or `null` when nothing is
 * left, so "no picture of its own" has exactly one spelling in storage.
 */
export function normalizeVariantImages(
  images: ProductVariant['images'] | undefined,
): string[] | null {
  const cleaned = dedupeImageUrls(images ?? []);
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * The images a variant is listed with when nobody overrode them:
 *
 *   1. the variant's own images, in the master's order; then
 *   2. the product gallery WITHOUT the images dedicated to another live
 *      sibling - an image is dedicated to another variant when it appears in a
 *      sibling's own images and not in this variant's (so red, sharing its
 *      picture with yellow, still gets it);
 *   de-duplicated, first occurrence kept.
 *
 * When that leaves nothing (no own images, and every gallery image belongs to
 * a sibling), the whole product gallery is returned, so a variant is never
 * listed with fewer images than the product had before this rule existed.
 * A stale sibling (deleted at the master) dedicates nothing: its picture, if
 * still in the gallery, is just a gallery image now.
 *
 * Product 161 (gallery 312 main, 313, 314 red+yellow, 315 green):
 * red -> [314, 312, 313], yellow -> [314, 312, 313], green -> [315, 312, 313],
 * navy (no own picture) -> [312, 313].
 */
export function resolveVariantDefaultImages(
  variant: Pick<ProductVariant, 'id' | 'images'>,
  siblings: readonly Pick<ProductVariant, 'id' | 'images' | 'isStale'>[],
  productImages: readonly string[] | null,
): string[] | null {
  const own = dedupeImageUrls(variant.images ?? []);
  const ownSet = new Set(own);
  const dedicatedToOthers = new Set<string>();
  for (const sibling of siblings) {
    if (sibling.id === variant.id || sibling.isStale === true) continue;
    for (const url of dedupeImageUrls(sibling.images ?? [])) {
      if (!ownSet.has(url)) dedicatedToOthers.add(url);
    }
  }
  const gallery = dedupeImageUrls(productImages ?? []);
  const resolved = dedupeImageUrls([
    ...own,
    ...gallery.filter((url) => !dedicatedToOthers.has(url)),
  ]);
  if (resolved.length > 0) {
    return resolved;
  }
  return productImages === null ? null : [...productImages];
}

function dedupeImageUrls(urls: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of urls) {
    if (typeof raw !== 'string') continue;
    const url = raw.trim();
    if (url.length === 0 || seen.has(url)) continue;
    seen.add(url);
    result.push(url);
  }
  return result;
}
