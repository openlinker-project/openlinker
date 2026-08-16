/**
 * CategorySearchResults tests (#2075)
 *
 * The primitive's own contract, independent of its three consumers: the
 * two-empty-state split, per-surface selectability, and breadcrumb rendering.
 *
 * @module apps/web/src/shared/ui
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CategorySearchResults, type CategorySearchResultHit } from './category-search-results';

const LEAF_HIT: CategorySearchResultHit = {
  id: '258066',
  name: 'Smartfony',
  leaf: true,
  path: [
    { id: '1', name: 'Elektronika' },
    { id: '2', name: 'Telefony' },
    { id: '258066', name: 'Smartfony' },
  ],
};

const ROOT_HIT: CategorySearchResultHit = {
  id: '1',
  name: 'Elektronika',
  leaf: false,
  path: [{ id: '1', name: 'Elektronika' }],
};

function renderResults(props: Partial<React.ComponentProps<typeof CategorySearchResults>> = {}) {
  const onSelect = vi.fn();
  render(
    <CategorySearchResults
      hits={[LEAF_HIT]}
      isLoading={false}
      error={null}
      onRetry={vi.fn()}
      onSelect={onSelect}
      canSelect={() => true}
      emptyReason="no-matches"
      query="smart"
      {...props}
    />,
  );
  return { onSelect };
}

describe('CategorySearchResults', () => {
  it('should render a hit with its ancestor breadcrumb but not repeat its own name', () => {
    renderResults();

    expect(screen.getByText('Smartfony')).toBeInTheDocument();
    expect(screen.getByText(/Elektronika/)).toBeInTheDocument();
    expect(screen.getByText(/Telefony/)).toBeInTheDocument();
    // "Smartfony" is the row heading; a duplicate in the trail would read badly.
    expect(screen.getAllByText('Smartfony')).toHaveLength(1);
  });

  it('should label a root-level hit rather than rendering an empty trail', () => {
    renderResults({ hits: [ROOT_HIT] });

    expect(screen.getByText('Top level')).toBeInTheDocument();
  });

  it('should distinguish a never-synced taxonomy from an unmatched query', () => {
    const { rerender } = render(
      <CategorySearchResults
        hits={[]}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
        onSelect={vi.fn()}
        canSelect={() => true}
        emptyReason="not-synced"
        query="zzz"
      />,
    );
    expect(screen.getByText('No categories synced yet')).toBeInTheDocument();

    rerender(
      <CategorySearchResults
        hits={[]}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
        onSelect={vi.fn()}
        canSelect={() => true}
        emptyReason="no-matches"
        query="zzz"
      />,
    );
    expect(screen.getByText('No matching categories')).toBeInTheDocument();
    expect(screen.queryByText('No categories synced yet')).not.toBeInTheDocument();
  });

  it('should refuse to claim either outcome when the caller is indeterminate', () => {
    // The shop picker's browse and search read different stores, so it cannot
    // know which case an empty result is — the copy must assert neither.
    render(
      <CategorySearchResults
        hits={[]}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
        onSelect={vi.fn()}
        canSelect={() => true}
        emptyReason="indeterminate"
        query="zzz"
      />,
    );

    expect(screen.getByText('No search results')).toBeInTheDocument();
    expect(screen.getByText(/may not be searchable yet/i)).toBeInTheDocument();
    expect(screen.queryByText('No matching categories')).not.toBeInTheDocument();
    expect(screen.queryByText('No categories synced yet')).not.toBeInTheDocument();
  });

  it('should expose listId on the results list so an input can aria-control it', () => {
    renderResults({ listId: 'results-under-test' });

    expect(screen.getByRole('list')).toHaveAttribute('id', 'results-under-test');
  });

  it('should show an unselectable hit rather than hiding it', async () => {
    // The marketplace rule: a non-leaf is a real match but not a valid target.
    // Hiding it would look like the search missed it.
    renderResults({ hits: [ROOT_HIT], canSelect: (hit) => hit.leaf });

    expect(screen.getByText('Elektronika')).toBeInTheDocument();
    expect(screen.getByText('Not selectable')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Select Elektronika' })).not.toBeInTheDocument();
  });

  it('should announce the result count for assistive tech', () => {
    renderResults();

    expect(screen.getByRole('status')).toHaveTextContent('1 category found');
  });

  it('should pass the whole hit to onSelect so the caller gets its path', async () => {
    const { onSelect } = renderResults();

    await userEvent.click(screen.getByRole('button', { name: 'Select Smartfony' }));

    expect(onSelect).toHaveBeenCalledWith(LEAF_HIT);
  });

  it('should render the error state with a retry action', () => {
    const onRetry = vi.fn();
    renderResults({ error: new Error('boom'), onRetry });

    expect(screen.getByText('Unable to search categories')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});
