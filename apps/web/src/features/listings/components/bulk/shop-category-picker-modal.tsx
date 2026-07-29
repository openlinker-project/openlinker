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
import { useMemo, useState, type ReactElement } from 'react';
import { Button, Input } from '../../../../shared/ui';
import { ErrorState, LoadingState } from '../../../../shared/ui/feedback-state';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../../../shared/ui/dialog';
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
  const query = search.trim().toLowerCase();
  const visible = useMemo(
    () => (query === '' ? nodes : nodes.filter((n) => n.name.toLowerCase().includes(query))),
    [nodes, query],
  );

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
          placeholder="Filter this level..."
          aria-label="Filter categories in this level"
        />
      </div>

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

      <div className="bulk-editor__catpick-list">
        {categoriesQuery.isLoading ? (
          <LoadingState liveRegion="off" title="Loading categories" message="Fetching categories..." />
        ) : categoriesQuery.error ? (
          <ErrorState
            title="Unable to load categories"
            message={categoriesQuery.error.message}
            action={<Button onClick={() => void categoriesQuery.refetch()}>Retry</Button>}
          />
        ) : visible.length === 0 ? (
          <div className="bulk-editor__catpick-empty">
            {query === ''
              ? breadcrumb.length === 0
                ? 'This shop has no categories yet.'
                : 'This category has no subcategories. Select it, or step back to a different branch.'
              : `No categories match "${search.trim()}".`}
          </div>
        ) : (
          <ul className="bulk-editor__catpick-items" role="list">
            {visible.map((node) => {
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
