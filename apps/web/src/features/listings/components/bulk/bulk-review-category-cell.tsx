/**
 * Bulk wizard Review - Category cell (#3994)
 *
 * Shows the category a row will actually submit under and WHERE that answer
 * came from: the operator's pick in this wizard, their category mapping, or a
 * catalogue card matched by barcode. Before #3994 the Review row showed no
 * category at all, so a barcode that matched a card in an unrelated category
 * listed the product there with no trace.
 *
 * The breadcrumb is read from the destination taxonomy read model (no live
 * marketplace call) and cached per category id, so rows sharing a category share
 * one fetch.
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import type { ReactElement } from 'react';
import { useCategoryPathQuery } from '../../../mappings';
import type { BulkVariantRow, BulkWizardRow } from './bulk-wizard.types';
import { operatorPickedCategory, productCategoryIdOf, submitCategoryIdOf } from './bulk-policy';

/** Where the submitted category came from. */
export type CategorySource = 'picked' | 'shared' | 'mapping' | 'card' | 'card-agrees';

const SOURCE_LABEL: Record<CategorySource, string> = {
  picked: 'Chosen here',
  shared: 'Product category',
  mapping: 'Your mapping',
  card: 'Catalog card',
  'card-agrees': 'Card + mapping',
};

const SOURCE_HINT: Record<CategorySource, string> = {
  picked: 'You picked this category in this wizard.',
  shared: 'All variants of a product list under one category, so this variant uses the product category.',
  mapping: 'Resolved from your category mapping.',
  card: 'Matched by barcode to a catalog product. No category mapping covers this product.',
  'card-agrees': 'Matched by barcode to a catalog product that sits in the category your mapping names.',
};

/**
 * The submitted category for one variant, and its source. Exported for tests:
 * the source decision is the part a regression would get wrong silently.
 */
export function describeVariantCategory(
  row: BulkWizardRow,
  variant: BulkVariantRow,
): { categoryId: string | null; source: CategorySource | null } {
  const categoryId = submitCategoryIdOf(row, variant);
  if (categoryId === null) return { categoryId: null, source: null };
  if (operatorPickedCategory(row, variant)) return { categoryId, source: 'picked' };
  if (row.variants.length > 1 && categoryId !== variant.resolvedCategoryId) {
    return { categoryId, source: 'shared' };
  }
  return { categoryId, source: sourceOfResolution(variant) };
}

/** The product-tier category a multi-variant row submits under, and its source. */
export function describeProductCategory(
  row: BulkWizardRow,
): { categoryId: string | null; source: CategorySource | null } {
  const categoryId = productCategoryIdOf(row);
  if (categoryId === null) return { categoryId: null, source: null };
  if (row.override.overrides?.categoryId) return { categoryId, source: 'picked' };
  const primary = row.variants.find((v) => v.variantId === row.primaryVariant?.id) ?? row.variants[0];
  return { categoryId, source: primary ? sourceOfResolution(primary) : null };
}

function sourceOfResolution(variant: BulkVariantRow): CategorySource | null {
  if (variant.resolutionMethod === 'category_mapping') return 'mapping';
  if (variant.resolutionMethod === 'auto_detect') return variant.mappingAgrees ? 'card-agrees' : 'card';
  if (variant.resolutionMethod === 'manual') return 'picked';
  return null;
}

/**
 * The ancestors of the leaf, shortened for a table cell: the ROOT (which branch
 * of the catalog - the fact that tells a T-shirt from a power bank) and the
 * immediate PARENT survive, the middle collapses. The full path stays in the
 * cell's tooltip. An ellipsis at the end would cut exactly those two away.
 */
export function compactTrail(ancestors: readonly string[]): string {
  if (ancestors.length <= 2) return ancestors.join(' › ');
  return `${ancestors[0]} › … › ${ancestors[ancestors.length - 1]}`;
}

interface ReviewCategoryCellProps {
  connectionId: string;
  categoryId: string | null;
  source: CategorySource | null;
  /** The destination resolves the category itself at submit (borrowed taxonomy). */
  resolvesAtSubmit: boolean;
}

export function ReviewCategoryCell({
  connectionId,
  categoryId,
  source,
  resolvesAtSubmit,
}: ReviewCategoryCellProps): ReactElement {
  if (categoryId === null) {
    return (
      <div className="bulk-review__c-cat review-cat review-cat--empty">
        <span className="review-cat__none">{resolvesAtSubmit ? 'Resolved at submit' : 'Not set'}</span>
      </div>
    );
  }
  return <ResolvedCategory connectionId={connectionId} categoryId={categoryId} source={source} />;
}

function ResolvedCategory({
  connectionId,
  categoryId,
  source,
}: {
  connectionId: string;
  categoryId: string;
  source: CategorySource | null;
}): ReactElement {
  const pathQuery = useCategoryPathQuery(connectionId, categoryId);
  const path = pathQuery.data ?? [];
  const leaf = path.length > 0 ? path[path.length - 1].name : null;
  const trail = compactTrail(path.slice(0, -1).map((n) => n.name));
  const full = path.map((n) => n.name).join(' › ');

  return (
    <div className="bulk-review__c-cat review-cat" title={full || `Category ${categoryId}`}>
      {pathQuery.isPending ? (
        <span className="review-cat__leaf review-cat__leaf--loading" aria-busy="true">
          Loading category…
        </span>
      ) : (
        <span className="review-cat__leaf">{leaf ?? `Category ${categoryId}`}</span>
      )}
      {trail ? (
        <span className="review-cat__trail">{trail}</span>
      ) : !pathQuery.isPending && leaf === null ? (
        <span className="review-cat__trail">Path not synced yet</span>
      ) : null}
      {source ? (
        <span className={`review-cat__source review-cat__source--${source}`} title={SOURCE_HINT[source]}>
          {SOURCE_LABEL[source]}
        </span>
      ) : null}
    </div>
  );
}
