/**
 * ErliCreateOfferWizard tests (#1096)
 *
 * Covers the Erli-specific surfaces: the dispatch-time field renders, the
 * shared `offerValidation` image gate blocks a no-image product, and the
 * submit payload carries `overrides.platformParams.dispatchTime` + master
 * `imageUrls`.
 */
import { screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../../../test/test-utils';
import { ErliCreateOfferWizard } from './erli-create-offer-wizard';
import type { Connection } from '../../../connections';
import type { Product } from '../../../products';
import type { CreateOfferRequest } from '../../api/listings.types';

const erliConnection: Connection = {
  id: 'conn_erli_1',
  name: 'My Erli',
  platformType: 'erli',
  status: 'active',
  config: { defaultDispatchTime: { period: 2, unit: 'day' } },
  credentialsBacked: true,
  adapterKey: 'erli.shopapi.v1',
  enabledCapabilities: ['OfferManager'],
  supportedCapabilities: ['OfferManager'],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

function productWith(images: string[] | null): Product {
  return {
    id: 'ol_product_abc',
    name: 'Test Shirt',
    sku: 'TS-1',
    price: 49.5,
    currency: 'PLN',
    description: null,
    images,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    variants: [
      {
        id: 'ol_variant_aaaaaaaa',
        productId: 'ol_product_abc',
        sku: 'TS-1-M',
        attributes: { size: 'M' },
        ean: '5901234567890',
        gtin: null,
        price: 49.5,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ],
  };
}

function mocks(product: Product, overrides: Parameters<typeof createMockApiClient>[0] = {}) {
  return createMockApiClient({
    connections: { list: vi.fn().mockResolvedValue([erliConnection]) },
    products: {
      list: vi.fn().mockResolvedValue({ items: [product], total: 1, limit: 20, offset: 0 }),
      getById: vi.fn().mockResolvedValue(product),
    },
    listings: {
      createOffer: vi
        .fn()
        .mockResolvedValue({ jobId: 'job-1', offerCreationRecordId: 'rec-1' }),
      resolveCategory: vi.fn().mockResolvedValue({ allegroCategoryId: '12345', method: 'gtin' }),
    },
    ...overrides,
  });
}

/** Step 0 → 1: expand the product card and pick its variant, then Next. */
async function pickVariantAndAdvance(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: /Test Shirt/ }));
  fireEvent.click(await screen.findByRole('radio'));
  fireEvent.click(screen.getByRole('button', { name: /next/i }));
}

describe('ErliCreateOfferWizard', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it('renders the dispatch-time field on the offer-details step', async () => {
    renderWithProviders(
      <ErliCreateOfferWizard connection={erliConnection} onCancel={vi.fn()} onSubmitted={vi.fn()} />,
      { apiClient: mocks(productWith(['https://cdn.example.com/a.jpg'])) },
    );

    await pickVariantAndAdvance();

    expect(await screen.findByText(/Dispatch time/)).toBeInTheDocument();
    // Connection default (2 working days) reflected in the readout.
    expect(screen.getByText(/2 working days/)).toBeInTheDocument();
  });

  it('blocks the offer-details step when the master product has no image', async () => {
    renderWithProviders(
      <ErliCreateOfferWizard connection={erliConnection} onCancel={vi.fn()} onSubmitted={vi.fn()} />,
      { apiClient: mocks(productWith(null)) },
    );

    await pickVariantAndAdvance();

    expect(await screen.findByText(/this product has no images/i)).toBeInTheDocument();
  });

  it('submits dispatchTime + master imageUrls in the create-offer request', async () => {
    const mockApi = mocks(productWith(['https://cdn.example.com/a.jpg']));
    renderWithProviders(
      <ErliCreateOfferWizard connection={erliConnection} onCancel={vi.fn()} onSubmitted={vi.fn()} />,
      { apiClient: mockApi },
    );

    await pickVariantAndAdvance();

    // On the details step: price prefilled from the variant; advance to review.
    fireEvent.change(await screen.findByLabelText(/^price \(PLN\)$/i), { target: { value: '99.99' } });
    fireEvent.change(screen.getByLabelText(/^stock$/i), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    fireEvent.click(await screen.findByRole('button', { name: /create offer/i }));

    const createOffer = vi.mocked(mockApi.listings.createOffer);
    await waitFor(() => expect(createOffer).toHaveBeenCalledTimes(1));
    const [, request] = createOffer.mock.calls[0] as [string, CreateOfferRequest];
    expect(request.price).toEqual({ amount: 99.99, currency: 'PLN' });
    expect(request.overrides?.imageUrls).toEqual(['https://cdn.example.com/a.jpg']);
    expect(request.overrides?.platformParams).toMatchObject({
      dispatchTime: { period: 2, unit: 'day' },
    });
  });
});
