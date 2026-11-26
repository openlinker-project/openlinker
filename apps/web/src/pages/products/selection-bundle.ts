/**
 * Selection-bar bundle action (products list)
 *
 * Decides whether the selection can seed the set wizard, and when it cannot,
 * why - so the bar shows a disabled button with a reason instead of hiding it.
 * Product ids, not variant ids: the list selects products and the wizard
 * resolves a single-variant product to its variant itself.
 */
import type { Product } from '../../features/products';

export type SelectionBundleReason = 'mixed' | 'tooMany';

export interface SelectionBundle {
  link: string | null;
  disabledReason: SelectionBundleReason | null;
}

export function resolveSelectionBundle(
  items: readonly Product[],
  selectedIds: ReadonlySet<string>,
  limit: number
): SelectionBundle {
  // Counted on the whole selection, not the loaded page: the list shows one page
  // of rows, so a selection past the limit can only have been built across pages.
  if (selectedIds.size > limit) return { link: null, disabledReason: 'tooMany' };
  const picked = items.filter((p) => selectedIds.has(p.id));
  // Selection carries ids this page does not show: nothing to seed from.
  if (picked.length !== selectedIds.size) return { link: null, disabledReason: null };
  // Bundles cannot be components, and a multi-variant product has no single
  // component to seed, so both are refused rather than silently dropped.
  if (picked.some((p) => p.bundle || (p.variantCount ?? 1) !== 1)) {
    return { link: null, disabledReason: 'mixed' };
  }
  if (picked.length === 1) {
    return {
      link: `/products/bundles/new?componentProduct=${encodeURIComponent(picked[0]!.id)}&quantity=1`,
      disabledReason: null,
    };
  }
  if (picked.length < 2) return { link: null, disabledReason: null };
  return {
    link: `/products/bundles/new?components=${picked.map((p) => `${encodeURIComponent(p.id)}:1`).join(',')}`,
    disabledReason: null,
  };
}
