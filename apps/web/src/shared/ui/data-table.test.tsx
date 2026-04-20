import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
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

  it('sorts client-side when a sortable header is activated', async () => {
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

    await user.click(screen.getByRole('button', { name: /Name/ }));

    const header = screen.getByRole('columnheader', { name: /Name/ });
    expect(header).toHaveAttribute('aria-sort', 'ascending');

    const bodyRows = screen
      .getAllByRole('row')
      .filter((row) => row.querySelector('td'));
    expect(bodyRows[0]).toHaveTextContent('Alpha');
    expect(bodyRows[1]).toHaveTextContent('Bravo');
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

  it('renders a mobile card view when the viewport is ≤ 767 px and cardView is provided', () => {
    const matchMedia = vi.spyOn(window, 'matchMedia').mockImplementation(
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
      expect(container.querySelectorAll('.data-table__card-link').length).toBe(2);
      expect(container.querySelector('table')).toBeNull();
    } finally {
      matchMedia.mockRestore();
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
});
