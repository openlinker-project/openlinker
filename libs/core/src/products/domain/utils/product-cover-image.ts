/**
 * Product Cover Image Helper
 *
 * The cover-image rule for the Products bounded context: "the first element
 * of `images`, or null if empty/absent." Extracted as a standalone helper
 * because `Product` is an interface and interfaces cannot carry methods.
 * Consumers (inventory read endpoints, UI thumbnails) should call this rather
 * than replicating `images?.[0] ?? null` themselves.
 *
 * @module libs/core/src/products/domain/utils
 */
import type { Product } from '../entities/product.entity';

export const coverImageUrl = (product: Pick<Product, 'images'>): string | null => {
  return product.images?.[0] ?? null;
};
