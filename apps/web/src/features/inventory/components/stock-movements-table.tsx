/**
 * StockMovementsTable (#3568)
 *
 * The one table both the product-detail "Stock history" section and the global
 * `/inventory/movements` page render, so the cell rules live in one place:
 *
 * - a reservation row is a "Reserved" row - delta "-", "Stock unchanged" and
 *   "Reserved a -> b" - because a reservation never changes the stock;
 * - a refused movement's delta is struck through and its after-quantity reads
 *   "Not applied" (nothing changed), with the adapter's own sentence beneath;
 * - an in-doubt movement's after-quantity reads "?" - OpenLinker does not know
 *   whether the write landed;
 * - an applied movement with no before-quantity created a new position, so it
 *   reads "new -> n". "?" is for in-doubt (or refused) rows only.
 *
 * @module apps/web/src/features/inventory/components
 */
import type { ReactElement, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { DataTable, type DataTableColumn } from '../../../shared/ui/data-table';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { TimeDisplay } from '../../../shared/ui/time-display';
import type { InventoryMovementRow } from '../api/inventory-movements.types';
import {
  operatorReasonText,
  presentMovementStatus,
  presentMovementType,
  presentRefusalText,
  sourceKindLabel,
} from '../lib/stock-movement-copy';

export interface StockMovementsTableProps {
  rows: readonly InventoryMovementRow[];
  /** Connection id -> name; a raw id is only shown when no name is known. */
  connectionNames: ReadonlyMap<string, string>;
  /**
   * `variant` (product detail) drops the SKU column and splits delta from
   * before/after; `global` leads with the SKU and keeps them in one cell.
   */
  layout: 'variant' | 'global';
  caption: string;
}

function connectionLabel(
  id: string | null,
  names: ReadonlyMap<string, string>,
): ReactNode {
  if (id === null) return <span className="muted-text">-</span>;
  return names.get(id) ?? id;
}

function DeltaCell({ row }: { row: InventoryMovementRow }): ReactElement {
  if (row.kind === 'reservation') return <span className="muted-text">—</span>;
  const sign = row.quantityDelta > 0 ? '+' : '';
  let tone = '';
  if (row.status === 'refused') tone = 'stock-movement__delta--void';
  else if (row.quantityDelta > 0) tone = 'stock-movement__delta--pos';
  else if (row.quantityDelta < 0) tone = 'stock-movement__delta--neg';
  return (
    <span className={`mono-text tabular ${tone}`} data-testid="stock-movement-delta">
      {sign}
      {row.quantityDelta}
    </span>
  );
}

function BeforeAfterCell({ row }: { row: InventoryMovementRow }): ReactElement {
  if (row.kind === 'reservation') {
    const promised =
      row.status === 'held' ? `Reserved 0 → ${row.quantityDelta}` : `Reserved ${row.quantityDelta} → 0`;
    return (
      <>
        <div className="muted-text" style={{ fontSize: '0.8125rem' }}>
          Stock unchanged
        </div>
        <div className="mono-text tabular stock-movement__promise-line">{promised}</div>
      </>
    );
  }
  let after: ReactElement;
  if (row.status === 'refused') {
    after = (
      <span className="muted-text" data-testid="stock-movement-after">
        Not applied
      </span>
    );
  } else if (row.status === 'in_doubt' || row.quantityAfter === null) {
    after = (
      <span className="stock-movement__unknown" data-testid="stock-movement-after">
        ?
      </span>
    );
  } else {
    after = (
      <span className="mono-text tabular" data-testid="stock-movement-after">
        {row.quantityAfter}
      </span>
    );
  }
  return (
    <>
      <span className="mono-text tabular" data-testid="stock-movement-before">
        {row.quantityBefore ??
          (row.status === 'applied' && row.quantityAfter !== null ? 'new' : '?')}
      </span>
      <span className="stock-movement__arrow" aria-hidden="true">
        {' '}
        →{' '}
      </span>
      {after}
    </>
  );
}

function TypeCell({ row }: { row: InventoryMovementRow }): ReactElement {
  const type = presentMovementType(row);
  const note = row.kind === 'movement' && row.reason === 'manual_correction' ? operatorReasonText(row) : null;
  return (
    <>
      <span className={['chip', type.chipClass].filter(Boolean).join(' ')}>{type.label}</span>
      {row.kind === 'reservation' ? (
        <StatusBadge
          tone="info"
          compact
          withDot
          className="stock-movement__promised-badge"
          data-testid="stock-movement-promised"
        >
          Reserved
        </StatusBadge>
      ) : null}
      {note ? <div className="muted-text stock-movement__reason">{note}</div> : null}
    </>
  );
}

function StatusCell({
  row,
  connectionNames,
}: {
  row: InventoryMovementRow;
  connectionNames: ReadonlyMap<string, string>;
}): ReactElement {
  const status = presentMovementStatus(row.status);
  const masterName = row.sourceConnectionId ? (connectionNames.get(row.sourceConnectionId) ?? null) : null;
  const reasonText =
    presentRefusalText(row.refusalReason, row.refusalDetail, masterName) ?? row.refusalReason;
  return (
    <>
      <StatusBadge tone={status.tone} compact withDot>
        {status.label}
      </StatusBadge>
      {reasonText ? (
        <div className="muted-text stock-movement__reason" data-testid="stock-movement-reason">
          {reasonText}
        </div>
      ) : null}
    </>
  );
}

function SourceCell({ row }: { row: InventoryMovementRow }): ReactElement {
  const kind = sourceKindLabel(row.sourceKind);
  if (kind === null) return <span className="muted-text">-</span>;
  let ref: ReactNode = null;
  if (row.sourceRef) {
    // Never the raw internal id as link text: the label is the order or
    // return number, and the id survives only in the title for support.
    if (row.sourceKind === 'order') {
      ref = (
        <Link
          className="mono-text"
          to={`/orders/${encodeURIComponent(row.sourceRef)}`}
          title={row.sourceLabel ? undefined : row.sourceRef}
        >
          {row.sourceLabel ?? 'Order'}
        </Link>
      );
    } else if (row.sourceKind === 'return') {
      ref = (
        <Link
          className="mono-text"
          to={`/returns/${encodeURIComponent(row.sourceRef)}`}
          title={row.sourceLabel ? undefined : row.sourceRef}
        >
          {row.sourceLabel ?? 'Return'}
        </Link>
      );
    } else {
      ref = <span className="mono-text">{row.sourceRef}</span>;
    }
  } else if (row.sourceKind === 'operator' && row.actorUserId !== null) {
    // Who changed the stock is the point of an audit trail; a deleted account
    // reads as unknown rather than as nobody.
    ref = <span data-testid="stock-movement-actor">{row.actorName ?? 'Unknown user'}</span>;
  }
  return (
    <>
      <div className="muted-text stock-movement__source-kind">{kind}</div>
      {ref}
    </>
  );
}

function rowClass(row: InventoryMovementRow): string | undefined {
  if (row.kind === 'reservation') return 'stock-movement-row--promised';
  if (row.status === 'refused') return 'stock-movement-row--refused';
  if (row.status === 'in_doubt') return 'stock-movement-row--in-doubt';
  return undefined;
}

export function StockMovementsTable({
  rows,
  connectionNames,
  layout,
  caption,
}: StockMovementsTableProps): ReactElement {
  const time: DataTableColumn<InventoryMovementRow> = {
    id: 'time',
    header: 'Time',
    cell: (row) => (
      <span className="mono-text tabular">
        <TimeDisplay iso={row.occurredAt} />
      </span>
    ),
  };
  const sku: DataTableColumn<InventoryMovementRow> = {
    id: 'sku',
    header: 'SKU / variant',
    cell: (row) => (
      <>
        <div>{row.productName ?? '-'}</div>
        <div className="mono-text muted-text" style={{ fontSize: '0.8125rem' }}>
          {row.sku ?? '-'}
        </div>
      </>
    ),
  };
  const type: DataTableColumn<InventoryMovementRow> = {
    id: 'type',
    header: 'Type',
    cell: (row) => <TypeCell row={row} />,
  };
  const source: DataTableColumn<InventoryMovementRow> = {
    id: 'source',
    header: 'Source',
    hideBelow: layout === 'global' ? 768 : undefined,
    cell: (row) => <SourceCell row={row} />,
  };
  const master: DataTableColumn<InventoryMovementRow> = {
    id: 'master',
    header: 'Master connection',
    hideBelow: 768,
    cell: (row) => connectionLabel(row.sourceConnectionId, connectionNames),
  };
  const status: DataTableColumn<InventoryMovementRow> = {
    id: 'status',
    header: 'Status',
    cell: (row) => <StatusCell row={row} connectionNames={connectionNames} />,
  };

  const columns: DataTableColumn<InventoryMovementRow>[] =
    layout === 'variant'
      ? [
          time,
          type,
          { id: 'delta', header: 'Δ', cell: (row) => <DeltaCell row={row} /> },
          { id: 'beforeAfter', header: 'Before → after', cell: (row) => <BeforeAfterCell row={row} /> },
          source,
          master,
          status,
        ]
      : [
          time,
          sku,
          type,
          {
            id: 'delta',
            header: 'Δ / before → after',
            cell: (row) => (
              <>
                <DeltaCell row={row} /> <BeforeAfterCell row={row} />
              </>
            ),
          },
          source,
          master,
          status,
        ];

  return (
    <DataTable
      caption={caption}
      className="stock-movements-table"
      tableTestId="stock-movements-table"
      columns={columns}
      rows={[...rows]}
      rowKey={(row) => `${row.kind}:${row.id}`}
      cardView={{
        listTestId: 'stock-movements-table',
        attributes: (row) => ({
          'data-testid': 'stock-movement-row',
          'data-movement-type': presentMovementType(row).token,
          'data-movement-status': row.status,
        }),
        title: (row) => <TypeCell row={row} />,
        subtitle: (row) => (
          <>
            <TimeDisplay iso={row.occurredAt} />
            {layout === 'global' && row.sku ? ` · ${row.sku}` : ''}
          </>
        ),
        meta: (row) => <StatusCell row={row} connectionNames={connectionNames} />,
        summary: (row) => (
          <>
            <DeltaCell row={row} /> <BeforeAfterCell row={row} />
          </>
        ),
        detail: (row) => (
          <>
            <SourceCell row={row} />
            <div className="muted-text">{connectionLabel(row.sourceConnectionId, connectionNames)}</div>
          </>
        ),
      }}
      rowClassName={rowClass}
      rowAttributes={(row) => ({
        'data-testid': 'stock-movement-row',
        'data-movement-type': presentMovementType(row).token,
        'data-movement-status': row.status,
      })}
    />
  );
}
