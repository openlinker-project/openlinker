/**
 * Stock Movements Page (#3568, M7 states `global-list`, `filtered`, `empty`,
 * `attention`)
 *
 * `/inventory/movements` - every applied, refused or unconfirmed change to a
 * variant's stock plus the reservations that only promise it. Read-only (no
 * export: there is no export format yet). Filters live in the URL; the total is
 * a second stage and is never rendered as `0` while unknown.
 *
 * @module apps/web/src/pages/inventory
 */
import { useEffect, useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../shared/ui/page-layout';
import { ErrorState } from '../../shared/ui/feedback-state';
import { DataTableSkeleton } from '../../shared/ui/data-table-skeleton';
import { Alert } from '../../shared/ui/alert';
import { Button } from '../../shared/ui/button';
import { Chip } from '../../shared/ui/chip';
import { Input } from '../../shared/ui/input';
import { Select } from '../../shared/ui/select';
import { ListPagination } from '../../shared/ui/list-pagination';
import { useDebouncedValue } from '../../shared/hooks/use-debounced-value';
import { useConnectionsQuery } from '../../features/connections';
import {
  useInventoryMovementsCountQuery,
  useInventoryMovementsQuery,
} from '../../features/inventory/hooks/use-inventory-movements-query';
import { StockMovementsTable } from '../../features/inventory/components/stock-movements-table';
import {
  MOVEMENT_TYPE_FILTER_LABEL,
  MOVEMENT_TYPE_FILTER_VALUES,
  movementNeedsAttention,
} from '../../features/inventory/lib/stock-movement-copy';
import {
  hasActiveMovementFilters,
  readMovementUrlState,
  toMovementFilters,
  type MovementChip,
} from '../../features/inventory/lib/stock-movement-url-filters';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

export function InventoryMovementsPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const state = readMovementUrlState(searchParams);
  const filters = toMovementFilters(state);

  const connectionsQuery = useConnectionsQuery();
  const connections = connectionsQuery.data ?? [];
  const connectionNames = new Map(connections.map((c) => [c.id, c.name]));

  const update = (patch: Record<string, string | null>, keepOffset = false): void => {
    const next = new URLSearchParams(searchParams);
    Object.entries(patch).forEach(([key, value]) => {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    });
    if (!keepOffset) next.delete('offset');
    setSearchParams(next, { replace: true });
  };

  // The search input is local so typing is instant; only the settled value
  // reaches the URL (and therefore the request).
  const [searchInput, setSearchInput] = useState(state.search);
  const debouncedSearch = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS);
  useEffect(() => {
    if (debouncedSearch !== state.search) update({ search: debouncedSearch });
  }, [debouncedSearch]);
  useEffect(() => {
    setSearchInput(state.search);
  }, [state.search]);

  const query = useInventoryMovementsQuery(filters, { limit: PAGE_SIZE, offset: state.offset });
  const totalStage = useInventoryMovementsCountQuery(filters, query.data);
  const rows = query.data?.items ?? [];
  const active = hasActiveMovementFilters(state);

  const clearFilters = (): void => {
    setSearchInput('');
    setSearchParams(new URLSearchParams(), { replace: true });
  };

  const selectChip = (chip: MovementChip): void =>
    update({ chip: chip === 'all' ? null : chip, type: null });

  const refused = rows.filter((r) => movementNeedsAttention(r) && r.status === 'refused').length;
  const inDoubt = rows.filter((r) => r.status === 'in_doubt' && r.kind === 'movement').length;
  const attentionTotal = totalStage.total ?? refused + inDoubt;
  const partial = totalStage.total !== null && totalStage.total > rows.length;

  return (
    <PageLayout
      eyebrow="Products"
      title="Stock movement history"
      description="Every applied, refused, or unconfirmed change to a variant's stock — plus the reservations that only promise it."
    >
      <div className="toolbar stock-movements-toolbar">
        <div className="toolbar__group">
          <Input
            type="search"
            className="stock-movements-search"
            placeholder="Search SKU or variant name"
            aria-label="Search SKU or variant name"
            data-testid="stock-movements-search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
          <label className="stock-movements-field">
            Type
            <Select
              aria-label="Filter by type"
              data-testid="stock-movements-filter-type"
              value={state.type}
              onChange={(event) => update({ type: event.target.value, chip: null })}
            >
              <option value="">All types</option>
              {MOVEMENT_TYPE_FILTER_VALUES.map((value) => (
                <option key={value} value={value}>
                  {MOVEMENT_TYPE_FILTER_LABEL[value]}
                </option>
              ))}
            </Select>
          </label>
          <label className="stock-movements-field">
            Master connection
            <Select
              aria-label="Filter by master connection"
              data-testid="stock-movements-filter-master"
              value={state.master}
              onChange={(event) => update({ master: event.target.value })}
            >
              <option value="">All connections</option>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="stock-movements-field">
            From
            <Input
              type="date"
              aria-label="Date from"
              data-testid="stock-movements-filter-from"
              value={state.from}
              onChange={(event) => update({ from: event.target.value })}
            />
          </label>
          <label className="stock-movements-field">
            To
            <Input
              type="date"
              aria-label="Date to"
              data-testid="stock-movements-filter-to"
              value={state.to}
              onChange={(event) => update({ to: event.target.value })}
            />
          </label>
        </div>
      </div>

      <div className="toolbar page-summary" style={{ margin: 'var(--space-3) 0' }}>
        <div className="toolbar__group">
          <Chip active={state.chip === 'all'} data-testid="stock-movements-chip-all" onClick={() => selectChip('all')}>
            All
          </Chip>
          <Chip
            tone="warning"
            active={state.chip === 'attention'}
            data-testid="stock-movements-chip-attention"
            onClick={() => selectChip('attention')}
          >
            Needs attention
          </Chip>
          <Chip
            tone="review"
            active={state.chip === 'promised'}
            data-testid="stock-movements-chip-promised"
            onClick={() => selectChip('promised')}
          >
            Promised only
          </Chip>
        </div>
      </div>

      {state.productVariantId !== '' ? (
        <p className="stock-movements-summary-line">
          Showing one variant only.{' '}
          <Button tone="ghost" onClick={() => update({ productVariantId: null })}>
            Show all variants
          </Button>
        </p>
      ) : null}

      {query.isLoading ? (
        <DataTableSkeleton columns={7} rows={6} />
      ) : query.error ? (
        <ErrorState
          title="Unable to load stock movements"
          message={query.error.message}
          action={
            <Button
              onClick={() => {
                void query.refetch();
              }}
            >
              Retry
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        <div className="empty-state" data-testid="stock-movements-empty">
          <h2>{active ? 'No stock movements match these filters' : 'No stock movements yet'}</h2>
          <p>
            {active
              ? 'Try widening the date range or clearing a filter.'
              : 'Movements appear here once stock changes in a master connection or OpenLinker adjusts it.'}
          </p>
          {active ? (
            <Button tone="secondary" data-testid="stock-movements-clear-filters" onClick={clearFilters}>
              Clear filters
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          {state.chip === 'attention' ? (
            <Alert
              tone="warning"
              title={`${attentionTotal} movement${attentionTotal === 1 ? '' : 's'} need${attentionTotal === 1 ? 's' : ''} a look`}
              data-testid="stock-movements-attention-alert"
            >
              {[
                refused > 0 ? `${refused} refused by the master` : null,
                inDoubt > 0 ? `${inDoubt} unconfirmed` : null,
              ]
                .filter(Boolean)
                .join(' and ')}
              {partial ? ' on this page' : ''}. The totals may not reflect these changes yet.
            </Alert>
          ) : null}
          <p className="stock-movements-summary-line" data-testid="stock-movements-count">
            {totalStage.total !== null
              ? `${totalStage.total} result${totalStage.total === 1 ? '' : 's'}`
              : `${rows.length}+ results`}
          </p>
          <StockMovementsTable
            rows={rows}
            connectionNames={connectionNames}
            layout="global"
            caption="Stock movements"
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
    </PageLayout>
  );
}
