import { screen } from '@testing-library/react';
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
    },
  ],
  total: 1,
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

    expect(screen.getByText('Loading inventory')).toBeInTheDocument();
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

  it('should show empty state when no inventory items exist', async () => {
    const mockApi = createMockApiClient({
      inventory: { list: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 }) },
    });

    renderWithProviders(<InventoryListPage />, { apiClient: mockApi });

    expect(await screen.findByText('No inventory items found')).toBeInTheDocument();
  });
});
