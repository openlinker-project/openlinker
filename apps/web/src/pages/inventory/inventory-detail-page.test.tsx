import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../test/test-utils';
import { InventoryDetailPage } from './inventory-detail-page';
import type { InventoryItem } from '../../features/inventory/api/inventory.types';

const sampleItem: InventoryItem = {
  id: 'ol_inv_abc123',
  productId: 'ol_product_abc123',
  productVariantId: 'ol_variant_xyz',
  availableQuantity: 10,
  reservedQuantity: 2,
  locationId: 'warehouse-1',
  updatedAt: '2026-01-15T10:00:00.000Z',
  productName: 'Test Product',
  productSku: 'SKU-001',
  productImageUrl: null,
};

function renderDetailPage(apiClient: ReturnType<typeof createMockApiClient>): void {
  renderWithProviders(
    <Routes>
      <Route path="/inventory/:id" element={<InventoryDetailPage />} />
    </Routes>,
    { apiClient, route: '/inventory/ol_inv_abc123' },
  );
}

describe('InventoryDetailPage', () => {
  it('should show loading state initially', () => {
    const mockApi = createMockApiClient({
      inventory: { getById: vi.fn().mockReturnValue(new Promise(() => {})) },
    });

    renderDetailPage(mockApi);

    expect(screen.getByText('Loading inventory item')).toBeInTheDocument();
  });

  it('should show inventory item detail when data loads', async () => {
    const mockApi = createMockApiClient({
      inventory: { getById: vi.fn().mockResolvedValue(sampleItem) },
    });

    renderDetailPage(mockApi);

    expect(await screen.findByText('ol_inv_abc123')).toBeInTheDocument();
    expect(screen.getByText('Test Product')).toBeInTheDocument();
    expect(screen.getByText('SKU-001')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('warehouse-1')).toBeInTheDocument();
  });

  it('should show error state when fetch fails', async () => {
    const mockApi = createMockApiClient({
      inventory: { getById: vi.fn().mockRejectedValue(new Error('Not found')) },
    });

    renderDetailPage(mockApi);

    expect(await screen.findByText('Unable to load inventory item')).toBeInTheDocument();
  });
});
