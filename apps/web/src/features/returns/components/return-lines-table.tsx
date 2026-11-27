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
import { useMemo, type ReactElement, type ReactNode } from 'react';
import { DataTable, type DataTableColumn } from '../../../shared/ui/data-table';
import { KeyValueList } from '../../../shared/ui/key-value-list';
import { interpolate, useMessages } from '../../../shared/i18n';
import { describeLineQuantity } from '../lib/return-detail-text';
import { ReturnLineStateChip } from './return-line-state-chips';
import type { ReturnLine } from '../api/returns.types';

interface ReturnLinesTableProps {
  /** The source's display name, for the money rail's `refunded` attribution. */
  sourceName?: string | null;
  lines: ReturnLine[];
  /**
   * The inline custody flow for one line (#2380), rendered in the table's own
   * expansion panel.
   *
   * Optional so the table stays usable as a pure read — an operator without
   * write access, and any surface that only reports what came back, renders the
   * same table with no expander at all rather than an expander onto disabled
   * controls.
   */
  renderCustody?: (line: ReturnLine) => ReactNode;
}

/** The item's own identity, name-first with SKU beneath. */
function LineItemCell({ line }: { line: ReturnLine }): ReactElement {
  const copy = useMessages('returns').detail.lines;
  return (
    <span className="returns-line-item">
      <span>{line.name ?? copy.unnamedItem}</span>
      {line.sku !== null ? <span className="mono-text text-muted">{line.sku}</span> : null}
      <span className="text-muted returns-line-item__reason">
        {copy.orderLineLabel}: <OrderLineCell line={line} />
      </span>
      {line.reason !== '' ? (
        <span className="text-muted returns-line-item__reason">
          {copy.reasonLabel}: {line.reason}
        </span>
      ) : null}
    </span>
  );
}

function OrderLineCell({ line }: { line: ReturnLine }): ReactElement {
  const copy = useMessages('returns').detail.lines;
  if (line.resolvedOrderLineId === null) {
    return (
      <span className="text-muted" title={copy.unmatchedLineHint}>
        {copy.unmatchedLine}
      </span>
    );
  }

  return <span className="mono-text">{line.resolvedOrderLineId}</span>;
}

export function ReturnLinesTable({
  lines,
  sourceName = null,
  renderCustody,
}: ReturnLinesTableProps): ReactElement {
  const copy = useMessages('returns').detail.lines;
  const columns = useMemo<DataTableColumn<ReturnLine>[]>(
    () => [
      {
        id: 'item',
        header: copy.itemLabel,
        cell: (line) => <LineItemCell line={line} />,
      },
      // Advised alone (#2380): "received" lives in the goods cell beside the state.
      {
        id: 'quantity',
        header: copy.quantityLabel,
        cell: (line) => <span className="tabular">{line.quantityAdvised}</span>,
      },
      // The custody rail and what the counters say about it, in one cell, the way
      // the mockup reads: a chip, and under it only the numbers that exist.
      {
        id: 'custody',
        header: copy.custodyLabel,
        cell: (line) => (
          <span className="returns-line-goods">
            <ReturnLineStateChip axis="custody" value={line.custodyState} />
            {line.quantityReceived > 0 ? (
              <span className="text-muted tabular returns-line-goods__counts">
                {copy.receivedLabel} {line.quantityReceived}
                {line.quantityRestocked > 0 ? ` · ${copy.restockedLabel} ${line.quantityRestocked}` : ''}
                {line.quantityScrapped > 0 ? ` · ${copy.scrappedLabel} ${line.quantityScrapped}` : ''}
              </span>
            ) : null}
          </span>
        ),
      },
      {
        id: 'money',
        header: copy.moneyLabel,
        cell: (line) => <ReturnLineStateChip axis="money" value={line.moneyState} sourceName={sourceName} />,
      },
    ],
    [copy, sourceName, renderCustody],
  );

  return (
    <DataTable
      caption={copy.tableCaption}
      columns={columns}
      rows={lines}
      rowKey={(line) => line.id}
      expandable={
        renderCustody === undefined
          ? undefined
          : {
              renderDetail: (line) => renderCustody(line),
              toggleLabel: (line, expanded) =>
                interpolate(expanded ? copy.collapseLine : copy.expandLine, {
                  name: line.name ?? copy.unnamedItem,
                }),
            }
      }
      emptyState={<p className="text-muted">{copy.empty}</p>}
      cardView={{
        // Same renderers as the columns above, so the mobile card and the
        // desktop row cannot say different things (#2091).
        title: (line) => line.name ?? copy.unnamedItem,
        subtitle: (line) => describeLineQuantity(line.quantityAdvised, line.quantityReceived),
        // `KeyValueList`, the same primitive the peer card details use — a
        // bare `<dl>` under a class no stylesheet defines renders its terms and
        // values unseparated.
        detail: (line) => (
          <KeyValueList
            items={[
              { id: 'reason', label: copy.reasonLabel, value: line.reason },
              {
                id: 'custody',
                label: copy.custodyLabel,
                value: <ReturnLineStateChip axis="custody" value={line.custodyState} />,
              },
              {
                id: 'money',
                label: copy.moneyLabel,
                value: <ReturnLineStateChip axis="money" value={line.moneyState} sourceName={sourceName} />,
              },
              {
                id: 'orderLine',
                label: copy.orderLineLabel,
                value: <OrderLineCell line={line} />,
              },
              // Dropped rather than rendered empty: an absent note is not a
              // fact about the line worth a row of its own.
              ...(line.note !== null
                ? [{ id: 'note', label: copy.noteLabel, value: line.note }]
                : []),
            ]}
          />
        ),
      }}
    />
  );
}
