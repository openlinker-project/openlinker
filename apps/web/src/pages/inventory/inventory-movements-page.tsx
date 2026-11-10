/**
 * Stock Movements Page (#3568, M7 states `global-list`, `filtered`, `empty`,
 * `attention`)
 *
 * `/inventory/movements` - every applied, refused or unconfirmed change to a
 * variant's stock plus the reservations that set stock aside for orders. Read-only (no
 * export: there is no export format yet). Filters live in the URL; the total is
 * a second stage and is never rendered as `0` while unknown.
 *
 * @module apps/web/src/pages/inventory
 */
import { useEffect, useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AccessGate } from '../../shared/ui/access-gate';
import { PageLayout } from '../../shared/ui/page-layout';
import { AccessDeniedState, ErrorState } from '../../shared/ui/feedback-state';
import { DataTableSkeleton } from '../../shared/ui/data-table-skeleton';
import { Alert } from '../../shared/ui/alert';
import { Button } from '../../shared/ui/button';
import { interpolate, useFormat, useMessages, usePlural } from '../../shared/i18n';
import { Input } from '../../shared/ui/input';
import { StatusTabs } from '../../shared/ui/status-tabs';
import { FilterDropdown, FilterGroup } from '../../shared/ui/filter-dropdown';
import { GiftsGuide } from '../../features/gifts';
import { StockMovementPeek } from '../../features/inventory/components/stock-movement-peek';
import type { InventoryMovementRow } from '../../features/inventory/api/inventory-movements.types';
import { ListPagination } from '../../shared/ui/list-pagination';
import { useDebouncedValue } from '../../shared/hooks/use-debounced-value';
import { useConnectionsQuery } from '../../features/connections';
import {
  useInventoryMovementsCountQuery,
  useInventoryMovementsTabCount,
  useInventoryMovementsQuery,
} from '../../features/inventory/hooks/use-inventory-movements-query';
import { StockMovementsTable } from '../../features/inventory/components/stock-movements-table';
import {
  MOVEMENT_TYPE_FILTER_VALUES,
  movementNeedsAttention,
  movementTypeFilterLabel,
} from '../../features/inventory/lib/stock-movement-presentation';
import {
  hasActiveMovementFilters,
  hasMovementScope,
  readMovementUrlState,
  toMovementFilters,
  type MovementChip,
  type MovementUrlState,
} from '../../features/inventory/lib/stock-movement-url-filters';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

function usePageCopy(): { eyebrow: string; title: string; description: string } {
  const copy = useMessages('inventory').inventoryMovementsPage;
  return { eyebrow: copy.eyebrow, title: copy.title, description: copy.description };
}

