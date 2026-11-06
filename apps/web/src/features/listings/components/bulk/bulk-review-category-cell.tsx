/**
 * Bulk wizard Review - Category cell (#3994)
 *
 * Shows the category a row will actually submit under and WHERE that answer
 * came from: the operator's pick in this wizard, their category mapping, or a
 * catalogue product matched by barcode. Before #3994 the Review row showed no
 * category at all, so a barcode that matched a catalogue product in an
 * unrelated category listed the product there with no trace.
 *
 * When the barcode pointed somewhere else than the mapping, the disagreement is
 * shown ON the category it disagrees with - not as one more status chip in
 * another column - as a single line that opens the comparison.
 *
 * Breadcrumbs come from the destination taxonomy read model (no live
 * marketplace call) and are cached per category id, so rows sharing a category
 * share one fetch.
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import type { ReactElement } from 'react';
import { useCategoryPathQuery } from '../../../mappings';
import type { EanMatchCardRef } from '../../api/listings.types';
import type { BulkVariantRow, BulkWizardRow } from './bulk-wizard.types';
import { operatorPickedCategory, productCategoryIdOf, submitCategoryIdOf } from './bulk-policy';

/** Where the submitted category came from. */
export type CategorySource = 'picked' | 'shared' | 'mapping' | 'card' | 'card-agrees';

const SOURCE_LABEL: Record<CategorySource, string> = {
  picked: 'Set here',
  shared: 'Shared',
  mapping: 'Mapping',
  card: 'Catalog',
  'card-agrees': 'Catalog + mapping',
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
  /**
   * A catalogue product the barcode matched in a different category, set aside
   * for the mapping (#3994). Shown only while the operator has not picked a
   * category themselves.
   */
  conflict?: { card: EanMatchCardRef; onCompare: () => void } | null;
  /**
   * On a collapsed multi-variant product: how many variants carry a conflict,
   * and how to reveal them. A disagreement must not hide behind the caret.
   */
  siblingConflicts?: { count: number; onReveal: () => void } | null;
}

export function ReviewCategoryCell({
  connectionId,
  categoryId,
  source,
  resolvesAtSubmit,
  conflict,
  siblingConflicts,
}: ReviewCategoryCellProps): ReactElement {
  if (categoryId === null) {
    return (
      <div className="bulk-review__c-cat review-cat">
        <span className="review-cat__none">{resolvesAtSubmit ? 'Resolved at submit' : 'Not set'}</span>
      </div>
    );
  }
  return (
    <ResolvedCategory
      connectionId={connectionId}
      categoryId={categoryId}
      source={source}
      conflict={conflict ?? null}
      siblingConflicts={siblingConflicts ?? null}
    />
  );
}

function ResolvedCategory({
  connectionId,
  categoryId,
  source,
  conflict,
  siblingConflicts,
}: {
  connectionId: string;
  categoryId: string;
  source: CategorySource | null;
  conflict: { card: EanMatchCardRef; onCompare: () => void } | null;
  siblingConflicts: { count: number; onReveal: () => void } | null;
}): ReactElement {
  const pathQuery = useCategoryPathQuery(connectionId, categoryId);
  const path = pathQuery.data ?? [];
  const leaf = path.length > 0 ? path[path.length - 1].name : null;
  const trail = compactTrail(path.slice(0, -1).map((n) => n.name));
  const full = path.map((n) => n.name).join(' › ');

  return (
    <div className="bulk-review__c-cat review-cat">
      <div className="review-cat__head" title={full || `Category ${categoryId}`}>
        {pathQuery.isPending ? (
          <span className="review-cat__leaf review-cat__leaf--pending" aria-busy="true">
            Loading…
          </span>
        ) : (
          <span className="review-cat__leaf">{leaf ?? `Category ${categoryId}`}</span>
        )}
        {source ? (
          <span className={`review-cat__source review-cat__source--${source}`} title={SOURCE_HINT[source]}>
            {SOURCE_LABEL[source]}
          </span>
        ) : null}
      </div>
      {trail ? (
        <span className="review-cat__trail">{trail}</span>
      ) : !pathQuery.isPending && leaf === null ? (
        <span className="review-cat__trail">Path not synced yet</span>
      ) : null}
      {conflict ? (
        <ConflictLink connectionId={connectionId} card={conflict.card} onCompare={conflict.onCompare} />
      ) : siblingConflicts && siblingConflicts.count > 0 ? (
        <button type="button" className="review-cat__conflict" onClick={siblingConflicts.onReveal}>
          <ForkIcon />
          <span className="review-cat__conflict-text">
            {siblingConflicts.count === 1
              ? 'Barcode disagrees on 1 variant'
              : `Barcode disagrees on ${siblingConflicts.count} variants`}
          </span>
        </button>
      ) : null}
    </div>
  );
}

function ConflictLink({
  connectionId,
  card,
  onCompare,
}: {
  connectionId: string;
  card: EanMatchCardRef;
  onCompare: () => void;
}): ReactElement {
  const cardPath = useCategoryPathQuery(connectionId, card.allegroCategoryId);
  const cardLeaf = cardPath.data?.[cardPath.data.length - 1]?.name;
  const label = `Barcode matched ${cardLeaf ?? 'another category'}`;
  return (
    <button
      type="button"
      className="review-cat__conflict"
      onClick={onCompare}
      aria-label={`${label}. Compare with your mapping`}
    >
      <ForkIcon />
      <span className="review-cat__conflict-text">{label}</span>
    </button>
  );
}

/** A branch leaving the trunk - the two categories split apart. */
function ForkIcon(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" className="review-cat__conflict-icon">
      <path
        d="M5 2.5v11M5 5.5c0 3.5 6 2.5 6 6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
