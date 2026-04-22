/**
 * AllegroCategorySearch
 *
 * Browseable Allegro category tree with lazy-loaded children for the
 * PrestaShop↔Allegro category mapping editor. Thin wrapper around the
 * shared `CategoryTreeBrowser` primitive — adds the current-mapping
 * row, the staged-pick preview, and the "Save mapping" / "Cancel"
 * confirmation flow.
 *
 * Selection is staged — clicking Select (at any tree level) previews
 * the pick. The caller receives the final choice only when the user
 * confirms with "Save mapping".
 *
 * @module apps/web/src/features/mappings/components
 */

import { useState, type ReactElement } from 'react';
import { useAllegroCategoriesQuery } from '../hooks/use-allegro-categories';
import { Button } from '../../../shared/ui/button';
import {
  buildCategoryPath,
  CategoryTreeBrowser,
  type CategoryTreeCrumb,
  type CategoryTreeNode,
} from '../../../shared/ui/category-tree-browser';
import type { AllegroCategory, CategoryMapping } from '../api/mappings.types';

interface AllegroCategorySearchProps {
  marketplaceConnectionId: string;
  currentMapping: CategoryMapping | undefined;
  onSelect: (category: AllegroCategory, path: string) => void;
  onClear: () => void;
  isSaving: boolean;
}

interface StagedPick {
  category: AllegroCategory;
  path: string;
}

export function AllegroCategorySearch({
  marketplaceConnectionId,
  currentMapping,
  onSelect,
  onClear,
  isSaving,
}: AllegroCategorySearchProps): ReactElement {
  const [parentId, setParentId] = useState<string | undefined>(undefined);
  const [staged, setStaged] = useState<StagedPick | null>(null);

  const categoriesQuery = useAllegroCategoriesQuery(marketplaceConnectionId, parentId);

  function handlePrimitiveSelect(
    node: CategoryTreeNode,
    breadcrumb: readonly CategoryTreeCrumb[],
  ): void {
    // Node shape from primitive is structurally compatible with AllegroCategory.
    setStaged({ category: node as AllegroCategory, path: buildCategoryPath(breadcrumb, node) });
  }

  function handleSave(): void {
    if (!staged) return;
    onSelect(staged.category, staged.path);
    setStaged(null);
  }

  function handleCancel(): void {
    setStaged(null);
  }

  return (
    <div className="allegro-category-search">
      {/* Current saved mapping */}
      {currentMapping && !staged && (
        <div className="allegro-category-search__current">
          <span className="mono-text">{currentMapping.allegroCategoryName}</span>
          {currentMapping.allegroCategoryPath && (
            <span className="allegro-category-search__path">{currentMapping.allegroCategoryPath}</span>
          )}
          <Button className="button--ghost button--sm" onClick={onClear} disabled={isSaving}>
            Clear mapping
          </Button>
        </div>
      )}

      {/* Staged (unsaved) pick */}
      {staged && (
        <div className="allegro-category-search__staged">
          <span className="allegro-category-search__staged-label">Selected:</span>
          <span className="mono-text">{staged.category.name}</span>
          {staged.path && (
            <span className="allegro-category-search__path">{staged.path}</span>
          )}
          <span className="allegro-category-search__staged-actions">
            <Button
              className="button--primary button--sm"
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? 'Saving…' : 'Save mapping'}
            </Button>
            <Button
              className="button--ghost button--sm"
              onClick={handleCancel}
              disabled={isSaving}
            >
              Cancel
            </Button>
          </span>
        </div>
      )}

      {/* Browse / navigate / select — shared primitive. `key` honors the
          breadcrumb-reset contract if the caller ever swaps connections
          without remounting this wrapper. */}
      <CategoryTreeBrowser
        key={marketplaceConnectionId}
        nodes={categoriesQuery.data}
        isLoading={categoriesQuery.isLoading}
        error={categoriesQuery.error}
        onRetry={() => void categoriesQuery.refetch()}
        onSelect={handlePrimitiveSelect}
        onNavigate={(pid) => setParentId(pid)}
        selectedId={staged?.category.id ?? null}
        canSelect={() => true}
        disabled={isSaving}
      />
    </div>
  );
}
