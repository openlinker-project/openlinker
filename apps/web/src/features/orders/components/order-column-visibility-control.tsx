/**
 * Order Column Visibility Control (#3530 recovery pass, D32)
 *
 * The `/orders` list's own "Columns" affordance — show/hide/reorder the
 * table's optional columns from the active preset, applied IMMEDIATELY (no
 * submit step: this is a live view of the table, not a request being
 * composed like the export dialog's copy of the same manager). SAVING a
 * named arrangement goes through the existing preset API unchanged
 * (`OrderColumnPresetManager`'s own create/delete/workspace-default
 * mutations); which arrangement is CURRENTLY showing is a per-viewer
 * convenience kept in `localStorage`, this repo's own documented home for
 * "a remembered tab or filter" — never data the server needs to answer for,
 * so losing it (a private window, cleared site data) just falls back to the
 * workspace default / full column set, never a broken page.
 *
 * Mobile cards are structurally unaffected: `DataTable`'s `cardView` is a
 * separate render path (`title`/`subtitle`/`meta`) that never reads the
 * `columns` array this control filters — see `data-table.tsx`'s own
 * `renderCards` branch.
 *
 * @module apps/web/src/features/orders/components
 */
import { useEffect, useState, type ReactElement } from 'react';
import { Button } from '../../../shared/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../../../shared/ui/popover';
import {
  ORDER_LIST_COLUMN_IDS,
  ORDER_LIST_COLUMN_LABELS,
  type OrderColumnPreset,
} from '../api/orders.types';
import { useWorkspaceDefaultColumnPresetQuery } from '../hooks/use-order-column-presets';
import { OrderColumnPresetManager } from './order-column-preset-manager';

const LIST_AVAILABLE_COLUMNS = ORDER_LIST_COLUMN_IDS.map((id) => ({
  id,
  label: ORDER_LIST_COLUMN_LABELS[id],
}));

/** Per-viewer only — the CURRENTLY showing column arrangement, not a preset reference. */
const VISIBLE_COLUMNS_STORAGE_KEY = 'ol.orders-list.visible-columns.v1';

function readStoredColumns(): string[] | null {
  try {
    const raw = window.localStorage.getItem(VISIBLE_COLUMNS_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((v) => typeof v === 'string') ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredColumns(columns: readonly string[]): void {
  try {
    window.localStorage.setItem(VISIBLE_COLUMNS_STORAGE_KEY, JSON.stringify(columns));
  } catch {
    // Per-viewer convenience only — a blocked/full storage just means the
    // next visit starts from the workspace default again.
  }
}

/**
 * Resolve the starting column set the FIRST time this control mounts: the
 * viewer's own remembered arrangement, else the workspace default (narrowed
 * to this vocabulary — a mixed preset may also carry export column ids),
 * else every list column in its default order.
 */
function resolveInitialColumns(workspaceDefault: OrderColumnPreset | null | undefined): string[] {
  const remembered = readStoredColumns();
  if (remembered && remembered.length > 0) return remembered;
  const known = new Set<string>(ORDER_LIST_COLUMN_IDS);
  const narrowed = (workspaceDefault?.columns ?? []).filter((id) => known.has(id));
  return narrowed.length > 0 ? narrowed : [...ORDER_LIST_COLUMN_IDS];
}

export interface OrderColumnVisibilityControlProps {
  /** The list's optional-column ids, in the order they should render — always follows `select`/`order`. */
  visibleColumnIds: readonly string[];
  onVisibleColumnIdsChange: (ids: string[]) => void;
}

export function OrderColumnVisibilityControl({
  visibleColumnIds,
  onVisibleColumnIdsChange,
}: OrderColumnVisibilityControlProps): ReactElement {
  const [open, setOpen] = useState(false);
  const workspaceDefaultQuery = useWorkspaceDefaultColumnPresetQuery();
  const [initialized, setInitialized] = useState(false);

  // Apply the remembered/workspace-default arrangement exactly ONCE, the
  // moment the workspace-default read lands — never again, or an unrelated
  // refetch would stomp the operator's own in-session toggling.
  useEffect(() => {
    if (initialized) return;
    if (workspaceDefaultQuery.isLoading) return;
    onVisibleColumnIdsChange(resolveInitialColumns(workspaceDefaultQuery.data));
    setInitialized(true);
  }, [initialized, workspaceDefaultQuery.isLoading, workspaceDefaultQuery.data, onVisibleColumnIdsChange]);

  function handleColumnsChange(next: string[]): void {
    const known = new Set<string>(ORDER_LIST_COLUMN_IDS);
    writeStoredColumns(next.filter((id) => known.has(id)));
    onVisibleColumnIdsChange(next);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button tone="ghost" className="button--sm" data-testid="orders-columns-trigger">
          Columns
        </Button>
      </PopoverTrigger>
      <PopoverContent className="tag-picker" align="end" data-testid="orders-columns-popover">
        <OrderColumnPresetManager
          availableColumns={LIST_AVAILABLE_COLUMNS}
          columns={visibleColumnIds}
          onColumnsChange={handleColumnsChange}
        />
      </PopoverContent>
    </Popover>
  );
}
