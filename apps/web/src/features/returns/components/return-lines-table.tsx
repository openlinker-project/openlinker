/**
 * Return Lines Table
 *
 * What came back, line by line, in the order the channel reported it.
 *
 * Two rules shape it.
 *
 * **`resolvedOrderLineId === null` is stated, never blank.** OpenLinker has no
 * order-lines table to point at, so a line it could not match is a real state
 * of a real parcel rather than missing data. A blank cell there reads as a bug
 * and hides the fact that the return is recorded in full anyway.
 *
 * **The quantity wording is derived from the counters and says so.** Nothing in
 * Wave 1c advances `quantityReceived`, so a line renders as *announced by the
 * channel* until something does — never as a stage OpenLinker has observed.
 *
 * Responsive treatment follows the list (#2335): the same cell renderers feed
 * `cardView` on mobile, so the two layouts cannot drift, and the two columns an
 * operator can do without drop at tablet width via `hideBelow`.
 *
 * @module apps/web/src/features/returns/components
 */
import { useMemo, type ReactElement } from 'react';
import { DataTable, type DataTableColumn } from '../../../shared/ui/data-table';
import { KeyValueList } from '../../../shared/ui/key-value-list';
import { RETURN_LINES_COPY, describeLineQuantity } from '../lib/return-detail.copy';
import { ReturnLineStateChip } from './return-line-state-chips';
import type { ReturnLine } from '../api/returns.types';

interface ReturnLinesTableProps {
  /** The source's display name, for the money rail's `refunded` attribution. */
  sourceName?: string | null;
  lines: ReturnLine[];
}

/** The item's own identity, name-first with SKU beneath. */
function LineItemCell({ line }: { line: ReturnLine }): ReactElement {
  return (
    <span className="returns-line-item">
      <span>{line.name ?? RETURN_LINES_COPY.unnamedItem}</span>
      {line.sku !== null ? <span className="mono-text text-muted">{line.sku}</span> : null}
    </span>
  );
}

function OrderLineCell({ line }: { line: ReturnLine }): ReactElement {
  if (line.resolvedOrderLineId === null) {
    return (
      <span className="text-muted" title={RETURN_LINES_COPY.unmatchedLineHint}>
        {RETURN_LINES_COPY.unmatchedLine}
      </span>
    );
  }

  return <span className="mono-text">{line.resolvedOrderLineId}</span>;
}

export function ReturnLinesTable({ lines, sourceName = null }: ReturnLinesTableProps): ReactElement {
  const columns = useMemo<DataTableColumn<ReturnLine>[]>(
    () => [
      {
        id: 'item',
        header: RETURN_LINES_COPY.itemLabel,
        cell: (line) => <LineItemCell line={line} />,
      },
      {
        id: 'quantity',
        header: RETURN_LINES_COPY.quantityLabel,
        cell: (line) => (
          <span className="tabular">
            {describeLineQuantity(line.quantityAdvised, line.quantityReceived)}
          </span>
        ),
      },
      {
        id: 'reason',
        header: RETURN_LINES_COPY.reasonLabel,
        cell: (line) => <span>{line.reason}</span>,
        hideBelow: 768,
      },
      {
        id: 'custody',
        header: RETURN_LINES_COPY.custodyLabel,
        cell: (line) => <ReturnLineStateChip axis="custody" value={line.custodyState} />,
        hideBelow: 1024,
      },
      {
        id: 'money',
        header: RETURN_LINES_COPY.moneyLabel,
        cell: (line) => <ReturnLineStateChip axis="money" value={line.moneyState} sourceName={sourceName} />,
        hideBelow: 1024,
      },
      {
        id: 'orderLine',
        header: RETURN_LINES_COPY.orderLineLabel,
        cell: (line) => <OrderLineCell line={line} />,
      },
    ],
    [],
  );

  return (
    <DataTable
      caption={RETURN_LINES_COPY.tableCaption}
      columns={columns}
      rows={lines}
      rowKey={(line) => line.id}
      emptyState={<p className="text-muted">{RETURN_LINES_COPY.empty}</p>}
      cardView={{
        // Same renderers as the columns above, so the mobile card and the
        // desktop row cannot say different things (#2091).
        title: (line) => line.name ?? RETURN_LINES_COPY.unnamedItem,
        subtitle: (line) => describeLineQuantity(line.quantityAdvised, line.quantityReceived),
        // `KeyValueList`, the same primitive the peer card details use — a
        // bare `<dl>` under a class no stylesheet defines renders its terms and
        // values unseparated.
        detail: (line) => (
          <KeyValueList
            items={[
              { id: 'reason', label: RETURN_LINES_COPY.reasonLabel, value: line.reason },
              {
                id: 'custody',
                label: RETURN_LINES_COPY.custodyLabel,
                value: <ReturnLineStateChip axis="custody" value={line.custodyState} />,
              },
              {
                id: 'money',
                label: RETURN_LINES_COPY.moneyLabel,
                value: <ReturnLineStateChip axis="money" value={line.moneyState} sourceName={sourceName} />,
              },
              {
                id: 'orderLine',
                label: RETURN_LINES_COPY.orderLineLabel,
                value: <OrderLineCell line={line} />,
              },
              // Dropped rather than rendered empty: an absent note is not a
              // fact about the line worth a row of its own.
              ...(line.note !== null
                ? [{ id: 'note', label: RETURN_LINES_COPY.noteLabel, value: line.note }]
                : []),
            ]}
          />
        ),
      }}
    />
  );
}
