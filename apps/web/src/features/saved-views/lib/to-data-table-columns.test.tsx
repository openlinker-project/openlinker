import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { testRegistry } from './saved-views.fixtures';
import { toDataTableColumns } from './to-data-table-columns';
import type { ViewHeaderContext } from './view-registry.types';

const context = (overrides: Partial<ViewHeaderContext> = {}): ViewHeaderContext => ({
  sort: { key: 'created', dir: 'desc' },
  onSort: vi.fn(),
  sortLabel: (label, active) => (active ? `${label}, sorted` : `${label}, sort`),
  ...overrides,
});

describe('toDataTableColumns', () => {
  it('should put the locked column first and follow the view order', () => {
    const columns = toDataTableColumns(testRegistry, { columns: ['total', 'customer'], parts: {} }, context());
    expect(columns.map((column) => column.id)).toEqual(['order', 'total', 'customer']);
  });

  it('should render only the visible fields of a stacked column, in order', () => {
    const [, total] = toDataTableColumns(testRegistry, { columns: ['total'], parts: { total: ['payment', 'amount'] } }, context());
    render(<>{total!.cell({ id: 1, customer: 'A', total: 9 })}</>);
    const nodes = screen.getAllByText(/Paid|9/);
    expect(nodes.map((node) => node.textContent)).toEqual(['Paid', '9']);
    expect(screen.queryByText('today')).toBeNull();
  });

  it('should build the header from the visible sortable fields only', () => {
    const [, total] = toDataTableColumns(testRegistry, { columns: ['total'], parts: { total: ['amount'] } }, context());
    render(<>{total!.header}</>);
    expect(screen.getByRole('button', { name: 'Total, sort' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Payment, sort' })).toBeNull();
  });

  it('should fall back to the column label when no sortable field is visible', () => {
    const [, total] = toDataTableColumns(testRegistry, { columns: ['total'], parts: { total: ['created'] } }, context());
    expect(total!.header).toBe('Total, payment, dates');
  });

  it('should mark the active sort on the column header', () => {
    const columns = toDataTableColumns(
      testRegistry,
      { columns: ['total', 'tags'], parts: {} },
      context({ sort: { key: 'pay', dir: 'asc' } }),
    );
    expect(columns.find((column) => column.id === 'total')!.ariaSort).toBe('ascending');
    expect(columns.find((column) => column.id === 'tags')!.ariaSort).toBeUndefined();
  });

  it('should drive sorting through the context from a single-field header', () => {
    const onSort = vi.fn();
    const columns = toDataTableColumns(testRegistry, { columns: ['tags'], parts: {} }, context({ onSort }));
    render(<>{columns[1]!.header}</>);
    screen.getByRole('button', { name: 'Tags, sort' }).click();
    expect(onSort).toHaveBeenCalledWith('tags');
  });
});
