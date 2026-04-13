/**
 * AllegroCategorySearch
 *
 * Browseable Allegro category tree with lazy-loaded children.
 * Shows breadcrumb path, allows selecting a category for mapping,
 * and clearing an existing mapping.
 *
 * @module apps/web/src/features/mappings/components
 */

import { useState, type ReactElement } from 'react';
import { useAllegroCategoriesQuery } from '../hooks/use-allegro-categories';
import { Button } from '../../../shared/ui/button';
import { LoadingState, ErrorState, EmptyState } from '../../../shared/ui/feedback-state';
import type { AllegroCategory, CategoryMapping } from '../api/mappings.types';

interface AllegroCategorySearchProps {
  marketplaceConnectionId: string;
  currentMapping: CategoryMapping | undefined;
  onSelect: (category: AllegroCategory, path: string) => void;
  onClear: () => void;
  isSaving: boolean;
}

interface BreadcrumbItem {
  id: string;
  name: string;
}

export function AllegroCategorySearch({
  marketplaceConnectionId,
  currentMapping,
  onSelect,
  onClear,
  isSaving,
}: AllegroCategorySearchProps): ReactElement {
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([]);
  const currentParentId = breadcrumbs.length > 0 ? breadcrumbs[breadcrumbs.length - 1].id : undefined;

  const categoriesQuery = useAllegroCategoriesQuery(marketplaceConnectionId, currentParentId);

  function navigateInto(category: AllegroCategory): void {
    setBreadcrumbs((prev) => [...prev, { id: category.id, name: category.name }]);
  }

  function navigateTo(index: number): void {
    setBreadcrumbs((prev) => prev.slice(0, index));
  }

  function buildPath(category: AllegroCategory): string {
    const parts = breadcrumbs.map((b) => b.name);
    parts.push(category.name);
    return parts.join(' > ');
  }

  function handleSelect(category: AllegroCategory): void {
    onSelect(category, buildPath(category));
  }

  return (
    <div className="allegro-category-search">
      {currentMapping && (
        <div className="allegro-category-search__current">
          <span className="mono-text">{currentMapping.allegroCategoryName}</span>
          {currentMapping.allegroCategoryPath && (
            <span className="allegro-category-search__path">{currentMapping.allegroCategoryPath}</span>
          )}
          <Button
            className="button--ghost button--sm"
            onClick={onClear}
            disabled={isSaving}
          >
            Clear mapping
          </Button>
        </div>
      )}

      {/* Breadcrumb navigation */}
      <nav className="allegro-category-search__breadcrumbs" aria-label="Category breadcrumbs">
        <button
          type="button"
          className="allegro-category-search__crumb"
          onClick={() => { navigateTo(0); }}
        >
          Root
        </button>
        {breadcrumbs.map((crumb, i) => (
          <span key={crumb.id}>
            <span className="allegro-category-search__separator"> / </span>
            <button
              type="button"
              className="allegro-category-search__crumb"
              onClick={() => { navigateTo(i + 1); }}
            >
              {crumb.name}
            </button>
          </span>
        ))}
      </nav>

      {/* Category list */}
      {categoriesQuery.isLoading && (
        <LoadingState liveRegion="off" title="Loading categories" message="Fetching Allegro categories..." />
      )}

      {categoriesQuery.error && (
        <ErrorState
          title="Unable to load categories"
          message={categoriesQuery.error.message}
          action={<Button onClick={() => { void categoriesQuery.refetch(); }}>Retry</Button>}
        />
      )}

      {categoriesQuery.data && categoriesQuery.data.length === 0 && (
        <EmptyState title="No subcategories" message="This category has no children." />
      )}

      {categoriesQuery.data && categoriesQuery.data.length > 0 && (
        <ul className="allegro-category-search__list" role="list">
          {categoriesQuery.data.map((cat) => (
            <li key={cat.id} className="allegro-category-search__item">
              <span className="allegro-category-search__name">{cat.name}</span>
              <span className="allegro-category-search__actions">
                {!cat.leaf && (
                  <button
                    type="button"
                    className="button button--ghost button--sm"
                    onClick={() => { navigateInto(cat); }}
                  >
                    Browse
                  </button>
                )}
                <Button
                  className="button--primary button--sm"
                  onClick={() => { handleSelect(cat); }}
                  disabled={isSaving}
                >
                  {isSaving ? 'Saving...' : 'Select'}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
