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

import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
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
import { DesktopOnlyBanner } from '../../shared/ui/desktop-only-banner';
import { Select } from '../../shared/ui/select';
import type { AllegroCategory } from '../../features/mappings/api/mappings.types';
import { bucketCount, captureDemoEvent } from '../../features/demo';
import { interpolate, useFormat, useMessages, usePlural } from '../../shared/i18n';

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
  const copy = useMessages('connections').connectionCategoryMappingsPage;
  const plural = usePlural();
  const format = useFormat();

  const connectionsQuery = useConnectionsQuery();
  const marketplaceConnections = useMemo(
    () =>
      (connectionsQuery.data ?? []).filter(
        (c) => c.status === 'active' && c.enabledCapabilities.includes('OfferManager'),
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

  const isLoading =
    connectionsQuery.isLoading || mappingsQuery.isLoading || prestashopCategoriesQuery.isLoading;
  const loadError =
    connectionsQuery.error ?? mappingsQuery.error ?? prestashopCategoriesQuery.error ?? null;

  // Fire once per successful load, not on every refetch — demo-mode
  // analytics only (#1789), no-op elsewhere.
  const hasFiredMappingOpenedRef = useRef(false);
  useEffect(() => {
    if (
      !isLoading &&
      !loadError &&
      marketplaceConnections.length > 0 &&
      categories.length > 0 &&
      !hasFiredMappingOpenedRef.current
    ) {
      hasFiredMappingOpenedRef.current = true;
      captureDemoEvent('demo_category_mapping_opened', {
        mappedCountBucket: bucketCount(mappedCount),
      });
    }
  }, [isLoading, loadError, marketplaceConnections.length, categories.length, mappedCount]);

  function handleMarketplaceChange(nextId: string): void {
    captureDemoEvent('demo_category_source_selected', {});
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
    captureDemoEvent('demo_category_map_attempted', {});
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

  const backTo = { to: `/connections/${connectionId}`, label: copy.eyebrow };

  if (isLoading) {
    return (
      <PageLayout backTo={backTo} eyebrow={copy.eyebrow} title={copy.title}>
        <LoadingState liveRegion="off" title={copy.loading.title} message={copy.loading.message} />
      </PageLayout>
    );
  }

  if (loadError) {
    return (
      <PageLayout backTo={backTo} eyebrow={copy.eyebrow} title={copy.title}>
        <ErrorState title={copy.error.title} message={loadError.message} />
      </PageLayout>
    );
  }

  if (marketplaceConnections.length === 0) {
    return (
      <PageLayout backTo={backTo} eyebrow={copy.eyebrow} title={copy.title}>
        <EmptyState
          title={copy.noMarketplace.title}
          message={copy.noMarketplace.message}
          action={
            <Link className="button button--primary" to="/connections/new">
              {copy.noMarketplace.addConnection}
            </Link>
          }
        />
      </PageLayout>
    );
  }

  if (categories.length === 0) {
    return (
      <PageLayout backTo={backTo} eyebrow={copy.eyebrow} title={copy.title}>
        <EmptyState
          title={copy.noCategories.title}
          message={copy.noCategories.message}
        />
      </PageLayout>
    );
  }

  return (
    <PageLayout
      backTo={backTo}
      eyebrow={copy.eyebrow}
      title={copy.title}
      description={plural(categories.length, copy.mappedSummary, {
        mapped: format.number(mappedCount),
      })}
    >
      <DesktopOnlyBanner title={copy.desktopOnly.title}>{copy.desktopOnly.body}</DesktopOnlyBanner>

      <div className="category-mappings-toolbar">
        <label className="category-mappings-toolbar__label" htmlFor="marketplace-connection-select">
          {copy.marketplaceSelect.label}
        </label>
        <Select
          id="marketplace-connection-select"
          value={marketplaceConnectionId}
          onChange={(e) => { handleMarketplaceChange(e.target.value); }}
        >
          <option value="" disabled>
            {copy.marketplaceSelect.placeholder}
          </option>
          {marketplaceConnections.map((c) => (
            <option key={c.id} value={c.id}>
              {interpolate(copy.marketplaceSelect.option, { name: c.name, platform: c.platformType })}
            </option>
          ))}
        </Select>
      </div>

      <div className="category-mappings-layout">
        <div className="category-mappings-layout__tree">
          <h3>{copy.sourceHeading}</h3>
          <CategoryMappingTree
            categories={categories}
            mappings={mappings}
            selectedCategoryId={selectedCategoryId}
            onSelect={setSelectedCategoryId}
          />
        </div>

        <div className="category-mappings-layout__search">
          <h3>{copy.marketplaceHeading}</h3>
          {!marketplaceConnectionId ? (
            <EmptyState
              title={copy.pickMarketplace.title}
              message={copy.pickMarketplace.message}
            />
          ) : !selectedCategoryId ? (
            <EmptyState
              title={copy.pickCategory.title}
              message={copy.pickCategory.message}
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
