/**
 * Connection Category Mappings Page
 *
 * Two-column layout for mapping PrestaShop categories to Allegro categories.
 * Left: PrestaShop category tree with mapping indicators.
 * Right: Allegro category browser for the selected PrestaShop category.
 *
 * @module apps/web/src/pages/connections
 */

import { useState, useMemo, type ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { CategoryMappingTree } from '../../features/mappings/components/CategoryMappingTree';
import { AllegroCategorySearch } from '../../features/mappings/components/AllegroCategorySearch';
import {
  useCategoryMappingsQuery,
  useUpsertCategoryMapping,
  useDeleteCategoryMapping,
} from '../../features/mappings/hooks/use-category-mappings';
import { usePrestashopCategoriesQuery } from '../../features/mappings/hooks/use-prestashop-categories';
import { LoadingState, ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import type { AllegroCategory } from '../../features/mappings/api/mappings.types';

export function ConnectionCategoryMappingsPage(): ReactElement {
  const { connectionId = '' } = useParams();
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);

  const mappingsQuery = useCategoryMappingsQuery(connectionId);
  const prestashopCategoriesQuery = usePrestashopCategoriesQuery(connectionId);

  const upsertMutation = useUpsertCategoryMapping(connectionId);
  const deleteMutation = useDeleteCategoryMapping(connectionId);

  const mappings = mappingsQuery.data ?? [];
  const categories = prestashopCategoriesQuery.data ?? [];

  const mappedCount = useMemo(() => {
    const mappedIds = new Set(mappings.map((m) => m.prestashopCategoryId));
    return categories.filter((c) => mappedIds.has(c.id)).length;
  }, [mappings, categories]);

  const selectedMapping = useMemo(
    () => selectedCategoryId ? mappings.find((m) => m.prestashopCategoryId === selectedCategoryId) : undefined,
    [mappings, selectedCategoryId],
  );

  function handleAllegroSelect(category: AllegroCategory, path: string): void {
    if (!selectedCategoryId) return;
    upsertMutation.mutate({
      prestashopCategoryId: selectedCategoryId,
      payload: {
        allegroCategoryId: category.id,
        allegroCategoryName: category.name,
        allegroCategoryPath: path,
      },
    });
  }

  function handleClear(): void {
    if (!selectedCategoryId) return;
    deleteMutation.mutate(selectedCategoryId);
  }

  const isLoading = mappingsQuery.isLoading || prestashopCategoriesQuery.isLoading;
  const loadError = mappingsQuery.error ?? prestashopCategoriesQuery.error ?? null;

  if (isLoading) {
    return (
      <PageLayout eyebrow="Connection" title="Category Mappings">
        <LoadingState liveRegion="off" title="Loading" message="Fetching categories and mappings..." />
      </PageLayout>
    );
  }

  if (loadError) {
    return (
      <PageLayout eyebrow="Connection" title="Category Mappings">
        <ErrorState title="Unable to load" message={loadError.message} />
      </PageLayout>
    );
  }

  if (categories.length === 0) {
    return (
      <PageLayout
        eyebrow="Connection"
        title="Category Mappings"
        actions={
          <Link className="button button--secondary" to={`/connections/${connectionId}`}>
            Back to connection
          </Link>
        }
      >
        <EmptyState
          title="No PrestaShop categories"
          message="No categories were found for this connection. Ensure the PrestaShop store has categories configured."
        />
      </PageLayout>
    );
  }

  return (
    <PageLayout
      eyebrow="Connection"
      title="Category Mappings"
      description={`${mappedCount} of ${categories.length} categories mapped`}
      actions={
        <Link className="button button--secondary" to={`/connections/${connectionId}`}>
          Back to connection
        </Link>
      }
    >
      <div className="category-mappings-layout">
        <div className="category-mappings-layout__tree">
          <h3>PrestaShop Categories</h3>
          <CategoryMappingTree
            categories={categories}
            mappings={mappings}
            selectedCategoryId={selectedCategoryId}
            onSelect={setSelectedCategoryId}
          />
        </div>

        <div className="category-mappings-layout__search">
          <h3>Allegro Category</h3>
          {selectedCategoryId ? (
            <AllegroCategorySearch
              connectionId={connectionId}
              currentMapping={selectedMapping}
              onSelect={handleAllegroSelect}
              onClear={handleClear}
              isSaving={upsertMutation.isPending || deleteMutation.isPending}
            />
          ) : (
            <EmptyState
              title="Select a category"
              message="Click a PrestaShop category on the left to assign an Allegro category."
            />
          )}
        </div>
      </div>
    </PageLayout>
  );
}
