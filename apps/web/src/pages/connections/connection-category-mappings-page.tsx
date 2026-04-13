/**
 * Connection Category Mappings Page
 *
 * Two-column layout for mapping PrestaShop categories to Allegro categories.
 * Left: PrestaShop category tree (from the source connection — must support ProductMaster).
 * Right: Allegro category browser (from a marketplace connection — must support Marketplace).
 *
 * The URL carries the source connection id (`:connectionId`). The marketplace
 * connection is chosen by the operator via a selector and persisted in the
 * `?marketplaceConnectionId=` search param (also mirrored to localStorage so
 * a returning user defaults back to their last pick).
 *
 * @module apps/web/src/pages/connections
 */

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { CategoryMappingTree } from '../../features/mappings/components/CategoryMappingTree';
import { AllegroCategorySearch } from '../../features/mappings/components/AllegroCategorySearch';
import {
  useCategoryMappingsQuery,
  useUpsertCategoryMapping,
  useDeleteCategoryMapping,
} from '../../features/mappings/hooks/use-category-mappings';
import { usePrestashopCategoriesQuery } from '../../features/mappings/hooks/use-prestashop-categories';
import { useConnectionsQuery } from '../../features/connections/hooks/use-connections-query';
import { LoadingState, ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import type { AllegroCategory } from '../../features/mappings/api/mappings.types';

const MARKETPLACE_PICK_STORAGE_PREFIX = 'openlinker.categoryMappings.lastMarketplace.';

function storageKey(sourceConnectionId: string): string {
  return `${MARKETPLACE_PICK_STORAGE_PREFIX}${sourceConnectionId}`;
}

function readPersistedPick(sourceConnectionId: string): string | null {
  try {
    return window.localStorage.getItem(storageKey(sourceConnectionId));
  } catch {
    return null;
  }
}

function persistPick(sourceConnectionId: string, marketplaceConnectionId: string): void {
  try {
    window.localStorage.setItem(storageKey(sourceConnectionId), marketplaceConnectionId);
  } catch {
    // ignore — private browsing / quota issues should not break the page
  }
}

export function ConnectionCategoryMappingsPage(): ReactElement {
  const { connectionId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);

  const connectionsQuery = useConnectionsQuery();
  const marketplaceConnections = useMemo(
    () =>
      (connectionsQuery.data ?? []).filter(
        (c) => c.status === 'active' && c.enabledCapabilities.includes('Marketplace'),
      ),
    [connectionsQuery.data],
  );

  const urlMarketplaceId = searchParams.get('marketplaceConnectionId');
  const marketplaceConnectionId =
    urlMarketplaceId && marketplaceConnections.some((c) => c.id === urlMarketplaceId) ? urlMarketplaceId : '';

  // Resolve a default marketplace pick: URL → persisted → single available.
  useEffect(() => {
    if (marketplaceConnectionId) return;
    if (marketplaceConnections.length === 0) return;

    const persisted = readPersistedPick(connectionId);
    const defaultId =
      (persisted && marketplaceConnections.some((c) => c.id === persisted) ? persisted : null) ??
      (marketplaceConnections.length === 1 ? marketplaceConnections[0].id : null);

    if (defaultId) {
      persistPick(connectionId, defaultId);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('marketplaceConnectionId', defaultId);
          return next;
        },
        { replace: true },
      );
    }
  }, [connectionId, marketplaceConnectionId, marketplaceConnections, setSearchParams]);

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
    () => (selectedCategoryId ? mappings.find((m) => m.prestashopCategoryId === selectedCategoryId) : undefined),
    [mappings, selectedCategoryId],
  );

  function handleMarketplaceChange(nextId: string): void {
    if (nextId) persistPick(connectionId, nextId);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (nextId) next.set('marketplaceConnectionId', nextId);
      else next.delete('marketplaceConnectionId');
      return next;
    });
  }

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

  const backLink = (
    <Link className="button button--secondary" to={`/connections/${connectionId}`}>
      Back to connection
    </Link>
  );

  const isLoading =
    connectionsQuery.isLoading || mappingsQuery.isLoading || prestashopCategoriesQuery.isLoading;
  const loadError =
    connectionsQuery.error ?? mappingsQuery.error ?? prestashopCategoriesQuery.error ?? null;

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

  if (marketplaceConnections.length === 0) {
    return (
      <PageLayout eyebrow="Connection" title="Category Mappings" actions={backLink}>
        <EmptyState
          title="No marketplace connection configured"
          message="Add an Allegro (or other Marketplace) connection before mapping categories."
          action={
            <Link className="button button--primary" to="/connections/new">
              Add connection
            </Link>
          }
        />
      </PageLayout>
    );
  }

  if (categories.length === 0) {
    return (
      <PageLayout eyebrow="Connection" title="Category Mappings" actions={backLink}>
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
      actions={backLink}
    >
      <div className="category-mappings-toolbar">
        <label className="category-mappings-toolbar__label" htmlFor="marketplace-connection-select">
          Marketplace connection
        </label>
        <select
          id="marketplace-connection-select"
          className="input"
          value={marketplaceConnectionId}
          onChange={(e) => { handleMarketplaceChange(e.target.value); }}
        >
          <option value="" disabled>
            Select a marketplace connection…
          </option>
          {marketplaceConnections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.platformType})
            </option>
          ))}
        </select>
      </div>

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
          {!marketplaceConnectionId ? (
            <EmptyState
              title="Select a marketplace connection"
              message="Pick a marketplace connection above to browse its category tree."
            />
          ) : !selectedCategoryId ? (
            <EmptyState
              title="Select a category"
              message="Click a PrestaShop category on the left to assign an Allegro category."
            />
          ) : (
            <AllegroCategorySearch
              marketplaceConnectionId={marketplaceConnectionId}
              currentMapping={selectedMapping}
              onSelect={handleAllegroSelect}
              onClear={handleClear}
              isSaving={upsertMutation.isPending || deleteMutation.isPending}
            />
          )}
        </div>
      </div>
    </PageLayout>
  );
}