function useScopeCount(state: MovementUrlState, chip: MovementChip): number | undefined {
  return useInventoryMovementsTabCount(toMovementFilters({ ...state, chip, offset: 0 }));
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
  const copy = useMessages('inventory').inventoryMovementsPage;
  const pageCopy = usePageCopy();
  const plural = usePlural();
  const format = useFormat();
  const [searchParams, setSearchParams] = useSearchParams();
  const state = readMovementUrlState(searchParams);
  const filters = toMovementFilters(state);

  const connectionsQuery = useConnectionsQuery();
  const connections = connectionsQuery.data ?? [];
  const connectionNames = new Map(connections.map((c) => [c.id, c.name]));

  // A chip, type, master or date change is a navigation the operator may want
  // to undo with Back; only free-text search (one entry per keystroke burst)
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

  const clearFilters = (): void => {
    setSearchInput('');
    // Clearing filters keeps the scope the operator arrived with.
    const next = new URLSearchParams();
    if (state.productId !== '') next.set('productId', state.productId);
    if (state.productVariantId !== '') next.set('productVariantId', state.productVariantId);
    setSearchParams(next);
  };

  const selectChip = (chip: MovementChip): void =>
    update({ chip: chip === 'all' ? null : chip, type: null });

  const refused = rows.filter((r) => movementNeedsAttention(r) && r.status === 'refused').length;
  const inDoubt = rows.filter((r) => r.status === 'in_doubt' && r.kind === 'movement').length;
  const attentionTotal = totalStage.total ?? refused + inDoubt;
  const partial = totalStage.total !== null && totalStage.total > rows.length;

  const counts = {
    all: useScopeCount(state, 'all'),
    attention: useScopeCount(state, 'attention'),
    promised: useScopeCount(state, 'promised'),
  };
  const [peekKey, setPeekKey] = useState<string | null>(null);
  const keyOf = (row: InventoryMovementRow): string => `${row.kind}:${row.id}`;
  const peekIndex = peekKey === null ? -1 : rows.findIndex((row) => keyOf(row) === peekKey);
  const peekRow = peekIndex >= 0 ? rows[peekIndex] : null;
  const navigatePeek = (step: -1 | 1): void => {
    const next = rows[peekIndex + step];
    if (next !== undefined) setPeekKey(keyOf(next));
  };

  return (
    <PageLayout {...pageCopy} actions={<GiftsGuide variant="stock" />}>
      <div className="list-statusbar">
        <StatusTabs<MovementChip>
          tabs={[
            { key: null, label: copy.chips.all, count: counts.all },
            { key: 'attention', label: copy.chips.attention, tone: 'warning', count: counts.attention },
            { key: 'promised', label: copy.chips.promised, count: counts.promised },
          ]}
          value={state.chip === 'all' ? null : state.chip}
          onChange={(next) => selectChip(next ?? 'all')}
          aria-label={copy.tabsAria}
        />
      </div>

      {(counts.attention ?? 0) > 0 && state.chip !== 'attention' ? (
        <Alert
          tone="warning"
          title={plural(counts.attention ?? 0, copy.attention.title)}
          data-testid="stock-movements-attention-banner"
          action={
            <Button tone="secondary" onClick={() => selectChip('attention')}>
              {copy.chips.attention}
            </Button>
          }
        >
          {copy.attention.bannerBody}
        </Alert>
      ) : null}

      <div className="list-toolbar stock-movements-toolbar">
        <div className="list-search">
          <span className="list-search__glyph" aria-hidden="true">
            ⌕
          </span>
          <Input
            type="search"
            placeholder={copy.search}
            aria-label={copy.search}
            data-testid="stock-movements-search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
          <span className="button__shortcut list-search__kbd" aria-hidden="true">
            /
          </span>
        </div>
        <FilterGroup aria-label={copy.filters}>
          <FilterDropdown
            label={copy.type}
            anyLabel={copy.allTypes}
            value={state.type === '' ? null : state.type}
            options={MOVEMENT_TYPE_FILTER_VALUES.map((value) => ({
              value,
              label: movementTypeFilterLabel(value),
            }))}
            onChange={(next) => update({ type: next ?? '', chip: null })}
          />
          <FilterDropdown
            label={copy.master}
            anyLabel={copy.allConnections}
            value={state.master === '' ? null : state.master}
            options={connections.map((c) => ({ value: c.id, label: c.name }))}
            onChange={(next) => update({ master: next ?? '' })}
          />
          <label className="joined-filters__field">
            {copy.from}
            <Input
              type="date"
              aria-label={copy.dateFrom}
              data-testid="stock-movements-filter-from"
              value={state.from}
              onChange={(event) => update({ from: event.target.value })}
            />
          </label>
          <label className="joined-filters__field">
            {copy.to}
            <Input
              type="date"
              aria-label={copy.dateTo}
              data-testid="stock-movements-filter-to"
              value={state.to}
              onChange={(event) => update({ to: event.target.value })}
            />
          </label>
        </FilterGroup>
        <span className="list-toolbar__spacer" />
        <span className="text-muted mono tabular list-results" data-testid="stock-movements-count" aria-live="polite">
          {totalStage.total !== null
            ? plural(totalStage.total, copy.count)
            : interpolate(copy.countAtLeast, { n: rows.length })}
        </span>
      </div>

      {state.productVariantId !== '' ? (
        <p className="stock-movements-summary-line" data-testid="stock-movements-scope-variant">
          {copy.scopeVariant}{' '}
          <Button tone="ghost" onClick={() => update({ productVariantId: null })}>
            {copy.showAllVariants}
          </Button>
        </p>
      ) : null}
      {state.productId !== '' ? (
        <p className="stock-movements-summary-line" data-testid="stock-movements-scope-product">
          {copy.scopeProduct}{' '}
          <Button tone="ghost" onClick={() => update({ productId: null })}>
            {copy.showAllProducts}
          </Button>
        </p>
      ) : null}

      {query.isLoading ? (
        <DataTableSkeleton columns={7} rows={6} />
      ) : query.error ? (
        <ErrorState
          title={copy.errorTitle}
          message={query.error.message}
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
          <p>{active ? copy.empty.filteredBody : scoped ? copy.empty.scopedBody : copy.empty.body}
          </p>
          {active ? (
            <Button tone="secondary" data-testid="stock-movements-clear-filters" onClick={clearFilters}>
              {copy.empty.clearFilters}
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          {state.chip === 'attention' ? (
            <Alert
              tone="warning"
              title={plural(attentionTotal, copy.attention.title)}
              data-testid="stock-movements-attention-alert"
            >
              {interpolate(partial ? copy.attention.onThisPage : copy.attention.body, {
                parts: format.list(
                  [
                    refused > 0 ? interpolate(copy.attention.refused, { n: refused }) : null,
                    inDoubt > 0 ? interpolate(copy.attention.inDoubt, { n: inDoubt }) : null,
                  ].filter((part): part is string => part !== null),
                ),
              })}
            </Alert>
          ) : null}
          <StockMovementsTable
            rows={rows}
            connectionNames={connectionNames}
            layout="global"
            caption={copy.caption}
            onRowClick={(row) => setPeekKey(keyOf(row))}
            activeKey={peekKey}
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
      <StockMovementPeek
        row={peekRow}
        position={peekIndex + 1}
        count={rows.length}
        connectionNames={connectionNames}
        onNavigate={navigatePeek}
        onOpenChange={(open) => {
          if (!open) setPeekKey(null);
        }}
      />
    </PageLayout>
  );
}
