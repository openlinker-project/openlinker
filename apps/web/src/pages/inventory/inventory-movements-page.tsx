/**
 * Stock Movements Page (#3568, redesigned in #4061)
 *
 * `/inventory/movements` - what changed a product's stock, and why. Rows are
 * grouped by day and read as one sentence each; a sync run or an order that
 * touched several products is one line. Opening a row explains it in a side
 * panel, and a guide explains the numbers and states.
 *
 * Every filter and the selected view live in the URL. The total is a second
 * stage and is never rendered as `0` while unknown.
 *
 * @module apps/web/src/pages/inventory
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AccessGate } from '../../shared/ui/access-gate';
import { PageLayout } from '../../shared/ui/page-layout';
import { AccessDeniedState, ErrorState } from '../../shared/ui/feedback-state';
import { DataTableSkeleton } from '../../shared/ui/data-table-skeleton';
import { Button } from '../../shared/ui/button';
import { getMessages, interpolate, useFormat, useMessages, usePlural } from '../../shared/i18n';
import { Input } from '../../shared/ui/input';
import { Select } from '../../shared/ui/select';
import { SegmentedControl } from '../../shared/ui/segmented-control';
import { SidePanel } from '../../shared/ui/side-panel';
import { ListPagination } from '../../shared/ui/list-pagination';
import { useDebouncedValue } from '../../shared/hooks/use-debounced-value';
import { useConnectionsQuery } from '../../features/connections';
import {
  useInventoryMovementsCountQuery,
  useInventoryMovementsQuery,
} from '../../features/inventory/hooks/use-inventory-movements-query';
import { useMovementsNeedingAttentionQuery } from '../../features/inventory/hooks/use-movements-needing-attention-query';
import { useStockViewQuery } from '../../features/inventory/hooks/use-stock-view-query';
import { StockMovementHistory } from '../../features/inventory/components/stock-movement-history';
import { StockMovementDetailPanel } from '../../features/inventory/components/stock-movement-detail-panel';
import { StockMovementGuideDrawer } from '../../features/inventory/components/stock-movement-guide-drawer';
import { VariantStockSummary } from '../../features/inventory/components/variant-stock-summary';
import {
  MOVEMENT_TYPE_FILTER_VALUES,
  movementTypeFilterLabel,
} from '../../features/inventory/lib/stock-movement-presentation';
import {
  hasActiveMovementFilters,
  hasMovementScope,
  readMovementUrlState,
  toMovementFilters,
  type MovementChip,
} from '../../features/inventory/lib/stock-movement-url-filters';
import { describeApiError } from '../../shared/api/describe-api-error';
import type { StockGuideId, StockHistoryContext } from '../../features/inventory/lib/stock-movement-view-model';
import type { InventoryMovementRow } from '../../features/inventory/api/inventory-movements.types';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

function usePageCopy(): { eyebrow: string; title: string; description: string } {
  const copy = useMessages('inventory').inventoryMovementsPage;
  return { eyebrow: copy.eyebrow, title: copy.title, description: copy.description };
}

export function InventoryMovementsPage(): ReactElement {
  const copy = useMessages('inventory').inventoryMovementsPage;
  const pageCopy = usePageCopy();
  // The history read is inventory:read (admin, operator, viewer): a session
  // without it is told so, instead of meeting a failed request it cannot fix.
  return (
    <AccessGate
      require="inventory:read"
      fallback={
        <PageLayout {...pageCopy}>
          <AccessDeniedState title={copy.denied.title} message={copy.denied.message} />
        </PageLayout>
      }
    >
      <InventoryMovementsContent />
    </AccessGate>
  );
}

function InventoryMovementsContent(): ReactElement {
  const inventoryCopy = useMessages('inventory');
  const copy = inventoryCopy.inventoryMovementsPage;
  const history = inventoryCopy.stockHistory;
  const pageCopy = usePageCopy();
  const plural = usePlural();
  const format = useFormat();
  const [searchParams, setSearchParams] = useSearchParams();
  const state = readMovementUrlState(searchParams);
  const filters = toMovementFilters(state);

  const connectionsQuery = useConnectionsQuery();
  const connections = useMemo(() => connectionsQuery.data ?? [], [connectionsQuery.data]);

  // A view, type, shop or date change is a navigation the operator may want to
  // undo with Back; only free-text search (one entry per keystroke burst)
  // replaces the entry.
  const update = (patch: Record<string, string | null>, keepOffset = false, replace = false): void => {
    const next = new URLSearchParams(searchParams);
    Object.entries(patch).forEach(([key, value]) => {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    });
    if (!keepOffset) next.delete('offset');
    setSearchParams(next, { replace });
  };

  // The search input is local so typing is instant; only the settled value
  // reaches the URL (and therefore the request).
  const [searchInput, setSearchInput] = useState(state.search);
  const debouncedSearch = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS);
  useEffect(() => {
    if (debouncedSearch !== state.search) update({ search: debouncedSearch }, false, true);
  }, [debouncedSearch]);
  useEffect(() => {
    setSearchInput(state.search);
  }, [state.search]);

  const query = useInventoryMovementsQuery(filters, { limit: PAGE_SIZE, offset: state.offset });
  const totalStage = useInventoryMovementsCountQuery(filters, query.data);
  const rows = query.data?.items ?? [];
  const active = hasActiveMovementFilters(state);
  const scoped = hasMovementScope(state);

  // The problem line counts what needs a look in the CURRENT scope, so it is
  // asked for separately and is never inferred from the page on screen.
  const attention = useMovementsNeedingAttentionQuery(
    toMovementFilters({ ...state, chip: 'attention', type: '', offset: 0 }),
    { enabled: state.chip !== 'attention' },
  );

  const [selected, setSelected] = useState<InventoryMovementRow | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [guide, setGuide] = useState<{ open: boolean; focus: StockGuideId | null }>({ open: false, focus: null });
  const [now] = useState(() => new Date());

  const context = useMemo<StockHistoryContext>(() => {
    const names = new Map(connections.map((c) => [c.id, c.name]));
    const fallback = getMessages('inventory').stockMovement.theShop;
    return {
      copy: history,
      plural,
      masterName: (row) => (row.sourceConnectionId ? names.get(row.sourceConnectionId) : undefined) ?? fallback,
      connectionName: (connectionId) => names.get(connectionId) ?? fallback,
    };
  }, [connections, history, plural]);

  const scopedProductId = state.productId || (state.productVariantId ? (rows[0]?.productId ?? '') : '');
  const stockView = useStockViewQuery(scopedProductId, { enabled: state.productVariantId !== '' });
  const scopedVariant = stockView.data?.variants.find((v) => v.productVariantId === state.productVariantId);

  const explain = useCallback((focus: StockGuideId) => setGuide({ open: true, focus }), []);
  const formatTime = useCallback((iso: string) => format.time(iso), [format]);
  const formatDate = useCallback((iso: string) => format.date(iso), [format]);

  const clearFilters = (): void => {
    setSearchInput('');
    // Clearing filters keeps the scope the operator arrived with.
    const next = new URLSearchParams();
    if (state.productId !== '') next.set('productId', state.productId);
    if (state.productVariantId !== '') next.set('productVariantId', state.productVariantId);
    setSearchParams(next);
  };

  const selectView = (chip: MovementChip): void => update({ chip: chip === 'all' ? null : chip, type: null });
  const activeFilterCount = [state.type, state.master, state.from, state.to].filter((v) => v !== '').length;
  const problemCount = state.chip === 'attention' ? null : (attention.data?.total ?? null);

  return (
    <PageLayout
      {...pageCopy}
      actions={
        <Button tone="ghost" onClick={() => setGuide({ open: true, focus: null })} data-testid="stock-movements-help">
          {history.help}
        </Button>
      }
    >
      <div className="stock-page">
        {problemCount !== null && problemCount > 0 ? (
          <div className="stock-problems" role="status" data-testid="stock-movements-problems">
            <span>{plural(problemCount, history.problems.title)}</span>
            <Button tone="secondary" onClick={() => selectView('attention')}>
              {history.problems.review}
            </Button>
          </div>
        ) : null}

        <div className="stock-toolbar">
          <Input
            type="search"
            className="stock-toolbar__search"
            placeholder={copy.search}
            aria-label={copy.search}
            data-testid="stock-movements-search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
          <SegmentedControl<MovementChip>
            className="stock-toolbar__views"
            aria-label={history.views.label}
            value={state.chip}
            onChange={selectView}
            options={[
              { value: 'all', label: history.views.all, 'data-testid': 'stock-movements-chip-all' },
              { value: 'attention', label: history.views.attention, 'data-testid': 'stock-movements-chip-attention' },
              { value: 'stock', label: history.views.stock, 'data-testid': 'stock-movements-chip-stock' },
              { value: 'promised', label: history.views.holds, 'data-testid': 'stock-movements-chip-promised' },
            ]}
          />
          <Button
            tone={activeFilterCount > 0 ? 'secondary' : 'ghost'}
            onClick={() => setFiltersOpen(true)}
            data-testid="stock-movements-filters-button"
          >
            {activeFilterCount > 0
              ? interpolate(history.filters.buttonCount, { n: activeFilterCount })
              : history.filters.button}
          </Button>
        </div>

        {state.productVariantId !== '' ? (
          <p className="stock-scope" data-testid="stock-movements-scope-variant">
            {copy.scopeVariant}{' '}
            <Button tone="ghost" onClick={() => update({ productVariantId: null })}>
              {copy.showAllVariants}
            </Button>
          </p>
        ) : null}
        {state.productId !== '' ? (
          <p className="stock-scope" data-testid="stock-movements-scope-product">
            {copy.scopeProduct}{' '}
            <Button tone="ghost" onClick={() => update({ productId: null })}>
              {copy.showAllProducts}
            </Button>
          </p>
        ) : null}

        {scopedVariant ? <VariantStockSummary variant={scopedVariant} copy={history} onExplain={explain} /> : null}

        {query.isLoading ? (
          <DataTableSkeleton columns={4} rows={6} />
        ) : query.error ? (
          <ErrorState
            title={copy.errorTitle}
            message={describeApiError(query.error, 'inventory')}
            action={
              <Button
                onClick={() => {
                  void query.refetch();
                }}
              >
                {copy.retry}
              </Button>
            }
          />
        ) : rows.length === 0 ? (
          <div className="empty-state" data-testid="stock-movements-empty">
            <h2>
              {active
                ? copy.empty.filteredTitle
                : scoped
                  ? state.productVariantId !== ''
                    ? copy.empty.variantTitle
                    : copy.empty.productTitle
                  : copy.empty.title}
            </h2>
            <p>{active ? copy.empty.filteredBody : scoped ? copy.empty.scopedBody : copy.empty.body}</p>
            {active ? (
              <Button tone="secondary" data-testid="stock-movements-clear-filters" onClick={clearFilters}>
                {copy.empty.clearFilters}
              </Button>
            ) : null}
          </div>
        ) : (
          <>
            <p className="stock-count" data-testid="stock-movements-count">
              {totalStage.total !== null
                ? plural(totalStage.total, copy.count)
                : interpolate(copy.countAtLeast, { n: rows.length })}
            </p>
            <StockMovementHistory
              rows={rows}
              context={context}
              selectedId={selected?.id ?? null}
              onOpenRow={setSelected}
              now={now}
              formatTime={formatTime}
              formatDate={formatDate}
            />
            <ListPagination
              offset={state.offset}
              limit={PAGE_SIZE}
              rowCount={rows.length}
              total={totalStage.total}
              totalState={totalStage.state}
              showTotalLoader={totalStage.showLoader}
              onOffsetChange={(next) => update({ offset: next > 0 ? String(next) : null }, true)}
            />
          </>
        )}
      </div>

      <SidePanel
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        title={history.filters.title}
        description={history.filters.description}
        width={400}
        footer={
          <>
            <Button
              tone="ghost"
              disabled={activeFilterCount === 0}
              onClick={() => update({ type: null, master: null, from: null, to: null })}
            >
              {history.filters.clear}
            </Button>
            <Button onClick={() => setFiltersOpen(false)}>{history.filters.done}</Button>
          </>
        }
      >
        <div className="stock-filters">
          <label className="stock-filters__field">
            {history.filters.type}
            <Select
              aria-label={copy.filterType}
              data-testid="stock-movements-filter-type"
              value={state.type}
              onChange={(event) => update({ type: event.target.value, chip: null })}
            >
              <option value="">{copy.allTypes}</option>
              {MOVEMENT_TYPE_FILTER_VALUES.map((value) => (
                <option key={value} value={value}>
                  {movementTypeFilterLabel(value)}
                </option>
              ))}
            </Select>
          </label>
          <label className="stock-filters__field">
            {history.filters.shop}
            <Select
              aria-label={copy.filterMaster}
              data-testid="stock-movements-filter-master"
              value={state.master}
              onChange={(event) => update({ master: event.target.value })}
            >
              <option value="">{copy.allConnections}</option>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </label>
          <fieldset className="stock-filters__dates">
            <legend>{history.filters.dates}</legend>
            <label className="stock-filters__field">
              {copy.from}
              <Input
                type="date"
                aria-label={copy.dateFrom}
                data-testid="stock-movements-filter-from"
                value={state.from}
                onChange={(event) => update({ from: event.target.value })}
              />
            </label>
            <label className="stock-filters__field">
              {copy.to}
              <Input
                type="date"
                aria-label={copy.dateTo}
                data-testid="stock-movements-filter-to"
                value={state.to}
                onChange={(event) => update({ to: event.target.value })}
              />
            </label>
          </fieldset>
        </div>
      </SidePanel>

      <StockMovementDetailPanel
        row={selected}
        context={context}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        onExplain={explain}
        onShowVariant={
          state.productVariantId === ''
            ? (row): void => {
                setSelected(null);
                update({ productVariantId: row.productVariantId });
              }
            : undefined
        }
        formatTime={formatTime}
        formatDateTime={(iso): string => format.dateTime(iso)}
      />
      <StockMovementGuideDrawer
        open={guide.open}
        focusId={guide.focus}
        copy={history}
        onOpenChange={(open) => setGuide((prev) => ({ ...prev, open }))}
      />
    </PageLayout>
  );
}
