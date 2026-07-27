/**
 * Bulk Choose-category modal (#1741)
 *
 * External category picker for the per-variant bulk edit modal. Replaces the
 * inline `CategoryPicker` in the base scope with a dedicated modal that matches
 * the approved mockup: a search input, a clickable breadcrumb, and a list of
 * child categories with Browse (drill-in) / Select (pick) affordances.
 *
 * The category lives in the BASE scope only (grouping-determining, base-only -
 * a per-variant category would split Allegro's catalog-product family), so this
 * modal only fires `onSelect(categoryId, pathNames)`. `pathNames` is the full
 * breadcrumb (ancestors + leaf) captured at selection time, used to render the
 * chip breadcrumb without a second round-trip.
 *
 * Only mounted for a browsable destination (`canBrowseCategories === true`).
 * The borrowed-taxonomy path (Erli) keeps its inline "Allegro category ID" text
 * input in the base form instead.
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import { useMemo, useState, type ReactElement } from 'react';
import { Button, Input } from '../../../../shared/ui';
import { ErrorState, LoadingState } from '../../../../shared/ui/feedback-state';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../../../shared/ui/dialog';
import { useAllegroCategoriesQuery } from '../../../mappings';

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
}

export function BulkCategoryChooseModal({
  open,
  onOpenChange,
  connectionId,
  productName,
  selectedId,
  onSelect,
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
  const categoriesQuery = useAllegroCategoriesQuery(connectionId, parentId, true);

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
        Pick the marketplace category shared by every variant of this product.
      </DialogDescription>

      <div className="bulk-editor__catpick-search">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search categories..."
          aria-label="Search categories"
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
              ? 'This level has no subcategories. Step back and pick a different branch.'
              : `No categories match "${search.trim()}".`}
          </div>
        ) : (
          <ul className="bulk-editor__catpick-items" role="list">
            {visible.map((node) => {
              const isCurrent = node.leaf && node.id === selectedId;
              return (
                <li
                  key={node.id}
                  className={['bulk-editor__catpick-item', isCurrent ? 'bulk-editor__catpick-item--current' : '']
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
        <span className="grow">Applies to all variants - Allegro groups siblings under one category.</span>
        <Button tone="ghost" type="button" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </>
  );
}
