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
import { useMessages } from '../../../shared/i18n';
import { CategoryPathText } from './category-path-text';
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
  const copy = useMessages('mappings').categoryMappings;

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
    breadcrumb: readonly CategoryTreeCrumb[]
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
      {/* Current saved mapping. A row with no source is the shared fallback for
          every catalogue: it is not this catalogue's to clear, so it says so
          and offers an override instead of a Clear that would remove it for
          the others too (#3993). */}
      {currentMapping && !staged && (
        <div className="allegro-category-search__current" data-testid="category-mapping-current">
          <span className="allegro-category-search__label">
            {currentMapping.sourceConnectionId === null ? copy.sharedMapping : copy.goesTo}
          </span>
          <CategoryPathText path={currentMapping.allegroCategoryPath ?? currentMapping.allegroCategoryName} />
          {currentMapping.sourceConnectionId === null ? (
            <span className="allegro-category-search__note">{copy.sharedMappingHint}</span>
          ) : (
            <Button tone="ghost" className="button--sm allegro-category-search__clear" onClick={onClear} disabled={isSaving}>
              {copy.clearMapping}
            </Button>
          )}
        </div>
      )}

      {/* Staged (unsaved) pick */}
      {staged && (
        <div className="allegro-category-search__staged" data-testid="category-mapping-staged">
          <span className="allegro-category-search__label">
            {currentMapping ? copy.changeTo : copy.mapTo}
          </span>
          <CategoryPathText path={staged.path || staged.category.name} />
          <span className="allegro-category-search__staged-actions">
            <Button tone="primary" className="button--sm" onClick={handleSave} disabled={isSaving}>
              {isSaving ? copy.saving : copy.saveMapping}
            </Button>
            <Button tone="ghost" className="button--sm" onClick={handleCancel} disabled={isSaving}>
              {copy.cancel}
            </Button>
          </span>
        </div>
      )}

      <div className="allegro-category-search__search">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={copy.searchPlaceholder}
          aria-label={copy.searchPlaceholder}
          aria-controls="mapping-catpick-search-results"
          disabled={isSaving}
        />
      </div>

      {/* Search replaces the tree while active rather than filtering it: a hit
          can come from any branch, so there is no drill-down position that
          would describe the results. Clearing the query restores the browser at
          the level it was left on, since `parentId` is untouched here. */}
      {isSearching ? (
        <CategorySearchResults
          listId="mapping-catpick-search-results"
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
