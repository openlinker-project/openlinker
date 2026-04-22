import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CategoryPicker } from './CategoryPicker';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { AllegroCategory } from '../../mappings/api/mappings.types';

function mockCategoriesEndpoint(
  byParent: Record<string, AllegroCategory[]>,
): (connectionId: string, parentId?: string) => Promise<AllegroCategory[]> {
  return async (_connectionId, parentId) => {
    const key = parentId ?? 'root';
    return byParent[key] ?? [];
  };
}

const connectionId = 'conn-1';

describe('CategoryPicker', () => {
  afterEach(cleanup);

  it('renders the root list on mount', async () => {
    const apiClient = createMockApiClient({
      mappings: {
        getAllegroCategories: vi.fn(
          mockCategoriesEndpoint({
            root: [
              { id: 'cat-1', name: 'Electronics', parentId: null, leaf: false },
              { id: 'cat-2', name: 'Books', parentId: null, leaf: true },
            ],
          }),
        ),
      },
    });

    renderWithProviders(
      <CategoryPicker connectionId={connectionId} value={null} onChange={vi.fn()} />,
      { apiClient },
    );

    expect(await screen.findByText('Electronics')).toBeInTheDocument();
    expect(screen.getByText('Books')).toBeInTheDocument();
  });

  it('drills into a non-leaf and updates the breadcrumb', async () => {
    const apiClient = createMockApiClient({
      mappings: {
        getAllegroCategories: vi.fn(
          mockCategoriesEndpoint({
            root: [{ id: 'cat-electronics', name: 'Electronics', parentId: null, leaf: false }],
            'cat-electronics': [
              { id: 'cat-phones', name: 'Phones', parentId: 'cat-electronics', leaf: true },
            ],
          }),
        ),
      },
    });

    renderWithProviders(
      <CategoryPicker connectionId={connectionId} value={null} onChange={vi.fn()} />,
      { apiClient },
    );

    fireEvent.click(
      await screen.findByRole('button', { name: /browse into electronics/i }),
    );

    // Breadcrumb now includes Electronics; children list contains Phones.
    await screen.findByText('Phones');
    expect(screen.getByRole('button', { name: 'Root' })).toBeEnabled();
    // Electronics crumb is present but the *current* level's crumb is disabled (you can't
    // navigate to where you already are).
    expect(screen.getByRole('button', { name: 'Electronics' })).toBeDisabled();
  });

  it('calls onChange when a leaf is selected', async () => {
    const apiClient = createMockApiClient({
      mappings: {
        getAllegroCategories: vi.fn(
          mockCategoriesEndpoint({
            root: [{ id: 'cat-books', name: 'Books', parentId: null, leaf: true }],
          }),
        ),
      },
    });
    const onChange = vi.fn();

    renderWithProviders(
      <CategoryPicker connectionId={connectionId} value={null} onChange={onChange} />,
      { apiClient },
    );

    fireEvent.click(await screen.findByRole('button', { name: /^select$/i }));

    expect(onChange).toHaveBeenCalledWith('cat-books');
  });

  it('jumps back when a breadcrumb crumb is clicked', async () => {
    const apiClient = createMockApiClient({
      mappings: {
        getAllegroCategories: vi.fn(
          mockCategoriesEndpoint({
            root: [{ id: 'cat-electronics', name: 'Electronics', parentId: null, leaf: false }],
            'cat-electronics': [
              { id: 'cat-phones', name: 'Phones', parentId: 'cat-electronics', leaf: true },
            ],
          }),
        ),
      },
    });

    renderWithProviders(
      <CategoryPicker connectionId={connectionId} value={null} onChange={vi.fn()} />,
      { apiClient },
    );

    fireEvent.click(
      await screen.findByRole('button', { name: /browse into electronics/i }),
    );
    await screen.findByText('Phones');

    fireEvent.click(screen.getByRole('button', { name: 'Root' }));
    // Wait for the re-fetch at root level to render Electronics again.
    await screen.findByRole('button', { name: /browse into electronics/i });
    expect(screen.queryByText('Phones')).not.toBeInTheDocument();
  });

  it('renders an error state with a Retry button on query failure', async () => {
    const apiClient = createMockApiClient({
      mappings: {
        getAllegroCategories: vi.fn().mockRejectedValue(new Error('API exploded')),
      },
    });

    renderWithProviders(
      <CategoryPicker connectionId={connectionId} value={null} onChange={vi.fn()} />,
      { apiClient },
    );

    expect(await screen.findByText('Unable to load categories')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('shows the pre-fill fallback row when opened with a non-null value', async () => {
    const apiClient = createMockApiClient({
      mappings: {
        getAllegroCategories: vi.fn(
          mockCategoriesEndpoint({
            root: [{ id: 'cat-1', name: 'Electronics', parentId: null, leaf: false }],
          }),
        ),
      },
    });

    renderWithProviders(
      <CategoryPicker
        connectionId={connectionId}
        value="cat-prefilled-999"
        onChange={vi.fn()}
      />,
      { apiClient },
    );

    // Shows the raw id, not the browser.
    expect(await screen.findByText('cat-prefilled-999')).toBeInTheDocument();
    expect(screen.queryByText('Electronics')).not.toBeInTheDocument();

    // Clicking Change reveals the browser.
    fireEvent.click(screen.getByRole('button', { name: /change/i }));
    await screen.findByText('Electronics');
  });

  it('lets the operator re-pick a different leaf after clicking Change on a pre-filled value', async () => {
    const apiClient = createMockApiClient({
      mappings: {
        getAllegroCategories: vi.fn(
          mockCategoriesEndpoint({
            root: [{ id: 'cat-new', name: 'Books', parentId: null, leaf: true }],
          }),
        ),
      },
    });
    const onChange = vi.fn();

    renderWithProviders(
      <CategoryPicker
        connectionId={connectionId}
        value="cat-prefilled-999"
        onChange={onChange}
      />,
      { apiClient },
    );

    fireEvent.click(await screen.findByRole('button', { name: /change/i }));
    // Browser reveals; the new leaf is available.
    fireEvent.click(await screen.findByRole('button', { name: /^select$/i }));

    // Controlled component: onChange fires with the new id. The "Selected"
    // state only renders when the parent re-renders with the new value, which
    // this test doesn't simulate — the contract we verify is the callback
    // firing. The wizard test covers the parent-controlled round-trip.
    expect(onChange).toHaveBeenCalledWith('cat-new');
  });

  it('disables all interactive elements when `disabled` is true', async () => {
    const apiClient = createMockApiClient({
      mappings: {
        getAllegroCategories: vi.fn(
          mockCategoriesEndpoint({
            root: [
              { id: 'cat-1', name: 'Electronics', parentId: null, leaf: false },
              { id: 'cat-2', name: 'Books', parentId: null, leaf: true },
            ],
          }),
        ),
      },
    });

    renderWithProviders(
      <CategoryPicker
        connectionId={connectionId}
        value={null}
        onChange={vi.fn()}
        disabled
      />,
      { apiClient },
    );

    await screen.findByText('Electronics');
    // Non-leaf browse button
    expect(screen.getByRole('button', { name: /browse into electronics/i })).toBeDisabled();
    // Leaf select button
    expect(screen.getByRole('button', { name: /^select$/i })).toBeDisabled();
    // Root crumb is always disabled when at root (nothing to navigate back to),
    // so that alone doesn't prove `disabled` plumbing — cover it via the
    // leaf button instead.
  });

  it('forwards aria-labelledby, aria-describedby, and aria-invalid to the root group', async () => {
    const apiClient = createMockApiClient({
      mappings: {
        getAllegroCategories: vi.fn(
          mockCategoriesEndpoint({
            root: [{ id: 'cat-1', name: 'Electronics', parentId: null, leaf: false }],
          }),
        ),
      },
    });

    const { container } = renderWithProviders(
      <CategoryPicker
        connectionId={connectionId}
        value={null}
        onChange={vi.fn()}
        invalid
        aria-labelledby="external-label"
        aria-describedby="external-description"
      />,
      { apiClient },
    );

    await screen.findByText('Electronics');
    // In the non-prefill (browser) path, the root is the shared
    // CategoryTreeBrowser primitive — ARIA wiring is forwarded to it.
    const root = container.querySelector('.category-tree-browser');
    expect(root).toHaveAttribute('role', 'group');
    expect(root).toHaveAttribute('aria-labelledby', 'external-label');
    expect(root).toHaveAttribute('aria-describedby', 'external-description');
    expect(root).toHaveAttribute('aria-invalid', 'true');
  });
});
