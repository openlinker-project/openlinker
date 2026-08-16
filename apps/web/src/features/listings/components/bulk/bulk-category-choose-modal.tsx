/**
 * Bulk Choose-category modal (#1741)
 *
 * External category picker for the per-variant bulk edit modal. Replaces the
 * inline `CategoryPicker` in the base scope with a dedicated modal that matches
 * the approved mockup: a search input, a clickable breadcrumb, and a list of
 * child categories with Browse (drill-in) / Select (pick) affordances.
 *
 * The category lives in the BASE scope by default (grouping-determining,
 * shared across variants) - and, for a `'catalog-implicit'` destination
 * (Allegro), can also be given per-variant via the variant scope's 3-state
 * ladder (#1924), where picking one splits that variant out of the grouped
 * listing. Either mount fires `onSelect(categoryId, pathNames)`. `pathNames`
 * is the full breadcrumb (ancestors + leaf) captured at selection time, used
 * to render the chip breadcrumb without a second round-trip.
 *
 * Only mounted for a browsable destination (`canBrowseCategories === true` at
 * the base scope; `variantGrouping === 'catalog-implicit'` at the variant
 * scope). The borrowed-taxonomy path (Erli) keeps its inline "Allegro
 * category ID" text input in the base form instead, and has no variant-scope
 * picker yet (#1045 follow-up).
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import { useState, type ReactElement } from 'react';
import { Button, Input } from '../../../../shared/ui';
import { ErrorState, LoadingState } from '../../../../shared/ui/feedback-state';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../../../shared/ui/dialog';
import {
  CategorySearchResults,
  type CategorySearchResultHit,
} from '../../../../shared/ui/category-search-results';
import { useDebouncedValue } from '../../../../shared/hooks/use-debounced-value';
import {
  useAllegroCategoriesQuery,
  useCategorySearchQuery,
  isSearchableCategoryQuery,
  toCategorySearchResultHits,
  isTaxonomyUnsynced,
} from '../../../mappings';

interface Crumb {
  id: string;
  name: string;
}

interface BulkCategoryChooseModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string;
  productName: string;
  selectedId: string | null;
  /** Fires with the leaf id + the full breadcrumb path names (ancestors + leaf). */
  onSelect: (categoryId: string, pathNames: string[]) => void;
  /**
   * Which scope this picker is choosing a category for (#1924). `'base'`
   * (default) is the shared-base pick that seeds every variant; `'variant'`
   * is a single variant overriding its own category, which splits it out of
   * the grouped listing rather than applying to every sibling — the footer
   * copy reflects the actual consequence for each.
   */
  scope?: 'base' | 'variant';
}

