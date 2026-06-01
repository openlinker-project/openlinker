import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataTable } from './data-table';

interface TestRow {
  createdAt: string;
  id: string;
  name: string;
}

const ROWS: TestRow[] = [
  { id: 'row-b', name: 'Bravo', createdAt: '2026-01-02' },
  { id: 'row-a', name: 'Alpha', createdAt: '2026-01-01' },
];

function renderWithRouter(ui: React.ReactElement): ReturnType<typeof render> {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

function mockMobileViewport(): { restore: () => void } {
  const spy = vi.spyOn(window, 'matchMedia').mockImplementation(
    (query) =>
      ({
        matches: query.includes('max-width'),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
  return { restore: () => spy.mockRestore() };
}

describe('DataTable', () => {
  afterEach(cleanup);

  it('renders rows and headers', () => {
    renderWithRouter(
      <DataTable<TestRow>
        caption="Test rows"
        columns={[
          {
            id: 'name',
            header: 'Name',
            cell: (row): string => row.name,
          },
        ]}
        rowKey={(row): string => row.id}
        rows={ROWS}
      />,
    );

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Bravo')).toBeInTheDocument();
  });

  it('renders the provided empty state', () => {
    renderWithRouter(
      <DataTable<TestRow>
        columns={[{ id: 'name', header: 'Name', cell: (row): string => row.name }]}
        rowKey={(row): string => row.id}
        rows={[]}
        emptyState={<p>No rows available.</p>}
      />,
    );

    expect(screen.getByText('No rows available.')).toBeInTheDocument();
  });

  it('marks sortable columns as sortable and exposes aria-sort', () => {
    renderWithRouter(
      <DataTable<TestRow>
        columns={[
          { id: 'name', header: 'Name', cell: (row): string => row.name, sortable: true },
        ]}
        rowKey={(row): string => row.id}
        rows={ROWS}
      />,
    );

    const header = screen.getByRole('columnheader', { name: /Name/ });
    expect(header).toHaveAttribute('aria-sort', 'none');
    expect(within(header).getByRole('button', { name: /Name/ })).toBeInTheDocument();
  });

  it('toggles sort between none → ascending → descending on repeated clicks', async () => {
    const user = userEvent.setup();
    renderWithRouter(
      <DataTable<TestRow>
        columns={[
          {
            id: 'name',
            header: 'Name',
            cell: (row): string => row.name,
            accessor: (row): string => row.name,
            sortable: true,
          },
        ]}
        rowKey={(row): string => row.id}
        rows={ROWS}
      />,
    );

    const header = screen.getByRole('columnheader', { name: /Name/ });
    await user.click(within(header).getByRole('button', { name: /Name/ }));
    expect(header).toHaveAttribute('aria-sort', 'ascending');

    let bodyRows = screen.getAllByRole('row').filter((row) => row.querySelector('td'));
    expect(bodyRows[0]).toHaveTextContent('Alpha');

    await user.click(within(header).getByRole('button', { name: /Name/ }));
    expect(header).toHaveAttribute('aria-sort', 'descending');

    bodyRows = screen.getAllByRole('row').filter((row) => row.querySelector('td'));
    expect(bodyRows[0]).toHaveTextContent('Bravo');
  });

  it('links the first cell when rowHref is provided', () => {
    renderWithRouter(
      <DataTable<TestRow>
        columns={[
          { id: 'name', header: 'Name', cell: (row): string => row.name },
          { id: 'createdAt', header: 'Created', cell: (row): string => row.createdAt },
        ]}
        rowKey={(row): string => row.id}
        rows={ROWS}
        rowHref={(row): string => `/things/${row.id}`}
      />,
    );

    const link = screen.getByRole('link', { name: 'Alpha' });
    expect(link).toHaveAttribute('href', '/things/row-a');
  });

  it('emits the hideBelow class on cells and headers for the configured breakpoint', () => {
    const { container } = renderWithRouter(
      <DataTable<TestRow>
        columns={[
          { id: 'name', header: 'Name', cell: (row): string => row.name },
          { id: 'createdAt', header: 'Created', cell: (row): string => row.createdAt, hideBelow: 768 },
        ]}
        rowKey={(row): string => row.id}
        rows={ROWS}
      />,
    );

    expect(container.querySelectorAll('.data-table__cell--hide-below-768').length).toBeGreaterThan(
      0,
    );
  });

  it('navigates when the row is clicked anywhere', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route
            path="/"
            element={
              <DataTable<TestRow>
                columns={[
                  { id: 'name', header: 'Name', cell: (row): string => row.name },
                  { id: 'createdAt', header: 'Created', cell: (row): string => row.createdAt },
                ]}
                rowKey={(row): string => row.id}
                rows={ROWS}
                rowHref={(row): string => `/things/${row.id}`}
              />
            }
          />
          <Route path="/things/:id" element={<p>detail page</p>} />
        </Routes>
      </MemoryRouter>,
    );

    const nonLinkCell = screen.getByText('2026-01-02');
    await user.click(nonLinkCell);

    expect(await screen.findByText('detail page')).toBeInTheDocument();
  });

  it('does not navigate when the click originates from a button inside a cell', async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route
            path="/"
            element={
              <DataTable<TestRow>
                columns={[
                  { id: 'name', header: 'Name', cell: (row): string => row.name },
                  {
                    id: 'action',
                    header: 'Action',
                    cell: () => (
                      <button type="button" onClick={onAction}>
                        Retry
                      </button>
                    ),
                  },
                ]}
                rowKey={(row): string => row.id}
                rows={ROWS}
                rowHref={(row): string => `/things/${row.id}`}
              />
            }
          />
          <Route path="/things/:id" element={<p>detail page</p>} />
        </Routes>
      </MemoryRouter>,
    );

    const retryButtons = screen.getAllByRole('button', { name: 'Retry' });
    await user.click(retryButtons[0]);

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('detail page')).toBeNull();
  });

  it('renders a mobile card view when the viewport is ≤ 767 px and cardView is provided', () => {
    const viewport = mockMobileViewport();

    try {
      const { container } = renderWithRouter(
        <DataTable<TestRow>
          columns={[{ id: 'name', header: 'Name', cell: (row): string => row.name }]}
          rowKey={(row): string => row.id}
          rows={ROWS}
          rowHref={(row): string => `/things/${row.id}`}
          cardView={{
            title: (row): string => row.name,
            subtitle: (row): string => row.createdAt,
          }}
        />,
      );

      const cards = container.querySelectorAll('.data-table__card');
      expect(cards.length).toBe(2);
      expect(cards[0].textContent).toContain('Bravo');
      expect(container.querySelectorAll('.data-table__card-main--link').length).toBe(2);
      expect(container.querySelector('table')).toBeNull();
    } finally {
      viewport.restore();
    }
  });

  it('keeps the card meta slot outside the detail Link', () => {
    const viewport = mockMobileViewport();

    try {
      const onAction = vi.fn();
      const { container } = renderWithRouter(
        <DataTable<TestRow>
          columns={[{ id: 'name', header: 'Name', cell: (row): string => row.name }]}
          rowKey={(row): string => row.id}
          rows={ROWS}
          rowHref={(row): string => `/things/${row.id}`}
          cardView={{
            title: (row): string => row.name,
            meta: () => (
              <button type="button" onClick={onAction}>
                Retry
              </button>
            ),
          }}
        />,
      );

      const firstCard = container.querySelector('.data-table__card');
      const retryButton = within(firstCard as HTMLElement).getByRole('button', { name: 'Retry' });
      expect(retryButton.closest('a')).toBeNull();
    } finally {
      viewport.restore();
    }
  });

  it('renders the table (not cards) on desktop even when cardView is provided', () => {
    const { container } = renderWithRouter(
      <DataTable<TestRow>
        columns={[{ id: 'name', header: 'Name', cell: (row): string => row.name }]}
        rowKey={(row): string => row.id}
        rows={ROWS}
        cardView={{
          title: (row): string => row.name,
        }}
      />,
    );

    expect(container.querySelector('table')).not.toBeNull();
    expect(container.querySelector('.data-table__cards')).toBeNull();
  });

  it('calls onSortChange when the header button is clicked in controlled mode', () => {
    const onSortChange = vi.fn();
    renderWithRouter(
      <DataTable<TestRow>
        columns={[
          {
            id: 'name',
            header: 'Name',
            cell: (row): string => row.name,
            accessor: (row): string => row.name,
            sortable: true,
          },
        ]}
        rowKey={(row): string => row.id}
        rows={ROWS}
        sort={[]}
        onSortChange={onSortChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Name/ }));
    expect(onSortChange).toHaveBeenCalledTimes(1);
  });

  it('does not reorder rows in manualSorting mode (server already sorted) (#944)', () => {
    // Ascending sort state on `name`, but the table must render ROWS in the
    // given order (Bravo, Alpha) because the server owns ordering.
    renderWithRouter(
      <DataTable<TestRow>
        columns={[
          { id: 'name', header: 'Name', cell: (row): string => row.name, sortable: true },
        ]}
        rowKey={(row): string => row.id}
        rows={ROWS}
        manualSorting
        sort={[{ id: 'name', desc: false }]}
        onSortChange={vi.fn()}
      />,
    );

    const cells = screen.getAllByRole('cell').map((c) => c.textContent);
    expect(cells).toEqual(['Bravo', 'Alpha']);
    // The active column still reflects the controlled sort state in the header.
    expect(screen.getByRole('columnheader', { name: /Name/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
  });

  it('fires onSortChange for a sortable column that has no accessor (server-sorted) (#944)', () => {
    const onSortChange = vi.fn();
    renderWithRouter(
      <DataTable<TestRow>
        columns={[
          // No `accessor` — server-sorted column. Must still be clickable.
          { id: 'name', header: 'Name', cell: (row): string => row.name, sortable: true },
        ]}
        rowKey={(row): string => row.id}
        rows={ROWS}
        manualSorting
        sort={[]}
        onSortChange={onSortChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Name/ }));
    expect(onSortChange).toHaveBeenCalledTimes(1);
  });

  it('mounts a fixed-height scroll container and keeps rendered rows far below the row count when virtualize=true', () => {
    const manyRows: TestRow[] = Array.from({ length: 1000 }, (_, i) => ({
      id: `row-${i}`,
      name: `Row ${i}`,
      createdAt: '2026-01-01',
    }));

    const { container } = renderWithRouter(
      <DataTable<TestRow>
        caption="Large list"
        columns={[{ id: 'name', header: 'Name', cell: (row): string => row.name }]}
        rowKey={(row): string => row.id}
        rows={manyRows}
        virtualize
        containerHeight={360}
        estimateRowHeight={36}
      />,
    );

    const scroller = container.querySelector('.data-table__virtual-scroller');
    expect(scroller).not.toBeNull();
    expect(scroller).toHaveStyle({ height: '360px' });

    const bodyRows = container.querySelectorAll('tbody tr:not([aria-hidden="true"])');
    expect(bodyRows.length).toBeLessThan(100);
  });

  it('exposes the virtual scroller as a keyboard-accessible scrollable region', () => {
    const manyRows: TestRow[] = Array.from({ length: 50 }, (_, i) => ({
      id: `row-${i}`,
      name: `Row ${i}`,
      createdAt: '2026-01-01',
    }));

    const { container } = renderWithRouter(
      <DataTable<TestRow>
        caption="Sync jobs"
        columns={[{ id: 'name', header: 'Name', cell: (row): string => row.name }]}
        rowKey={(row): string => row.id}
        rows={manyRows}
        virtualize
      />,
    );

    const scroller = container.querySelector('.data-table__virtual-scroller');
    expect(scroller).toHaveAttribute('tabindex', '0');
    expect(scroller).toHaveAttribute('role', 'region');
    expect(scroller).toHaveAttribute('aria-label', 'Sync jobs (scrollable)');
  });

  it('skips the virtual scroller when the row set is empty', () => {
    const { container } = renderWithRouter(
      <DataTable<TestRow>
        columns={[{ id: 'name', header: 'Name', cell: (row): string => row.name }]}
        rowKey={(row): string => row.id}
        rows={[]}
        virtualize
        emptyState={<p>No rows</p>}
      />,
    );

    expect(container.querySelector('.data-table__virtual-scroller')).toBeNull();
    expect(screen.getByText('No rows')).toBeInTheDocument();
  });

  it('does not wrap the table in a scroll container when virtualize is false', () => {
    const { container } = renderWithRouter(
      <DataTable<TestRow>
        columns={[{ id: 'name', header: 'Name', cell: (row): string => row.name }]}
        rowKey={(row): string => row.id}
        rows={ROWS}
      />,
    );

    expect(container.querySelector('.data-table__virtual-scroller')).toBeNull();
  });
});
