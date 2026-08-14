/**
 * Shop Category Picker modal (#1834)
 *
 * Destination category picker for a *shop* publish target (WooCommerce today).
 * The shop-side analogue of `BulkCategoryChooseModal` (which browses a
 * marketplace's leaf-gated taxonomy): a search input, a clickable breadcrumb,
 * and a drill-down list of child categories.
 *
 * Shop semantics differ from a marketplace: a shop lets you assign a product to
 * ANY category node, so every row offers BOTH "Select" (pick this node) and
 * "Browse" (drill into its children). Drilling into a node with no children
 * shows an empty-level message.
 *
 * Self-contained: consumes only the `useShopCategoriesQuery` hook + the shared
 * dialog/UI primitives. Intended to be mounted by the shop edit modal (#1830)
 * exactly where the marketplace path mounts `BulkCategoryChooseModal`, gated on
 * the connection's shop `ShopCategoryBrowser` capability. It fires
 * `onSelect(categoryId, pathNames)` — `pathNames` is the full breadcrumb
 * (ancestors + leaf) captured at selection time so the caller can render a chip
 * breadcrumb without a second round-trip.
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import { useState, type ReactElement } from 'react';
import { Button, Input } from '../../../../shared/ui';
import { ErrorState, LoadingState } from '../../../../shared/ui/feedback-state';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../../../shared/ui/dialog';
import {
  CategorySearchResults,
  type CategorySearchResultHit,
} from '../../../../shared/ui/category-search-results';
import { useDebouncedValue } from '../../../../shared/hooks/use-debounced-value';
import {
  useCategorySearchQuery,
  isSearchableCategoryQuery,
  toCategorySearchResultHits,
  isTaxonomyUnsynced,
} from '../../../mappings';
import { useShopCategoriesQuery } from '../../hooks/use-shop-categories-query';

interface Crumb {
  id: string;
  name: string;
}

interface ShopCategoryPickerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string;
  productName: string;
  selectedId: string | null;
  /** Fires with the picked category id + the full breadcrumb path names (ancestors + leaf). */
  onSelect: (categoryId: string, pathNames: string[]) => void;
}

export function ShopCategoryPickerModal({
  open,
  onOpenChange,
  connectionId,
  productName,
  selectedId,
  onSelect,
}: ShopCategoryPickerModalProps): ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="bulk-editor__catpick dialog__content--elevated"
        overlayClassName="bulk-editor__catpick-overlay dialog__overlay--elevated"
      >
        {open ? (
          <ShopCategoryPickerBody
            connectionId={connectionId}
            productName={productName}
            selectedId={selectedId}
            onSelect={onSelect}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ShopCategoryPickerBody({
  connectionId,
  productName,
  selectedId,
  onSelect,
  onClose,
}: {
  connectionId: string;
  productName: string;
  selectedId: string | null;
  onSelect: (categoryId: string, pathNames: string[]) => void;
  onClose: () => void;
}): ReactElement {
  const [breadcrumb, setBreadcrumb] = useState<Crumb[]>([]);
  const [search, setSearch] = useState('');

  const parentId = breadcrumb.length > 0 ? breadcrumb[breadcrumb.length - 1].id : undefined;
  const categoriesQuery = useShopCategoriesQuery(connectionId, parentId, true);

  const nodes = categoriesQuery.data ?? [];

  // Whole-tree search (#2075). The previous input filtered only the loaded
  // level — honestly labelled, unlike the marketplace sibling, but still unable
  // to answer "where is Kurtki?" from the root.
  const debouncedSearch = useDebouncedValue(search, 250);
  const isSearching = isSearchableCategoryQuery(debouncedSearch);
  // The same neutral route the marketplace picker uses: scope resolves from the
  // connection, so a shop connection searches its own connection-keyed rows
  // (ADR-037) with no shop-specific client here.
  const searchQuery = useCategorySearchQuery(connectionId, debouncedSearch, true);

  const searchHits = toCategorySearchResultHits(searchQuery.data);

  // See the marketplace sibling: a failed browse is excluded inside the helper,
  // so a transient error reads as "no matches" rather than the stronger and
  // possibly false "never synced".
  const taxonomyNeverSynced = isTaxonomyUnsynced({
    atRoot: breadcrumb.length === 0,
    browsedNodeCount: nodes.length,
    isBrowseLoading: categoriesQuery.isLoading,
    browseError: categoriesQuery.error,
  });

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
   * A search hit is not under the current breadcrumb — its path must come from
   * the hit itself, or the caller stamps the product with a category trail that
   * does not exist.
   */
  function pickHit(hit: CategorySearchResultHit): void {
    onSelect(
      hit.id,
      hit.path.map((node) => node.name),
    );
    onClose();
  }

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
        Pick a destination shop category for this product. Any category can be selected, or browse
        into it to see its subcategories.
      </DialogDescription>

      <div className="bulk-editor__catpick-search">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search all categories..."
          aria-label="Search all categories"
        />
      </div>

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
            hits={searchHits}
            isLoading={searchQuery.isLoading}
            error={searchQuery.error}
            onRetry={() => void searchQuery.refetch()}
            onSelect={pickHit}
            // A shop product may sit in ANY node, so every hit is selectable —
            // the one behavioural difference from the marketplace picker
            // (ADR-024).
            canSelect={() => true}
            selectedId={selectedId}
            emptyReason={taxonomyNeverSynced ? 'not-synced' : 'no-matches'}
            query={debouncedSearch}
          />
        ) : categoriesQuery.isLoading ? (
          <LoadingState liveRegion="off" title="Loading categories" message="Fetching categories..." />
        ) : categoriesQuery.error ? (
          <ErrorState
            title="Unable to load categories"
            message={categoriesQuery.error.message}
            action={<Button onClick={() => void categoriesQuery.refetch()}>Retry</Button>}
          />
        ) : nodes.length === 0 ? (
          <div className="bulk-editor__catpick-empty">
            {breadcrumb.length === 0
              ? 'This shop has no categories yet.'
              : 'This category has no subcategories. Select it, or step back to a different branch.'}
          </div>
        ) : (
          <ul className="bulk-editor__catpick-items" role="list">
            {nodes.map((node) => {
              const isCurrent = node.id === selectedId;
              return (
                <li
                  key={node.id}
                  className={['bulk-editor__catpick-item', isCurrent ? 'bulk-editor__catpick-item--current' : '']
                    .filter(Boolean)
                    .join(' ')}
                >
                  <span className="bulk-editor__catpick-name">
                    <b>{node.name}</b>
                    <small>selectable category</small>
                  </span>
                  <span className="bulk-editor__catpick-actions">
                    <Button
                      tone="ghost"
                      type="button"
                      className="button--sm bulk-editor__catpick-browse"
                      aria-label={`Browse into ${node.name}`}
                      onClick={() => drillInto({ id: node.id, name: node.name })}
                    >
                      Browse ›
                    </Button>
                    <Button
                      tone={isCurrent ? 'secondary' : 'primary'}
                      type="button"
                      className="button--sm"
                      aria-pressed={isCurrent}
                      aria-label={`Select ${node.name}`}
                      onClick={() => pick(node)}
                    >
                      {isCurrent ? 'Selected' : 'Select'}
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="bulk-editor__catpick-foot">
        <span className="grow">Pick the shop category this product is placed in.</span>
        <Button tone="ghost" type="button" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </>
  );
}
