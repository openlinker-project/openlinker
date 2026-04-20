import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { useTableSort } from './use-table-sort';

function Harness(): React.ReactElement {
  const { sort, setSort } = useTableSort();
  const location = useLocation();

  return (
    <div>
      <span data-testid="search">{location.search}</span>
      <span data-testid="state">{JSON.stringify(sort)}</span>
      <button
        type="button"
        onClick={() => {
          setSort([{ id: 'createdAt', desc: true }]);
        }}
      >
        set-desc
      </button>
      <button
        type="button"
        onClick={() => {
          setSort([]);
        }}
      >
        clear
      </button>
    </div>
  );
}

function renderAt(pathname: string): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <Routes>
        <Route path="*" element={<Harness />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('useTableSort', () => {
  afterEach(cleanup);

  it('starts empty when no sort param is present', () => {
    renderAt('/orders');
    expect(screen.getByTestId('state')).toHaveTextContent('[]');
  });

  it('parses ?sort=field:asc from the URL', () => {
    renderAt('/orders?sort=createdAt:asc');
    expect(screen.getByTestId('state')).toHaveTextContent('[{"id":"createdAt","desc":false}]');
  });

  it('parses ?sort=field:desc from the URL', () => {
    renderAt('/orders?sort=createdAt:desc');
    expect(screen.getByTestId('state')).toHaveTextContent('[{"id":"createdAt","desc":true}]');
  });

  it('writes the sort back to the URL when setSort is called', async () => {
    const user = userEvent.setup();
    renderAt('/orders');

    await act(async () => {
      await user.click(screen.getByText('set-desc'));
    });

    expect(screen.getByTestId('search')).toHaveTextContent('sort=createdAt%3Adesc');
  });

  it('removes the sort param when sort is cleared', async () => {
    const user = userEvent.setup();
    renderAt('/orders?sort=createdAt:asc');

    await act(async () => {
      await user.click(screen.getByText('clear'));
    });

    expect(screen.getByTestId('search').textContent).toBe('');
  });
});
