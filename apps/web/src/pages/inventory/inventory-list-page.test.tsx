import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../test/test-utils';
import { InventoryListPage } from './inventory-list-page';
import type { PaginatedInventory } from '../../features/inventory/api/inventory.types';

const sampleInventory: PaginatedInventory = {
  items: [
    {
      id: 'ol_inv_abc123',
      productId: 'ol_product_abc123',
      productVariantId: 'ol_variant_xyz',
      availableQuantity: 10,
      reservedQuantity: 2,
      locationId: null,
      updatedAt: '2026-01-15T10:00:00.000Z',
      productName: 'Test Product',
      productSku: 'SKU-001',
      productImageUrl: 'https://cdn.example.com/test-product.jpg',
    },
    {
      id: 'ol_inv_def456',
      productId: 'ol_product_def456',
      productVariantId: null,
      availableQuantity: 4,
      reservedQuantity: 0,
      locationId: null,
      updatedAt: '2026-02-01T10:00:00.000Z',
      productName: 'Unimaged Item',
      productSku: 'SKU-NO-IMG',
      productImageUrl: null,
    },
  ],
  total: 2,
  limit: 20,
  offset: 0,
};

describe('InventoryListPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
  });

  it('should show loading state initially', () => {
    const mockApi = createMockApiClient({
      inventory: { list: vi.fn().mockReturnValue(new Promise(() => {})) },
    });

    renderWithProviders(<InventoryListPage />, { apiClient: mockApi });

    expect(screen.getByRole('status', { name: 'Loading table data' })).toBeInTheDocument();
  });

  it('should show inventory table when data loads', async () => {
    const mockApi = createMockApiClient({
      inventory: { list: vi.fn().mockResolvedValue(sampleInventory) },
    });

    renderWithProviders(<InventoryListPage />, { apiClient: mockApi });

    expect(await screen.findByText('Test Product')).toBeInTheDocument();
    expect(screen.getByText('SKU-001')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('should show error state when fetch fails', async () => {
    const mockApi = createMockApiClient({
      inventory: { list: vi.fn().mockRejectedValue(new Error('Network error')) },
    });

    renderWithProviders(<InventoryListPage />, { apiClient: mockApi });

    expect(await screen.findByText('Unable to load inventory')).toBeInTheDocument();
    expect(screen.getByText('Network error')).toBeInTheDocument();
  });

  it('should render a small thumbnail image when productImageUrl is provided', async () => {
    const mockApi = createMockApiClient({
      inventory: { list: vi.fn().mockResolvedValue(sampleInventory) },
    });

    const { container } = renderWithProviders(<InventoryListPage />, { apiClient: mockApi });

    await within(container).findByText('Test Product');
    const image = container.querySelector<HTMLImageElement>(
      'img[src="https://cdn.example.com/test-product.jpg"]',
    );
    expect(image).not.toBeNull();
    expect(container.querySelector('.product-thumbnail--sm')).not.toBeNull();
  });

  it('should render a placeholder thumbnail when productImageUrl is null', async () => {
    const mockApi = createMockApiClient({
      inventory: { list: vi.fn().mockResolvedValue(sampleInventory) },
    });

    const { container } = renderWithProviders(<InventoryListPage />, { apiClient: mockApi });

    await within(container).findByText('Unimaged Item');
    const thumbnails = container.querySelectorAll('.product-thumbnail');
    const placeholderRow = Array.from(thumbnails).find(
      (el) => el.querySelector('img') === null,
    );
    expect(placeholderRow).not.toBeUndefined();
    expect(placeholderRow?.textContent).toBe('U');
  });

  it('should preserve the existing name/SKU/productId fallback text on each row', async () => {
    const mockApi = createMockApiClient({
      inventory: { list: vi.fn().mockResolvedValue(sampleInventory) },
    });

    const { container } = renderWithProviders(<InventoryListPage />, { apiClient: mockApi });

    expect(await within(container).findByText('Test Product')).toBeInTheDocument();
    expect(within(container).getByText('SKU-001')).toBeInTheDocument();
    expect(within(container).getByText('Unimaged Item')).toBeInTheDocument();
    expect(within(container).getByText('SKU-NO-IMG')).toBeInTheDocument();
  });

  it('should show empty state when no inventory items exist', async () => {
    const mockApi = createMockApiClient({
      inventory: { list: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 }) },
    });

    renderWithProviders(<InventoryListPage />, { apiClient: mockApi });

    expect(await screen.findByText('No inventory items found')).toBeInTheDocument();
  });
});
