/**
 * Connection Category Mappings Page
 *
 * Two-column layout for mapping the master's categories to a marketplace's
 * categories. Left: the category tree of the route connection, which must hold
 * the catalogue (ProductMaster). Right: the category browser of the
 * marketplace picked in the "Map for" selector.
 *
 * A mapping is saved under the MARKETPLACE connection and scoped to the master
 * (#3993): that pair is the key offer creation resolves by. Mappings the page
 * saved under the master's own id before that change are offered for adoption
 * through a notice, because when two connections share a marketplace platform
 * OpenLinker cannot tell which one they were meant for.
 *
 * The marketplace pick lives in `?marketplaceConnectionId=`, mirrored to
 * localStorage so a returning user defaults back to their last pick.
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
  useReassignCategoryMappings,
} from '../../features/mappings/hooks/use-category-mappings';
import { usePrestashopCategoriesQuery } from '../../features/mappings/hooks/use-prestashop-categories';
import { resolvePlatformLabel } from '../../features/mappings/lib/platform-label';
import { useConnectionsQuery } from '../../features/connections/hooks/use-connections-query';
import type { Connection } from '../../features/connections/api/connections.types';
import { LoadingState, ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import { DesktopOnlyBanner } from '../../shared/ui/desktop-only-banner';
import { Select } from '../../shared/ui/select';
import { Alert } from '../../shared/ui/alert';
import { Button } from '../../shared/ui/button';
import { Chip } from '../../shared/ui/chip';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog';
import { usePlatforms } from '../../shared/plugins';
import { interpolate, useMessages } from '../../shared/i18n';
import type { AllegroCategory } from '../../features/mappings/api/mappings.types';
import { bucketCount, captureDemoEvent } from '../../features/demo';

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

function holdsCatalogue(connection: Connection): boolean {
  return connection.enabledCapabilities.includes('ProductMaster');
}

/**
 * A marketplace this page can map to: it lists offers and has a category tree
 * of its own to browse. A shop with stock write-back (OfferManager without a
 * category tree) and a marketplace that borrows another platform's categories
 * are left out - neither has a tree to pick from.
 */
function isMappableMarketplace(connection: Connection, masterId: string): boolean {
  return (
    connection.id !== masterId &&
    connection.status === 'active' &&
    connection.enabledCapabilities.includes('OfferManager') &&
    connection.supportedCapabilities.includes('CategoryBrowser')
  );
}