export function BulkCategoryChooseModal({
  open,
  onOpenChange,
  connectionId,
  productName,
  selectedId,
  onSelect,
  scope = 'base',
}: BulkCategoryChooseModalProps): ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="bulk-editor__catpick dialog__content--elevated"
        overlayClassName="bulk-editor__catpick-overlay dialog__overlay--elevated"
      >
        {open ? (
          <BulkCategoryChooseBody
            connectionId={connectionId}
            productName={productName}
            selectedId={selectedId}
            onSelect={onSelect}
            onClose={() => onOpenChange(false)}
            scope={scope}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function BulkCategoryChooseBody({
  connectionId,
  productName,
  selectedId,
  onSelect,
  onClose,
  scope,
}: {
  connectionId: string;
  productName: string;
  selectedId: string | null;
  onSelect: (categoryId: string, pathNames: string[]) => void;
  onClose: () => void;
  scope: 'base' | 'variant';
}): ReactElement {
  const [breadcrumb, setBreadcrumb] = useState<Crumb[]>([]);
  const [search, setSearch] = useState('');

  const parentId = breadcrumb.length > 0 ? breadcrumb[breadcrumb.length - 1].id : undefined;
  const categoriesQuery = useAllegroCategoriesQuery(connectionId, parentId, true);
  const nodes = categoriesQuery.data ?? [];

  // Whole-tree search (#2075). Before this, the input was labelled "Search
  // categories" but filtered only the CURRENT level, so searching from the
  // root reported `No categories match "…"` for a category two levels down —
  // a false statement, not merely a missing feature.
  const debouncedSearch = useDebouncedValue(search, 250);
  const isSearching = isSearchableCategoryQuery(debouncedSearch);
  const searchQuery = useCategorySearchQuery(connectionId, debouncedSearch, true);

  // The breadcrumb is deliberately NOT cleared while searching, so clearing the
  // query returns the operator to the level they left (issue AC).
  function drillInto(node: Crumb): void {
    setBreadcrumb((prev) => [...prev, node]);
    setSearch('');
  }

  function jumpToRoot(): void {
    setBreadcrumb([]);
    setSearch('');
  }

  function jumpToCrumb(index: number): void {
    setBreadcrumb((prev) => prev.slice(0, index + 1));
    setSearch('');
  }

  function pick(node: { id: string; name: string }): void {
    onSelect(node.id, [...breadcrumb.map((c) => c.name), node.name]);
    onClose();
  }

  /**
   * A search hit is not under the current breadcrumb, so its display path must
   * come from the hit's OWN path. Deriving it from `breadcrumb` here would
   * stamp the chip with a trail the category does not have.
   */
  function pickHit(hit: CategorySearchResultHit): void {
    onSelect(
      hit.id,
      hit.path.map((node) => node.name)
    );
    onClose();
  }

  const searchHits = toCategorySearchResultHits(searchQuery.data);

  // A synced scope always has roots, and this body remounts at root on every
  // open — so "at root with nothing in it" is the honest signal for a taxonomy
  // that has never synced. Anywhere else, the tree demonstrably has content and
  // an empty result really is "no matches". A FAILED browse is excluded inside
  // the helper: it also leaves zero nodes, and calling that "never synced"
  // would be a fresh false claim about the operator's catalogue.
  const taxonomyNeverSynced = isTaxonomyUnsynced({
    atRoot: breadcrumb.length === 0,
    browsedNodeCount: nodes.length,
    isBrowseLoading: categoriesQuery.isLoading,
    browseError: categoriesQuery.error,
  });

  return (
    <>
      <div className="bulk-editor__catpick-head">
        <DialogTitle className="bulk-editor__catpick-title">
          Choose category <span>- {productName}</span>
        </DialogTitle>
        <Button
          tone="ghost"
          type="button"
          className="button--icon"
          aria-label="Close category picker"
          onClick={onClose}
        >
          ×
        </Button>
      </div>
      <DialogDescription className="sr-only">
        Pick the marketplace category shared by every variant of this product.
      </DialogDescription>

      <div className="bulk-editor__catpick-search">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search all categories..."
          aria-label="Search all categories"
          aria-controls="bulk-catpick-search-results"
        />
      </div>

      {/* The breadcrumb describes the drill-down position, which a flat result
          list does not have — hiding it while searching keeps it from reading
          as the results' location. It is preserved, not reset, so clearing the
          query restores the level. */}
      {isSearching ? null : (
        <nav className="bulk-editor__catpick-crumbs" aria-label="Category path">
          <button
            type="button"
            className="bulk-editor__catpick-crumb"
            onClick={jumpToRoot}
            disabled={breadcrumb.length === 0}
          >
            Root
          </button>
          {breadcrumb.map((crumb, i) => (
            <span key={crumb.id} className="bulk-editor__catpick-crumb-group">
              <span className="bulk-editor__catpick-sep" aria-hidden="true">
                ›
              </span>
              {i === breadcrumb.length - 1 ? (
                <span className="bulk-editor__catpick-crumb-cur">{crumb.name}</span>
              ) : (
                <button
                  type="button"
                  className="bulk-editor__catpick-crumb"
                  onClick={() => jumpToCrumb(i)}
                >
                  {crumb.name}
                </button>
              )}
            </span>
          ))}
        </nav>
      )}

      <div className="bulk-editor__catpick-list">
        {isSearching ? (
          <CategorySearchResults
            listId="bulk-catpick-search-results"
            hits={searchHits}
            isLoading={searchQuery.isLoading}
            error={searchQuery.error}
            onRetry={() => void searchQuery.refetch()}
            onSelect={pickHit}
            // An offer must sit on a leaf, so a non-leaf hit is shown but not
            // selectable rather than hidden.
            canSelect={(hit) => hit.leaf}
            selectedId={selectedId}
            emptyReason={taxonomyNeverSynced ? 'not-synced' : 'no-matches'}
            query={debouncedSearch}
          />
        ) : categoriesQuery.isLoading ? (
          <LoadingState
            liveRegion="off"
            title="Loading categories"
            message="Fetching categories..."
          />
        ) : categoriesQuery.error ? (
          <ErrorState
            title="Unable to load categories"
            message={categoriesQuery.error.message}
            action={<Button onClick={() => void categoriesQuery.refetch()}>Retry</Button>}
          />
        ) : nodes.length === 0 ? (
          <div className="bulk-editor__catpick-empty">
            {breadcrumb.length === 0
              ? 'No categories synced yet for this destination. Search will work once the first sync completes.'
              : 'This level has no subcategories. Step back and pick a different branch.'}
          </div>
        ) : (
          <ul className="bulk-editor__catpick-items" role="list">
            {nodes.map((node) => {
              const isCurrent = node.leaf && node.id === selectedId;
              return (
                <li
                  key={node.id}
                  className={[
                    'bulk-editor__catpick-item',
                    isCurrent ? 'bulk-editor__catpick-item--current' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <span className="bulk-editor__catpick-name">
                    <b>{node.name}</b>
                    <small>{node.leaf ? 'selectable category' : 'subcategory'}</small>
                  </span>
                  {node.leaf ? (
                    <Button
                      tone={isCurrent ? 'secondary' : 'primary'}
                      type="button"
                      className="button--sm"
                      aria-pressed={isCurrent}
                      onClick={() => pick(node)}
                    >
                      {isCurrent ? 'Selected' : 'Select'}
                    </Button>
                  ) : (
                    <Button
                      tone="ghost"
                      type="button"
                      className="button--sm bulk-editor__catpick-browse"
                      aria-label={`Browse into ${node.name}`}
                      onClick={() => drillInto({ id: node.id, name: node.name })}
                    >
                      Browse ›
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="bulk-editor__catpick-foot">
        <span className="grow">
          {scope === 'variant'
            ? 'Applies to this variant only - it leaves the grouped listing.'
            : 'Applies to all variants - Allegro groups siblings under one category.'}
        </span>
        <Button tone="ghost" type="button" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </>
  );
}
