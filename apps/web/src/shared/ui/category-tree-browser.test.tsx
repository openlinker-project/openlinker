import { createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildCategoryPath,
  CategoryTreeBrowser,
  type CategoryTreeNode,
} from './category-tree-browser';

const electronics: CategoryTreeNode = {
  id: 'cat-electronics',
  name: 'Electronics',
  parentId: null,
  leaf: false,
};
const books: CategoryTreeNode = { id: 'cat-books', name: 'Books', parentId: null, leaf: true };
const phones: CategoryTreeNode = {
  id: 'cat-phones',
  name: 'Phones',
  parentId: 'cat-electronics',
  leaf: true,
};

describe('CategoryTreeBrowser', () => {
  afterEach(cleanup);

  it('renders the provided nodes at the root level', () => {
    render(
      <CategoryTreeBrowser
        nodes={[electronics, books]}
        isLoading={false}
        error={null}
        onSelect={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );

    expect(screen.getByText('Electronics')).toBeInTheDocument();
    expect(screen.getByText('Books')).toBeInTheDocument();
  });

  it('drilling a non-leaf fires onNavigate with the updated breadcrumb', () => {
    const onNavigate = vi.fn();
    render(
      <CategoryTreeBrowser
        nodes={[electronics]}
        isLoading={false}
        error={null}
        onSelect={vi.fn()}
        onNavigate={onNavigate}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /browse into electronics/i }));
    expect(onNavigate).toHaveBeenCalledWith('cat-electronics', [
      { id: 'cat-electronics', name: 'Electronics' },
    ]);
    // Breadcrumb now shows Electronics as the current level (disabled crumb)
    expect(screen.getByRole('button', { name: 'Electronics' })).toBeDisabled();
  });

  it('clicking Select on a leaf fires onSelect with node + current breadcrumb', () => {
    const onSelect = vi.fn();
    render(
      <CategoryTreeBrowser
        nodes={[books]}
        isLoading={false}
        error={null}
        onSelect={onSelect}
        onNavigate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /^select$/i }));
    // Called at root, so breadcrumb is empty.
    expect(onSelect).toHaveBeenCalledWith(books, []);
  });

  it('clicking a previous crumb truncates breadcrumb and fires onNavigate', () => {
    const onNavigate = vi.fn();
    const { rerender } = render(
      <CategoryTreeBrowser
        nodes={[electronics]}
        isLoading={false}
        error={null}
        onSelect={vi.fn()}
        onNavigate={onNavigate}
      />,
    );

    // Drill into Electronics first.
    fireEvent.click(screen.getByRole('button', { name: /browse into electronics/i }));
    onNavigate.mockClear();

    // Simulate the consumer re-rendering with the drilled-level's nodes.
    rerender(
      <CategoryTreeBrowser
        nodes={[phones]}
        isLoading={false}
        error={null}
        onSelect={vi.fn()}
        onNavigate={onNavigate}
      />,
    );

    // Click Root to jump back.
    fireEvent.click(screen.getByRole('button', { name: 'Root' }));
    expect(onNavigate).toHaveBeenCalledWith(undefined, []);
  });

  it('renders LoadingState / ErrorState (with Retry) / EmptyState based on props', () => {
    const onRetry = vi.fn();

    // Loading
    const { rerender } = render(
      <CategoryTreeBrowser
        nodes={undefined}
        isLoading={true}
        error={null}
        onSelect={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );
    expect(screen.getByText('Loading categories')).toBeInTheDocument();

    // Error with Retry
    rerender(
      <CategoryTreeBrowser
        nodes={undefined}
        isLoading={false}
        error={new Error('boom')}
        onRetry={onRetry}
        onSelect={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );
    expect(screen.getByText('Unable to load categories')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    // Empty
    rerender(
      <CategoryTreeBrowser
        nodes={[]}
        isLoading={false}
        error={null}
        onSelect={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );
    expect(screen.getByText('No subcategories')).toBeInTheDocument();
  });

  it('canSelect={() => true} makes non-leaves selectable (any-level mode)', () => {
    const onSelect = vi.fn();
    render(
      <CategoryTreeBrowser
        nodes={[electronics]}
        isLoading={false}
        error={null}
        onSelect={onSelect}
        onNavigate={vi.fn()}
        canSelect={() => true}
      />,
    );

    // Non-leaf Electronics now has both Browse and Select
    expect(screen.getByRole('button', { name: /browse into electronics/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^select$/i }));
    expect(onSelect).toHaveBeenCalledWith(electronics, []);
  });

  it('disabled propagates to all interactive controls; invalid + ARIA forward to root', () => {
    const { container } = render(
      <CategoryTreeBrowser
        nodes={[electronics, books]}
        isLoading={false}
        error={null}
        onSelect={vi.fn()}
        onNavigate={vi.fn()}
        disabled
        invalid
        aria-labelledby="external-label"
        aria-describedby="external-description"
      />,
    );

    // Root crumb is always disabled when at root (nothing to navigate back to),
    // so verify via the list buttons.
    expect(screen.getByRole('button', { name: /browse into electronics/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^select$/i })).toBeDisabled();

    const root = container.querySelector('.category-tree-browser');
    expect(root).toHaveAttribute('role', 'group');
    expect(root).toHaveAttribute('aria-labelledby', 'external-label');
    expect(root).toHaveAttribute('aria-describedby', 'external-description');
    expect(root).toHaveAttribute('aria-invalid', 'true');
    expect(root).toHaveClass('category-tree-browser--invalid');
    expect(root).toHaveClass('category-tree-browser--disabled');
  });

  it('forwards ref to the root div', () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <CategoryTreeBrowser
        ref={ref}
        nodes={[books]}
        isLoading={false}
        error={null}
        onSelect={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );

    expect(ref.current).toBeInstanceOf(HTMLDivElement);
    expect(ref.current).toHaveClass('category-tree-browser');
  });

  it('merges custom className with internal classes on the root', () => {
    const { container } = render(
      <CategoryTreeBrowser
        nodes={[books]}
        isLoading={false}
        error={null}
        onSelect={vi.fn()}
        onNavigate={vi.fn()}
        className="my-custom-class"
        density="compact"
      />,
    );

    const root = container.querySelector('.category-tree-browser');
    expect(root).toHaveClass('category-tree-browser');
    expect(root).toHaveClass('category-tree-browser--density-compact');
    expect(root).toHaveClass('my-custom-class');
  });
});

describe('buildCategoryPath', () => {
  it('joins a breadcrumb with the selected node using the default separator', () => {
    expect(
      buildCategoryPath(
        [
          { id: 'cat-electronics', name: 'Electronics' },
          { id: 'cat-audio', name: 'Audio' },
        ],
        phones,
      ),
    ).toBe('Electronics > Audio > Phones');
  });

  it('returns just the node name when the breadcrumb is empty', () => {
    expect(buildCategoryPath([], books)).toBe('Books');
  });

  it('honors a custom separator', () => {
    expect(
      buildCategoryPath([{ id: 'cat-electronics', name: 'Electronics' }], phones, ' / '),
    ).toBe('Electronics / Phones');
  });
});
