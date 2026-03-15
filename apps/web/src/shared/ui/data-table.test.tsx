import { render, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DataTable } from './data-table';

interface TestRow {
  id: string;
  name: string;
}

describe('DataTable', () => {
  it('renders rows and headers', () => {
    const view = render(
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
        rows={[{ id: 'row-1', name: 'First row' }]}
      />,
    );

    expect(within(view.container).getByRole('table')).toBeInTheDocument();
    expect(within(view.container).getByText('Name')).toBeInTheDocument();
    expect(within(view.container).getByText('First row')).toBeInTheDocument();
  });

  it('renders the provided empty state', () => {
    const view = render(
      <DataTable<TestRow>
        caption="Empty test rows"
        columns={[
          {
            id: 'name',
            header: 'Name',
            cell: (row): string => row.name,
          },
        ]}
        rowKey={(row): string => row.id}
        rows={[]}
        emptyState={<p>No rows available.</p>}
      />,
    );

    expect(within(view.container).getByRole('table')).toBeInTheDocument();
    expect(within(view.container).getByText('Name')).toBeInTheDocument();
    expect(within(view.container).getByText('No rows available.')).toBeInTheDocument();
  });
});
