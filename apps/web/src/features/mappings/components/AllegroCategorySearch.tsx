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
import { useCategorySearchQuery, isSearchableCategoryQuery } from '../hooks/use-category-search';
import { toCategorySearchResultHits, isTaxonomyUnsynced } from '../lib/category-search-hits';
import { Button, Input } from '../../../shared/ui';
import { useDebouncedValue } from '../../../shared/hooks/use-debounced-value';
import {
  buildCategoryPath,
  CategoryTreeBrowser,
  type CategoryTreeCrumb,
  type CategoryTreeNode,
} from '../../../shared/ui/category-tree-browser';
import {
  CategorySearchResults,
  type CategorySearchResultHit,
} from '../../../shared/ui/category-search-results';
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
  const [search, setSearch] = useState('');

  const categoriesQuery = useAllegroCategoriesQuery(marketplaceConnectionId, parentId);

  // Until #2075 this component was named "Search" but offered only drill-down.
  // Mapping authoring is where whole-tree search matters most: the operator is
  // matching a source category by a name they already know, so making them
  // guess its branch first is the worst possible fit.
  const debouncedSearch = useDebouncedValue(search, 250);
  const isSearching = isSearchableCategoryQuery(debouncedSearch);
  const searchQuery = useCategorySearchQuery(marketplaceConnectionId, debouncedSearch);

  const searchHits = toCategorySearchResultHits(searchQuery.data);

  // A failed browse is excluded inside the helper — it leaves zero nodes too,
  // and "never synced" would be a false claim about the operator's catalogue.
  const taxonomyNeverSynced = isTaxonomyUnsynced({
    atRoot: parentId === undefined,
    browsedNodeCount: (categoriesQuery.data ?? []).length,
    isBrowseLoading: categoriesQuery.isLoading,
    browseError: categoriesQuery.error,
  });

  function handlePrimitiveSelect(
    node: CategoryTreeNode,
    breadcrumb: readonly CategoryTreeCrumb[],
  ): void {
    // Node shape from primitive is structurally compatible with AllegroCategory.
    setStaged({ category: node as AllegroCategory, path: buildCategoryPath(breadcrumb, node) });
  }

  /**
   * Stage a search hit. The path string is built from the HIT's own breadcrumb,
   * not from tree navigation — the hit is not under the browsed position, so
   * `buildCategoryPath(breadcrumb, node)` would persist a wrong
   * `allegroCategoryPath` onto the saved mapping.
   */
  function handleSearchSelect(hit: CategorySearchResultHit): void {
    setStaged({
      category: {
        id: hit.id,
        name: hit.name,
        leaf: hit.leaf,
        parentId: hit.path.length > 1 ? hit.path[hit.path.length - 2].id : null,
      },
      path: hit.path.map((node) => node.name).join(' > '),
    });
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

      <div className="allegro-category-search__search">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search all categories..."
          aria-label="Search all categories"
          disabled={isSaving}
        />
      </div>

      {/* Search replaces the tree while active rather than filtering it: a hit
          can come from any branch, so there is no drill-down position that
          would describe the results. Clearing the query restores the browser at
          the level it was left on, since `parentId` is untouched here. */}
      {isSearching ? (
        <CategorySearchResults
          hits={searchHits}
          isLoading={searchQuery.isLoading}
          error={searchQuery.error}
          onRetry={() => void searchQuery.refetch()}
          onSelect={handleSearchSelect}
          // A category mapping may target any level, matching the tree
          // browser's own `canSelect={() => true}` on this surface.
          canSelect={() => true}
          selectedId={staged?.category.id ?? null}
          emptyReason={taxonomyNeverSynced ? 'not-synced' : 'no-matches'}
          query={debouncedSearch}
          disabled={isSaving}
        />
      ) : (
        /* Browse / navigate / select — shared primitive. `key` honors the
           breadcrumb-reset contract if the caller ever swaps connections
           without remounting this wrapper. */
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
      )}
    </div>
  );
}