export function ConnectionCategoryMappingsPage(): ReactElement {
  const copy = useMessages('mappings').categoryMappings;
  const platforms = usePlatforms();
  const { connectionId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [isReassignOpen, setIsReassignOpen] = useState(false);

  const connectionsQuery = useConnectionsQuery();
  const connections = useMemo(() => connectionsQuery.data ?? [], [connectionsQuery.data]);
  const master = connections.find((c) => c.id === connectionId);
  const isMaster = master !== undefined && holdsCatalogue(master);

  const marketplaceConnections = useMemo(
    () => connections.filter((c) => isMappableMarketplace(c, connectionId)),
    [connections, connectionId],
  );

  const urlMarketplaceId = searchParams.get('marketplaceConnectionId');
  const marketplaceConnectionId =
    urlMarketplaceId && marketplaceConnections.some((c) => c.id === urlMarketplaceId) ? urlMarketplaceId : '';
  const marketplace = marketplaceConnections.find((c) => c.id === marketplaceConnectionId);

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

  const mappingsQuery = useCategoryMappingsQuery(marketplaceConnectionId, connectionId, isMaster);
  // Rows saved under the master's own id: the key the page wrote before #3993.
  const legacyQuery = useCategoryMappingsQuery(connectionId, undefined, isMaster);
  const prestashopCategoriesQuery = usePrestashopCategoriesQuery(connectionId, isMaster);
  const upsertMutation = useUpsertCategoryMapping(marketplaceConnectionId, connectionId);
  const deleteMutation = useDeleteCategoryMapping(marketplaceConnectionId, connectionId);
  const reassignMutation = useReassignCategoryMappings(marketplaceConnectionId);

  const mappings = useMemo(() => mappingsQuery.data ?? [], [mappingsQuery.data]);
  const legacyMappings = legacyQuery.data ?? [];
  const categories = useMemo(() => prestashopCategoriesQuery.data ?? [], [prestashopCategoriesQuery.data]);

  const mappedCount = useMemo(() => {
    const mappedIds = new Set(mappings.map((m) => m.prestashopCategoryId));
    return categories.filter((c) => mappedIds.has(c.id)).length;
  }, [mappings, categories]);

  const selectedMapping = useMemo(
    () => (selectedCategoryId ? mappings.find((m) => m.prestashopCategoryId === selectedCategoryId) : undefined),
    [mappings, selectedCategoryId],
  );

  const categoryName = (id: string): string => categories.find((c) => c.id === id)?.name ?? id;

  const isLoading =
    connectionsQuery.isLoading ||
    (isMaster && (prestashopCategoriesQuery.isLoading || legacyQuery.isLoading));
  const loadError =
    connectionsQuery.error ?? prestashopCategoriesQuery.error ?? legacyQuery.error ?? null;

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
    reassignMutation.reset();
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

  function handleReassign(): void {
    reassignMutation.mutate(connectionId, {
      onSettled: () => {
        setIsReassignOpen(false);
      },
    });
  }

  const pageTitle = copy.title;
  const backTo = { to: `/connections/${connectionId}`, label: master?.name ?? copy.backLabel };

  if (isLoading) {
    return (
      <PageLayout backTo={backTo} eyebrow={master?.name} title={pageTitle}>
        <LoadingState liveRegion="off" title={copy.loadingTitle} message={copy.loadingMessage} />
      </PageLayout>
    );
  }

  if (loadError) {
    return (
      <PageLayout backTo={backTo} eyebrow={master?.name} title={pageTitle}>
        <ErrorState title={copy.errorTitle} message={loadError.message} />
      </PageLayout>
    );
  }

  if (!isMaster) {
    // Opened on a marketplace (or any connection without a catalogue): its
    // categories are the target, never the source, so point at the masters.
    const catalogueConnections = connections.filter((c) => c.status === 'active' && holdsCatalogue(c));
    const connectionName = master?.name ?? copy.thisConnection;
    const marketplaceParam = master && isMappableMarketplace(master, '') ? `?marketplaceConnectionId=${master.id}` : '';
    return (
      <PageLayout backTo={backTo} eyebrow={master?.name} title={pageTitle}>
        <EmptyState
          title={copy.notCatalogueTitle}
          message={interpolate(copy.notCatalogueMessage, { connection: connectionName })}
          action={
            catalogueConnections.length > 0 ? (
              <div className="category-mappings-catalogue-links">
                {catalogueConnections.map((c, index) => (
                  <Link
                    key={c.id}
                    className={index === 0 ? 'button button--primary' : 'button button--secondary'}
                    to={`/connections/${c.id}/mappings/categories${marketplaceParam}`}
                    data-testid="category-mappings-catalogue-link"
                  >
                    {interpolate(copy.mapFrom, { connection: c.name })}
                  </Link>
                ))}
              </div>
            ) : undefined
          }
        />
      </PageLayout>
    );
  }

  const masterPlatform = resolvePlatformLabel(platforms, master);

  if (marketplaceConnections.length === 0) {
    return (
      <PageLayout backTo={backTo} eyebrow={master.name} title={pageTitle}>
        <EmptyState
          title={copy.noMarketplaceTitle}
          message={copy.noMarketplaceMessage}
          action={
            <Link className="button button--primary" to="/connections/new">
              {copy.addConnection}
            </Link>
          }
        />
      </PageLayout>
    );
  }

  if (categories.length === 0) {
    return (
      <PageLayout backTo={backTo} eyebrow={master.name} title={pageTitle}>
        <EmptyState
          title={copy.noCategoriesTitle}
          message={interpolate(copy.noCategoriesMessage, { connection: master.name, platform: masterPlatform })}
        />
      </PageLayout>
    );
  }

  const reassignResult = reassignMutation.data;

  return (
    <PageLayout
      backTo={backTo}
      eyebrow={master.name}
      title={pageTitle}
      description={
        marketplace
          ? interpolate(copy.summary, {
              mapped: String(mappedCount),
              total: String(categories.length),
              marketplace: marketplace.name,
            })
          : undefined
      }
    >
      <DesktopOnlyBanner title={copy.desktopTitle}>{copy.desktopBody}</DesktopOnlyBanner>

      {marketplace && legacyMappings.length > 0 ? (
        <Alert
          tone="warning"
          data-testid="category-mappings-legacy-notice"
          title={interpolate(copy.legacyTitle, { count: String(legacyMappings.length) })}
          action={
            <Button
              tone="secondary"
              onClick={() => { setIsReassignOpen(true); }}
              data-testid="category-mappings-legacy-action"
            >
              {interpolate(copy.legacyAction, { marketplace: marketplace.name })}
            </Button>
          }
        >
          {copy.legacyBody}
        </Alert>
      ) : null}

      {marketplace && reassignResult ? (
        <Alert
          tone="success"
          data-testid="category-mappings-legacy-moved"
          title={interpolate(copy.legacyMovedTitle, {
            count: String(reassignResult.moved),
            marketplace: marketplace.name,
          })}
        >
          {reassignResult.keptSourceCategoryIds.length > 0
            ? interpolate(copy.legacyKept, {
                categories: reassignResult.keptSourceCategoryIds.map(categoryName).join(', '),
              })
            : copy.legacyMovedBody}
        </Alert>
      ) : null}

      {reassignMutation.isError ? (
        <Alert tone="error" title={copy.legacyFailedTitle}>
          {reassignMutation.error.message}
        </Alert>
      ) : null}

      <div className="category-mappings-toolbar">
        <label className="category-mappings-toolbar__label" htmlFor="marketplace-connection-select">
          {copy.mapForLabel}
        </label>
        <Select
          id="marketplace-connection-select"
          data-testid="category-mappings-marketplace-select"
          value={marketplaceConnectionId}
          onChange={(e) => { handleMarketplaceChange(e.target.value); }}
        >
          <option value="" disabled>
            {copy.mapForPlaceholder}
          </option>
          {marketplaceConnections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        {marketplace ? (
          <p className="category-mappings-toolbar__hint" data-testid="category-mappings-scope-hint">
            {interpolate(copy.scopeHint, { marketplace: marketplace.name })}
          </p>
        ) : null}
      </div>

      <div className="category-mappings-layout">
        <div className="category-mappings-layout__tree">
          <h3>{interpolate(copy.sourceColumn, { platform: masterPlatform })}</h3>
          <CategoryMappingTree
            categories={categories}
            mappings={mappings}
            selectedCategoryId={selectedCategoryId}
            onSelect={setSelectedCategoryId}
          />
        </div>

        <div className="category-mappings-layout__search">
          <h3>
            {marketplace
              ? interpolate(copy.targetColumn, { marketplace: marketplace.name })
              : copy.targetColumnFallback}
          </h3>
          {!marketplace ? (
            <EmptyState title={copy.selectMarketplaceTitle} message={copy.selectMarketplaceMessage} />
          ) : mappingsQuery.error ? (
            <ErrorState title={copy.errorTitle} message={mappingsQuery.error.message} />
          ) : !selectedCategoryId ? (
            <EmptyState
              title={copy.selectCategoryTitle}
              message={interpolate(copy.selectCategoryMessage, {
                platform: masterPlatform,
                marketplace: marketplace.name,
              })}
            />
          ) : (
            <AllegroCategorySearch
              key={marketplaceConnectionId}
              marketplaceConnectionId={marketplaceConnectionId}
              currentMapping={selectedMapping}
              onSelect={handleAllegroSelect}
              onClear={handleClear}
              isSaving={upsertMutation.isPending || deleteMutation.isPending}
            />
          )}
        </div>
      </div>

      {marketplace ? (
        <ConfirmDialog
          open={isReassignOpen}
          onOpenChange={setIsReassignOpen}
          title={interpolate(copy.legacyConfirmTitle, { marketplace: marketplace.name })}
          description={interpolate(copy.legacyConfirmBody, { marketplace: marketplace.name })}
          body={
            <ul className="category-mappings-legacy-list" data-testid="category-mappings-legacy-list">
              {legacyMappings.map((m) => {
                const alreadyMapped = mappings.some((x) => x.prestashopCategoryId === m.prestashopCategoryId);
                return (
                  <li key={m.id}>
                    <span>{categoryName(m.prestashopCategoryId)}</span>
                    <span className="category-mappings-legacy-list__arrow" aria-hidden="true">→</span>
                    <span className="mono-text">{m.allegroCategoryName}</span>
                    {alreadyMapped ? <Chip tone="neutral">{copy.legacyAlreadyMapped}</Chip> : null}
                  </li>
                );
              })}
            </ul>
          }
          confirmLabel={interpolate(copy.legacyConfirmAction, { marketplace: marketplace.name })}
          isConfirming={reassignMutation.isPending}
          onConfirm={handleReassign}
        />
      ) : null}
    </PageLayout>
  );
}
