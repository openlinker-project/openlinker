import { cleanup, screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders, sampleConnection } from '../../test/test-utils';
import { ListingDetailPage } from './listing-detail-page';
import type { OfferMapping } from '../../features/listings/api/listings.types';

function buildMapping(overrides: Partial<OfferMapping>): OfferMapping {
  return {
    id: 'mapping_1',
    entityType: 'Product',
    internalId: 'ol_product_abc',
    externalId: 'ext-42',
    platformType: 'allegro',
    connectionId: sampleConnection.id,
    context: null,
    createdAt: '2026-04-20T10:00:00.000Z',
    updatedAt: '2026-04-20T10:00:00.000Z',
    ...overrides,
  };
}

function renderDetail(mapping: OfferMapping): void {
  const api = createMockApiClient({
    listings: { getById: vi.fn().mockResolvedValue(mapping) },
  });
  renderWithProviders(
    <Routes>
      <Route path="/listings/:id" element={<ListingDetailPage />} />
    </Routes>,
    { apiClient: api, route: `/listings/${mapping.id}` },
  );
}

describe('ListingDetailPage', () => {
  afterEach(cleanup);

  it('links the internal ID to the product detail when entityType is Product', async () => {
    renderDetail(buildMapping({ entityType: 'Product', internalId: 'ol_product_abc' }));

    const link = await screen.findByRole('link', { name: 'ol_product_abc' });
    expect(link).toHaveAttribute('href', '/products/ol_product_abc');
  });

  it('links the internal ID to the product detail when entityType is ProductVariant', async () => {
    renderDetail(buildMapping({ entityType: 'ProductVariant', internalId: 'ol_variant_xyz' }));

    const link = await screen.findByRole('link', { name: 'ol_variant_xyz' });
    expect(link).toHaveAttribute('href', '/products/ol_variant_xyz');
  });

  it('links the internal ID to the inventory detail when entityType is InventoryItem', async () => {
    renderDetail(buildMapping({ entityType: 'InventoryItem', internalId: 'ol_inventory_99' }));

    const link = await screen.findByRole('link', { name: 'ol_inventory_99' });
    expect(link).toHaveAttribute('href', '/inventory/ol_inventory_99');
  });

  it('renders the internal ID as plain text for unknown entity types', async () => {
    renderDetail(buildMapping({ entityType: 'SomethingElse', internalId: 'ol_opaque_42' }));

    await screen.findByText('ol_opaque_42');
    expect(screen.queryByRole('link', { name: 'ol_opaque_42' })).toBeNull();
  });
});
