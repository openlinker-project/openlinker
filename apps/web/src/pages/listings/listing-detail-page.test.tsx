import { cleanup, screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders, sampleConnection } from '../../test/test-utils';
import { ListingDetailPage } from './listing-detail-page';
import { ApiError } from '../../shared/api/api-error';
import type {
  MarketplaceOfferResponse,
  OfferCreationStatusResponse,
  OfferMapping,
} from '../../features/listings/api/listings.types';
import type { ProductVariantSummary } from '../../features/products/api/products.types';

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

  it('renders the internal ID as plain text when entityType is InventoryItem', async () => {
    renderDetail(buildMapping({ entityType: 'InventoryItem', internalId: 'ol_inventory_99' }));

    await screen.findByText('ol_inventory_99');
    expect(screen.queryByRole('link', { name: 'ol_inventory_99' })).toBeNull();
  });

  it('renders the internal ID as plain text for unknown entity types', async () => {
    renderDetail(buildMapping({ entityType: 'SomethingElse', internalId: 'ol_opaque_42' }));

    await screen.findByText('ol_opaque_42');
    expect(screen.queryByRole('link', { name: 'ol_opaque_42' })).toBeNull();
  });

  it('renders the offer-creation section with an Active badge and metadata when offerCreation is present', async () => {
    const offerCreation: OfferCreationStatusResponse = {
      id: 'rec-1',
      internalVariantId: 'ol_variant_abc',
      connectionId: sampleConnection.id,
      externalOfferId: 'ext-42',
      status: 'active',
      errors: null,
      publishImmediately: true,
      createdAt: '2026-04-22T10:00:00.000Z',
      updatedAt: '2026-04-22T10:05:00.000Z',
    };
    renderDetail(buildMapping({ entityType: 'Offer', offerCreation }));

    expect(await screen.findByRole('heading', { name: /offer creation/i })).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    // Metadata rendered in KeyValueList
    expect(screen.getByText('rec-1')).toBeInTheDocument();
    expect(screen.getAllByText('ext-42').length).toBeGreaterThan(0);
    // Not failed → no error list
    expect(screen.queryByRole('list', { name: /offer creation errors/i })).toBeNull();
  });

  it('renders an em-dash for externalOfferId when the record has none (pre-creation)', async () => {
    const offerCreation: OfferCreationStatusResponse = {
      id: 'rec-pending',
      internalVariantId: 'ol_variant_abc',
      connectionId: sampleConnection.id,
      externalOfferId: null,
      status: 'pending',
      errors: null,
      publishImmediately: true,
      createdAt: '2026-04-22T10:00:00.000Z',
      updatedAt: '2026-04-22T10:05:00.000Z',
    };
    renderDetail(buildMapping({ entityType: 'Offer', offerCreation }));

    expect(await screen.findByText('rec-pending')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders the error list when offerCreation.status is failed', async () => {
    const offerCreation: OfferCreationStatusResponse = {
      id: 'rec-2',
      internalVariantId: 'ol_variant_abc',
      connectionId: sampleConnection.id,
      externalOfferId: null,
      status: 'failed',
      errors: [
        { field: 'parameters.EAN', code: 'MISSING_EAN', message: 'EAN is required.' },
      ],
      publishImmediately: false,
      createdAt: '2026-04-22T10:00:00.000Z',
      updatedAt: '2026-04-22T10:05:00.000Z',
    };
    renderDetail(buildMapping({ entityType: 'Offer', offerCreation }));

    expect(await screen.findByText('Failed')).toBeInTheDocument();
    // Field path renders as a breadcrumb copy-button (#486 design refresh).
    expect(
      screen.getByRole('button', { name: /Copy field path parameters\.EAN/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('EAN is required.')).toBeInTheDocument();
  });

  it('does not render the offer-creation section when offerCreation is absent', async () => {
    renderDetail(buildMapping({ entityType: 'Offer' }));

    // Wait for the page to fully render by asserting on a known element first
    await screen.findByText('mapping_1');
    expect(screen.queryByRole('heading', { name: /offer creation/i })).toBeNull();
  });

  describe('Listing details section (#464)', () => {
    const liveOffer: MarketplaceOfferResponse = {
      externalId: 'allegro-offer-456',
      title: 'Vintage Camera Lens 50mm',
      description: 'Mint condition.\n\nOriginal case included.',
      imageUrl: 'https://a.allegroimg.com/lens.jpg',
      price: { amount: '249.00', currency: 'PLN' },
      availableQuantity: 3,
      status: 'ACTIVE',
      category: { id: '12345', name: 'Lenses' },
      marketplaceUrl: 'https://allegro.pl/oferta/allegro-offer-456',
      endsAt: '2026-04-30T10:00:00Z',
    };

    function renderWithOfferData(
      mapping: OfferMapping,
      offerOverride?: typeof liveOffer | Error,
      variant?: ProductVariantSummary,
    ): void {
      const getMarketplaceOffer =
        offerOverride instanceof Error
          ? vi.fn().mockRejectedValue(offerOverride)
          : vi.fn().mockResolvedValue(offerOverride ?? liveOffer);
      const getVariant = variant
        ? vi.fn().mockResolvedValue(variant)
        : undefined;
      const api = createMockApiClient({
        listings: {
          getById: vi.fn().mockResolvedValue(mapping),
          getMarketplaceOffer,
        },
        ...(getVariant ? { products: { getVariant } } : {}),
      });
      renderWithProviders(
        <Routes>
          <Route path="/listings/:id" element={<ListingDetailPage />} />
        </Routes>,
        { apiClient: api, route: `/listings/${mapping.id}` },
      );
    }

    it('renders title, status, price, qty, and marketplace URL when entityType is Offer and the offer fetch succeeds', async () => {
      renderWithOfferData(buildMapping({ entityType: 'Offer' }));

      expect(
        await screen.findByRole('heading', { name: 'Vintage Camera Lens 50mm' }),
      ).toBeInTheDocument();
      expect(screen.getByText('ACTIVE')).toBeInTheDocument();
      expect(screen.getByText('249.00 PLN')).toBeInTheDocument();
      expect(screen.getByText('3')).toBeInTheDocument();
      expect(screen.getByText('Lenses')).toBeInTheDocument();
      const link = screen.getByRole('link', { name: /open on marketplace/i });
      expect(link).toHaveAttribute('href', 'https://allegro.pl/oferta/allegro-offer-456');
      expect(link).toHaveAttribute('target', '_blank');
      // Description preview rendered in a <details> element (collapsed by default).
      expect(screen.getByText(/description preview/i)).toBeInTheDocument();
    });

    it('renders the soft fallback panel when the adapter does not implement OfferReader (422)', async () => {
      renderWithOfferData(
        buildMapping({ entityType: 'Offer' }),
        new ApiError('not supported', 422, null),
      );

      expect(await screen.findByText('Live data unavailable for this adapter.')).toBeInTheDocument();
      // Raw mapping fields still render below the soft fallback.
      expect(screen.getByText('mapping_1')).toBeInTheDocument();
    });

    it('renders the error panel with retry on 5xx and keeps raw mapping visible', async () => {
      renderWithOfferData(
        buildMapping({ entityType: 'Offer' }),
        new ApiError('Allegro upstream 502', 502, null),
      );

      expect(await screen.findByText('Unable to load listing details')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
      expect(screen.getByText('mapping_1')).toBeInTheDocument();
    });

    it('does not fetch the live offer when entityType is not Offer', async () => {
      const getMarketplaceOffer = vi.fn();
      const api = createMockApiClient({
        listings: {
          getById: vi.fn().mockResolvedValue(buildMapping({ entityType: 'Product' })),
          getMarketplaceOffer,
        },
      });
      renderWithProviders(
        <Routes>
          <Route path="/listings/:id" element={<ListingDetailPage />} />
        </Routes>,
        { apiClient: api, route: '/listings/mapping_1' },
      );

      await screen.findByText('mapping_1');
      expect(getMarketplaceOffer).not.toHaveBeenCalled();
      // Section heading not rendered.
      expect(screen.queryByRole('heading', { name: /listing details/i })).toBeNull();
    });

    it('renders SKU and EAN tags inline next to the Internal ID when the variant query resolves', async () => {
      const variantSummary: ProductVariantSummary = {
        id: 'ol_variant_xyz',
        productId: 'ol_product_abc',
        sku: 'SKU-RED-42',
        ean: '5901234123457',
        name: 'Red / 42',
      };
      renderWithOfferData(
        buildMapping({ entityType: 'ProductVariant', internalId: 'ol_variant_xyz' }),
        undefined,
        variantSummary,
      );

      expect(await screen.findByText('SKU SKU-RED-42')).toBeInTheDocument();
      expect(screen.getByText('EAN 5901234123457')).toBeInTheDocument();
    });
  });
});
