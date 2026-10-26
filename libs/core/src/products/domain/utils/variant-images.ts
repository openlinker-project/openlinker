/**
 * Variant Images
 *
 * Rules for the pictures a master dedicates to one variant
 * (`ProductVariant.images`). Pure: no I/O, no framework.
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
