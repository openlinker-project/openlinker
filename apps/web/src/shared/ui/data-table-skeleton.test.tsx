import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { DataTableSkeleton } from './data-table-skeleton';
import type { DataTableColumn } from './data-table';

type Row = { id: string };

const COLUMNS: DataTableColumn<Row>[] = [
  { id: 'id', header: 'ID', cell: (row) => row.id },
  { id: 'name', header: 'Name', cell: () => '—', hideBelow: 768 },
  { id: 'status', header: 'Status', cell: () => '—', hideBelow: 1024 },
];

function selectAll(container: HTMLElement, selector: string): Element[] {
  return Array.from(container.querySelectorAll(selector));
}

describe('DataTableSkeleton', () => {
  it('should render the default 8 rows when rows is omitted', () => {
    const { container } = render(<DataTableSkeleton columns={4} />);
    const bodyRows = selectAll(container, 'tbody tr');
    expect(bodyRows).toHaveLength(8);
  });

  it('should respect a custom rows prop', () => {
    const { container } = render(<DataTableSkeleton columns={4} rows={3} />);
    const bodyRows = selectAll(container, 'tbody tr');
    expect(bodyRows).toHaveLength(3);
  });

  it('should render the given column count when columns is a number', () => {
    const { container } = render(<DataTableSkeleton columns={5} rows={2} />);
    expect(selectAll(container, 'thead th')).toHaveLength(5);
    for (const row of selectAll(container, 'tbody tr')) {
      expect(row.querySelectorAll('td')).toHaveLength(5);
    }
  });

  it('should render the same column count when columns is a DataTableColumn array', () => {
    const { container } = render(<DataTableSkeleton columns={COLUMNS} rows={2} />);
    expect(selectAll(container, 'thead th')).toHaveLength(COLUMNS.length);
    for (const row of selectAll(container, 'tbody tr')) {
      expect(row.querySelectorAll('td')).toHaveLength(COLUMNS.length);
    }
  });

  it('should apply hide-below classes to the matching cells when columns carry hideBelow', () => {
    const { container } = render(<DataTableSkeleton columns={COLUMNS} rows={1} />);
    const headers = selectAll(container, 'thead th');
    expect(headers[0].classList.contains('data-table__cell--hide-below-768')).toBe(false);
    expect(headers[1].classList.contains('data-table__cell--hide-below-768')).toBe(true);
    expect(headers[2].classList.contains('data-table__cell--hide-below-1024')).toBe(true);

    const cells = selectAll(container, 'tbody tr td');
    expect(cells[0].classList.contains('data-table__cell--hide-below-768')).toBe(false);
    expect(cells[1].classList.contains('data-table__cell--hide-below-768')).toBe(true);
    expect(cells[2].classList.contains('data-table__cell--hide-below-1024')).toBe(true);
  });

  it('should expose role=status with aria-live=polite on the outer wrapper', () => {
    const { container } = render(<DataTableSkeleton columns={2} />);
    const wrapper = container.querySelector('.data-table-skeleton');
    expect(wrapper).not.toBeNull();
    expect(wrapper?.getAttribute('role')).toBe('status');
    expect(wrapper?.getAttribute('aria-live')).toBe('polite');
    // No aria-label: the sr-only "Loading…" text carries the announcement,
    // which avoids double-reads on SRs that prefer aria-label over text content.
    expect(wrapper?.getAttribute('aria-label')).toBeNull();
  });

  it('should include a visually-hidden Loading label and hide the visual skeleton from assistive tech', () => {
    const { container } = render(<DataTableSkeleton columns={2} />);
    const label = container.querySelector('.sr-only');
    expect(label).not.toBeNull();
    expect(label?.textContent).toBe('Loading…');
    expect(container.querySelector('table')?.parentElement?.getAttribute('aria-hidden')).toBe('true');
  });

  it('should render the shimmer-bar CSS hook used by prefers-reduced-motion for every header and body cell', () => {
    const { container } = render(<DataTableSkeleton columns={3} rows={2} />);
    const bars = selectAll(container, '.data-table-skeleton__bar');
    // 3 header bars + (3 columns × 2 rows) body bars = 9
    expect(bars).toHaveLength(9);
  });
});
