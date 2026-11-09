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
import { CategoryMappingPairStrip } from '../../features/mappings/components/category-mapping-pair-strip';
import { useConnectionsQuery } from '../../features/connections/hooks/use-connections-query';
import type { Connection } from '../../features/connections/api/connections.types';
import { LoadingState, ErrorState, EmptyState } from '../../shared/ui/feedback-state';
import { DesktopOnlyBanner } from '../../shared/ui/desktop-only-banner';
import { Alert } from '../../shared/ui/alert';
import { Button } from '../../shared/ui/button';
import { Chip } from '../../shared/ui/chip';
import { Input } from '../../shared/ui/input';
import { SegmentedControl } from '../../shared/ui/segmented-control';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog';
import { usePlatforms } from '../../shared/plugins';
import { interpolate, useMessages, usePlural } from '../../shared/i18n';
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

type TreeView = 'all' | 'unmapped';

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
  const plural = usePlural();
  const platforms = usePlatforms();
  const { connectionId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [isReassignOpen, setIsReassignOpen] = useState(false);
  const [treeFilter, setTreeFilter] = useState('');
  const [treeView, setTreeView] = useState<TreeView>('all');

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
      <PageLayout backTo={backTo} title={pageTitle}>
        <LoadingState liveRegion="off" title={copy.loadingTitle} message={copy.loadingMessage} />
      </PageLayout>
    );
  }

  if (loadError) {
    return (
      <PageLayout backTo={backTo} title={pageTitle}>
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
      <PageLayout backTo={backTo} title={pageTitle}>
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
      <PageLayout backTo={backTo} title={pageTitle}>
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
      <PageLayout backTo={backTo} title={pageTitle}>
        <EmptyState
          title={copy.noCategoriesTitle}
          message={interpolate(copy.noCategoriesMessage, { connection: master.name, platform: masterPlatform })}
        />
      </PageLayout>
    );
  }

  const reassignResult = reassignMutation.data;
  const unmappedCount = categories.length - mappedCount;
  const selectedCategory = categories.find((c) => c.id === selectedCategoryId);
  const selectedAncestors = selectedCategory ? ancestorNames(categories, selectedCategory) : [];
  const treeLabel = interpolate(copy.sourceColumn, { platform: masterPlatform });

  return (
    <PageLayout
      backTo={backTo}
      title={pageTitle}
      description={interpolate(copy.intro, { platform: masterPlatform })}
      actions={
        marketplace ? (
          <MappingProgress mapped={mappedCount} total={categories.length} label={copy.progressLabel} />
        ) : undefined
      }
    >
      <DesktopOnlyBanner title={copy.desktopTitle}>{copy.desktopBody}</DesktopOnlyBanner>

      <CategoryMappingPairStrip
        catalogue={master}
        cataloguePlatform={masterPlatform}
        marketplaces={marketplaceConnections}
        marketplaceConnectionId={marketplaceConnectionId}
        onMarketplaceChange={handleMarketplaceChange}
      />

      {marketplace && legacyMappings.length > 0 ? (
        <Alert
          tone="warning"
          density="compact"
          className="category-mappings-notice"
          data-testid="category-mappings-legacy-notice"
          title={plural(legacyMappings.length, copy.legacyTitle)}
          action={
            <Button
              tone="secondary"
              className="button--sm"
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
          density="compact"
          className="category-mappings-notice"
          data-testid="category-mappings-legacy-moved"
          title={plural(reassignResult.moved, copy.legacyMovedTitle, {
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
        <Alert tone="error" density="compact" className="category-mappings-notice" title={copy.legacyFailedTitle}>
          {reassignMutation.error.message}
        </Alert>
      ) : null}

      <section className="category-mappings-workspace" aria-label={pageTitle}>
        <div className="category-mappings-workspace__source">
          <div className="category-mappings-pane-head">
            <h3 className="category-mappings-pane-head__title">{treeLabel}</h3>
            <SegmentedControl<TreeView>
              aria-label={copy.viewLabel}
              className="category-mappings-pane-head__view"
              value={treeView}
              onChange={setTreeView}
              options={[
                { value: 'all', label: copy.viewAll, hint: String(categories.length) },
                { value: 'unmapped', label: copy.viewUnmapped, hint: String(unmappedCount) },
              ]}
            />
          </div>
          <Input
            type="search"
            className="category-mappings-workspace__filter"
            value={treeFilter}
            onChange={(e) => { setTreeFilter(e.target.value); }}
            placeholder={copy.filterPlaceholder}
            aria-label={copy.filterPlaceholder}
            data-testid="category-mappings-filter"
          />
          <div className="category-mappings-workspace__scroll">
            <CategoryMappingTree
              categories={categories}
              mappings={mappings}
              selectedCategoryId={selectedCategoryId}
              onSelect={setSelectedCategoryId}
              label={treeLabel}
              filter={treeFilter}
              unmappedOnly={treeView === 'unmapped'}
            />
          </div>
        </div>

        <div className="category-mappings-workspace__target">
          {!marketplace ? (
            <div className="category-mappings-guide">
              <p className="category-mappings-guide__title">{copy.selectMarketplaceTitle}</p>
              <p className="category-mappings-guide__body">{copy.selectMarketplaceMessage}</p>
            </div>
          ) : mappingsQuery.error ? (
            <ErrorState title={copy.errorTitle} message={mappingsQuery.error.message} />
          ) : !selectedCategory ? (
            <div className="category-mappings-guide">
              <p className="category-mappings-guide__title">{copy.selectCategoryTitle}</p>
              <p className="category-mappings-guide__body">
                {interpolate(copy.selectCategoryMessage, {
                  platform: masterPlatform,
                  marketplace: marketplace.name,
                })}
              </p>
            </div>
          ) : (
            <>
              <div className="category-mappings-pane-head category-mappings-pane-head--detail">
                <div className="category-mappings-detail">
                  {selectedAncestors.length > 0 ? (
                    <p className="category-mappings-detail__path">{selectedAncestors.join(' / ')}</p>
                  ) : null}
                  <h3 className="category-mappings-detail__title">{selectedCategory.name}</h3>
                </div>
              </div>
              <AllegroCategorySearch
                key={`${marketplaceConnectionId}:${selectedCategory.id}`}
                marketplaceConnectionId={marketplaceConnectionId}
                currentMapping={selectedMapping}
                onSelect={handleAllegroSelect}
                onClear={handleClear}
                isSaving={upsertMutation.isPending || deleteMutation.isPending}
              />
            </>
          )}
        </div>
      </section>

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
                    <span className="category-mappings-legacy-list__source">{categoryName(m.prestashopCategoryId)}</span>
                    <span className="category-mappings-legacy-list__arrow" aria-hidden="true">→</span>
                    <span>{m.allegroCategoryName}</span>
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

/** Names of a category's ancestors, root first. */
function ancestorNames(
  categories: readonly { id: string; name: string; parentId: string | null }[],
  category: { parentId: string | null },
): string[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const names: string[] = [];
  let parentId = category.parentId;
  while (parentId && byId.has(parentId) && names.length < 32) {
    const parent = byId.get(parentId)!;
    names.unshift(parent.name);
    parentId = parent.parentId;
  }
  return names;
}

interface MappingProgressProps {
  mapped: number;
  total: number;
  label: string;
}

/** How much of the catalogue has a home on the selected marketplace. */
function MappingProgress({ mapped, total, label }: MappingProgressProps): ReactElement {
  const percent = total === 0 ? 0 : Math.round((mapped / total) * 100);
  const valueText = interpolate(label, { mapped, total });
  return (
    <div className="category-mappings-progress" data-testid="category-mappings-progress">
      <span className="category-mappings-progress__text">{valueText}</span>
      <span
        className="category-mappings-progress__bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={mapped}
        aria-valuetext={valueText}
      >
        <span className="category-mappings-progress__fill" style={{ width: `${percent}%` }} />
      </span>
    </div>
  );
}
