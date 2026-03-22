import type { Key, ReactElement, ReactNode } from 'react';

export interface DataTableColumn<Row> {
  align?: 'center' | 'left' | 'right';
  cell: (row: Row) => ReactNode;
  header: ReactNode;
  id: string;
}

interface DataTableProps<Row> {
  caption?: ReactNode;
  className?: string;
  columns: DataTableColumn<Row>[];
  emptyState?: ReactNode;
  rowKey: (row: Row) => Key;
  rows: Row[];
}

export function DataTable<Row>({
  caption,
  className = '',
  columns,
  emptyState,
  rowKey,
  rows,
}: DataTableProps<Row>): ReactElement {
  return (
    <div className={['data-table__container', className].filter(Boolean).join(' ')}>
      <table className="data-table">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.id} className={column.align ? `data-table__cell--${column.align}` : undefined} scope="col">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr className="data-table__empty-row">
              <td className="data-table__empty-cell" colSpan={columns.length}>
                {emptyState ?? (
                  <div className="empty-state">
                    <h2>No records to display</h2>
                    <p>There is no data available for this table yet.</p>
                  </div>
                )}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((column) => (
                  <td key={column.id} className={column.align ? `data-table__cell--${column.align}` : undefined}>
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
