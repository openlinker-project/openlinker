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

// #1384 — a per-connection-instance signal (`config.allegroCategoryAccessEnabled`),
// deliberately NOT reflected in `supportedCapabilities` (static per-adapterKey,
// see ADR-031 "Correction") — both connections keep the same `supportedCapabilities`.
const erliConnectionWithCategoryAccess: Connection = {
  ...erliConnection,
  id: 'conn_erli_2',
  config: { ...erliConnection.config, allegroCategoryAccessEnabled: true },
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

function mocks(
  product: Product,
  overrides: Parameters<typeof createMockApiClient>[0] = {},
): ReturnType<typeof createMockApiClient> {
  return createMockApiClient({
    connections: { list: vi.fn().mockResolvedValue([erliConnection]) },
    products: {
      list: vi.fn().mockResolvedValue({ items: [product], total: 1, limit: 20, offset: 0 }),
      getById: vi.fn().mockResolvedValue(product),
      getVariant: vi.fn().mockResolvedValue({
        id: 'ol_variant_aaaaaaaa',
        productId: product.id,
        sku: 'TS-1-M',
        ean: '5901234567890',
        name: `${product.name} — M`,
      }),
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

  it('keeps the dispatch-period input clearable without snapping to 0', async () => {
    renderWithProviders(
      <ErliCreateOfferWizard connection={erliConnection} onCancel={vi.fn()} onSubmitted={vi.fn()} />,
      { apiClient: mocks(productWith(['https://cdn.example.com/a.jpg'])) },
    );
    await pickVariantAndAdvance();

    const periodInput = await screen.findByLabelText<HTMLInputElement>(/dispatch period/i);
    fireEvent.change(periodInput, { target: { value: '' } });
    // Field shows empty while editing — does NOT snap to "0".
    expect(periodInput.value).toBe('');
    // On blur an empty entry reverts to the last committed value (the default 2).
    fireEvent.blur(periodInput);
    expect(periodInput.value).toBe('2');
  });

  it('prefills from a retry snapshot, opens at offer-details, and reconstructs images on submit', async () => {
    const snapshot: CreateOfferRequest = {
      internalVariantId: 'ol_variant_aaaaaaaa',
      stock: 7,
      publishImmediately: false,
      price: { amount: 123.45, currency: 'PLN' },
      overrides: {
        title: 'Retried Title',
        description: 'a retried description',
        platformParams: { dispatchTime: { period: 5, unit: 'hour' } },
      },
    };
    const mockApi = mocks(productWith(['https://cdn.example.com/a.jpg']));
    renderWithProviders(
      <ErliCreateOfferWizard
        connection={erliConnection}
        initialValues={snapshot}
        onCancel={vi.fn()}
        onSubmitted={vi.fn()}
      />,
      { apiClient: mockApi },
    );

    // Opens directly on the offer-details step (no variant pick) with the
    // snapshot's title + dispatch already populated.
    expect(await screen.findByText(/Dispatch time/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('Retried Title')).toBeInTheDocument();
    expect(screen.getByText(/5 hours/)).toBeInTheDocument();

    // The variant context (master images) is reconstructed from the variant id;
    // advance to Review and wait for the reconstructed master image count to
    // appear before submitting, so the image gate has cleared.
    fireEvent.click(await screen.findByRole('button', { name: /next/i }));
    expect(await screen.findByText(/1 from master product/i)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /create offer/i }));

    const createOffer = vi.mocked(mockApi.listings.createOffer);
    await waitFor(() => expect(createOffer).toHaveBeenCalledTimes(1));
    const [, request] = createOffer.mock.calls[0] as [string, CreateOfferRequest];
    expect(request.internalVariantId).toBe('ol_variant_aaaaaaaa');
    expect(request.stock).toBe(7);
    expect(request.overrides?.imageUrls).toEqual(['https://cdn.example.com/a.jpg']);
    expect(request.overrides?.platformParams).toMatchObject({
      dispatchTime: { period: 5, unit: 'hour' },
    });
  });

  // #1384 — capability-conditional category/parameters steps.
  describe('Allegro category access (#1384)', () => {
    it('keeps the plain-text category field and shows the fallback hint when access is not configured', async () => {
      renderWithProviders(
        <ErliCreateOfferWizard connection={erliConnection} onCancel={vi.fn()} onSubmitted={vi.fn()} />,
        { apiClient: mocks(productWith(['https://cdn.example.com/a.jpg'])) },
      );

      await pickVariantAndAdvance();

      expect(await screen.findByPlaceholderText(/e\.g\. 12345/i)).toBeInTheDocument();
      expect(
        screen.getByText(/add allegro category browsing to this connection/i),
      ).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /configure category browsing/i })).toHaveAttribute(
        'href',
        `/connections/${erliConnection.id}/edit`,
      );
      // Only the 3-step shape — no "Category" / "Category parameters" steps.
      expect(screen.queryByText('Category parameters')).not.toBeInTheDocument();
    });

    it('renders the Category and Category-parameters steps, blocks on a required parameter, and submits overrides.parameters', async () => {
      const mockApi = mocks(productWith(['https://cdn.example.com/a.jpg']), {
        connections: { list: vi.fn().mockResolvedValue([erliConnectionWithCategoryAccess]) },
        listings: {
          createOffer: vi
            .fn()
            .mockResolvedValue({ jobId: 'job-1', offerCreationRecordId: 'rec-1' }),
          resolveCategory: vi.fn().mockResolvedValue({ allegroCategoryId: null, method: 'manual' }),
          getCategoryParameters: vi.fn().mockResolvedValue({
            parameters: [
              {
                id: 'p_stan',
                name: 'Stan',
                type: 'dictionary',
                required: true,
                section: 'offer',
                restrictions: {},
                dictionary: [{ id: 'nowy', value: 'Nowy' }],
              },
            ],
          }),
        },
        mappings: {
          getAllegroCategories: vi
            .fn()
            .mockResolvedValue([{ id: '12345', name: 'Test Category', parentId: null, leaf: true }]),
        },
      });
      renderWithProviders(
        <ErliCreateOfferWizard
          connection={erliConnectionWithCategoryAccess}
          onCancel={vi.fn()}
          onSubmitted={vi.fn()}
        />,
        { apiClient: mockApi },
      );

      await pickVariantAndAdvance();
      // Offer-details step: no plain-text category field or hint anymore —
      // it moved to its own step.
      fireEvent.change(await screen.findByLabelText(/^price \(PLN\)$/i), {
        target: { value: '99.99' },
      });
      expect(screen.queryByPlaceholderText(/e\.g\. 12345/i)).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /next/i }));

      // Category step — pick the leaf via the reused CategoryPicker.
      const selectButton = await screen.findByRole('button', { name: /^select$/i });
      fireEvent.click(selectButton);
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /^selected$/i })).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByRole('button', { name: /next/i }));

      // Category-parameters step — required "Stan" field blocks Next until filled.
      await screen.findByText('Stan');
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
      expect(await screen.findByText(/stan is required/i)).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText('Stan'), { target: { value: 'nowy' } });
      fireEvent.click(screen.getByRole('button', { name: /next/i }));

      fireEvent.click(await screen.findByRole('button', { name: /create offer/i }));

      const createOffer = vi.mocked(mockApi.listings.createOffer);
      await waitFor(() => expect(createOffer).toHaveBeenCalledTimes(1));
      const [, request] = createOffer.mock.calls[0] as [string, CreateOfferRequest];
      expect(request.overrides?.categoryId).toBe('12345');
      expect(request.overrides?.parameters).toEqual([
        { id: 'p_stan', valuesIds: ['nowy'], section: 'offer' },
      ]);
    });

    it('blocks Next on the Category step until a category is selected (#1401 review)', async () => {
      const mockApi = mocks(productWith(['https://cdn.example.com/a.jpg']), {
        connections: { list: vi.fn().mockResolvedValue([erliConnectionWithCategoryAccess]) },
        listings: {
          createOffer: vi
            .fn()
            .mockResolvedValue({ jobId: 'job-1', offerCreationRecordId: 'rec-1' }),
          resolveCategory: vi.fn().mockResolvedValue({ allegroCategoryId: null, method: 'manual' }),
          getCategoryParameters: vi.fn().mockResolvedValue({ parameters: [] }),
        },
        mappings: {
          getAllegroCategories: vi
            .fn()
            .mockResolvedValue([{ id: '12345', name: 'Test Category', parentId: null, leaf: true }]),
        },
      });
      renderWithProviders(
        <ErliCreateOfferWizard
          connection={erliConnectionWithCategoryAccess}
          onCancel={vi.fn()}
          onSubmitted={vi.fn()}
        />,
        { apiClient: mockApi },
      );

      await pickVariantAndAdvance();
      fireEvent.change(await screen.findByLabelText(/^price \(PLN\)$/i), {
        target: { value: '99.99' },
      });
      fireEvent.click(screen.getByRole('button', { name: /next/i }));

      // Category step — click Next without touching the CategoryPicker at all.
      await screen.findByText('Category');
      fireEvent.click(screen.getByRole('button', { name: /next/i }));

      // CI runners under load can be slower to commit the manual RHF error
      // than the 1s testing-library default (#1420 review) — widen this one
      // assertion rather than the whole suite's global timeout.
      expect(
        await screen.findByText(/select a category to continue/i, {}, { timeout: 5000 }),
      ).toBeInTheDocument();
      // Still on the Category step — Category-parameters never rendered.
      expect(screen.queryByText(/no additional parameters required/i)).not.toBeInTheDocument();
    });
  });
});
