/**
 * OfferProductPickerModal selectors
 *
 * Pure, side-effect-free derivation helpers extracted out of
 * `OfferProductPickerModal` (#1819) so the component body only wires state to
 * these functions instead of computing them inline. No React import - safe
 * to unit-test in isolation.
 *
 * @module apps/web/src/features/listings/lib
 */
import type { Product, ProductVariant } from '../../products';
import type { RailGroup, SelectionEntry } from '../components/offer-product-picker.types';

/** Long label for a variant row: product name + attrs / SKU. */
export function variantLabel(product: Product, variant: ProductVariant): string {
  const attrs = variant.attributes ? Object.values(variant.attributes).join(' · ') : '';
  if (attrs) return `${product.name} - ${attrs}`;
  if (variant.sku) return `${product.name} - ${variant.sku}`;
  return product.name;
}

/** Short, product-name-free label for the rail review (attrs, else SKU, else id). */
export function variantShortLabel(variant: ProductVariant): string {
  const attrs = variant.attributes ? Object.values(variant.attributes).join(' · ') : '';
  return attrs || variant.sku || variant.id;
}

/** Whether a variant carries a barcode (EAN or GTIN). */
export function variantHasBarcode(variant: ProductVariant): boolean {
  return (variant.ean ?? variant.gtin ?? '').trim() !== '';
}

export function firstImage(images: string[] | null | undefined): string | null {
  return images && images.length > 0 ? images[0] : null;
}

/**
 * Item total across products: an explicit set counts its size; a whole
 * product counts its known variant count (loaded count, else the list
 * query's own variantCount, else 1 for a genuinely-unknown product).
 */
export function computeItemCount(
  selection: Map<string, SelectionEntry>,
  variantCounts: Map<string, number>,
  productMeta: Map<string, Product>,
): number {
  let sum = 0;
  for (const [productId, entry] of selection) {
    if (entry instanceof Set) sum += entry.size;
    else sum += variantCounts.get(productId) ?? productMeta.get(productId)?.variantCount ?? 1;
  }
  return sum;
}

/** Per-product rail rows, derived from the selection + accumulated metadata. */
export function computeRailGroups(
  selection: Map<string, SelectionEntry>,
  productMeta: Map<string, Product>,
  variantMeta: Map<string, ProductVariant[]>,
  variantCounts: Map<string, number>,
): RailGroup[] {
  const groups: RailGroup[] = [];
  for (const [productId, entry] of selection) {
    const meta = productMeta.get(productId);
    const variants = variantMeta.get(productId) ?? meta?.variants ?? [];
    const totalVariants =
      variantCounts.get(productId) ?? meta?.variantCount ?? (variants.length || 1);
    if (entry === 'ALL') {
      const loadedVariants = variantMeta.get(productId);
      const wholeEan = loadedVariants
        ? {
            loaded: true,
            needCount: loadedVariants.filter((v) => !variantHasBarcode(v)).length,
          }
        : { loaded: false, needCount: 0 };
      groups.push({
        productId,
        name: meta?.name ?? productId,
        imageSrc: firstImage(meta?.images),
        whole: true,
        totalVariants,
        wholeEan,
        selected: null,
      });
      continue;
    }
    const selected = [...entry].map((variantId) => {
      const variant = variants.find((v) => v.id === variantId);
      return {
        id: variantId,
        label: variant ? variantShortLabel(variant) : variantId,
        hasBarcode: variant ? variantHasBarcode(variant) : true,
      };
    });
    groups.push({
      productId,
      name: meta?.name ?? productId,
      imageSrc: firstImage(meta?.images),
      whole: false,
      totalVariants,
      wholeEan: null,
      selected,
    });
  }
  return groups;
}

/**
 * Selected variants (across groups) whose barcode is missing, best-effort
 * from loaded metadata. Whole-product picks contribute their known variants.
 */
export function computeNeedEanCount(
  railGroups: RailGroup[],
  variantMeta: Map<string, ProductVariant[]>,
): number {
  let sum = 0;
  for (const group of railGroups) {
    if (group.selected === null) {
      const variants = variantMeta.get(group.productId) ?? [];
      sum += variants.filter((v) => !variantHasBarcode(v)).length;
    } else {
      sum += group.selected.filter((s) => !s.hasBarcode).length;
    }
  }
  return sum;
}
